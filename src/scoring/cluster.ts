import type { SignalItem } from '../types.js';
import { toLocalDateString } from '../ingestor/aihot-digest.js';

export interface MergePair {
  primaryId: number;
  mergedIds: number[];
}

const TITLE_STOPWORDS = new Set([
  'introducing',
  'announcing',
  'release',
  'releases',
  'launches',
  'now',
  'available',
]);

const PROPER_NOUN_IGNORE = new Set([
  ...TITLE_STOPWORDS,
  'ai',
  'llm',
  'api',
  'sdk',
  'cli',
  'gpu',
  'cpu',
  'show',
  'ask',
  'hn',
  'the',
  'a',
  'an',
  'for',
  'in',
  'on',
  'at',
  'to',
  'with',
  'and',
  'of',
  'by',
  'is',
  'are',
  'was',
  'were',
  'why',
  'how',
  'what',
  'new',
  'open',
  'via',
  'ceo',
  'cfo',
  'cto',
  'ipo',
]);

const ZH_STOPWORD_PHRASES = ['正式发布', '正式推出', '正式上线', '发布', '推出', '上线', '宣布', '正式', '来了'];
const DIGEST_DATE_PATTERN = /(\d{4}[-/.年]\d{1,2}|\d{1,2}月\d{1,2}日|\b\d{1,2}[-/.]\d{1,2}\b)/;

function isDigestParent(item: SignalItem): boolean {
  if (item.parent_digest) return false;
  if (item.source_type === 'digest') return true;
  const title = item.title || '';
  if (title.includes('日报')) return true;
  if (item.source === 'aihot' && DIGEST_DATE_PATTERN.test(title)) return true;
  return false;
}

function stripBrackets(title: string): string {
  return title.replace(/\[[^\]]*\]|\([^)]*\)|（[^）]*）|【[^】]*】/g, ' ');
}

function extractNormalizedTokens(title: string): Set<string> {
  let cleaned = stripBrackets(title).toLowerCase();
  for (const phrase of ZH_STOPWORD_PHRASES) {
    cleaned = cleaned.split(phrase).join(' ');
  }
  cleaned = cleaned.replace(/[^a-z0-9\u4e00-\u9fff\s]+/g, ' ').replace(/\s+/g, ' ').trim();

  const tokens = new Set<string>();
  const asciiMatches = cleaned.match(/[a-z0-9]+/g) || [];
  for (const tok of asciiMatches) {
    if (!TITLE_STOPWORDS.has(tok) && tok.length > 0) {
      tokens.add(tok);
    }
  }

  const cjkChunks = cleaned.match(/[\u4e00-\u9fff]+/g) || [];
  for (const chunk of cjkChunks) {
    if (chunk.length <= 2) {
      tokens.add(chunk);
    } else {
      for (let i = 0; i <= chunk.length - 2; i += 1) {
        tokens.add(chunk.slice(i, i + 2));
      }
    }
  }

  return tokens;
}

function extractProperNouns(title: string): Set<string> {
  const unbracketed = stripBrackets(title);
  const nouns = new Set<string>();

  // Continuous uppercase/TitleCase ASCII identifiers & alphanumeric model tokens
  const matches = unbracketed.match(/\b[A-Z][A-Za-z0-9]*(?:[-.][A-Za-z0-9]+)*\b|\b[A-Za-z]*\d+[A-Za-z0-9.]*\b/g) || [];
  for (const raw of matches) {
    const norm = raw.toLowerCase();
    if (norm.length < 2) continue;
    if (PROPER_NOUN_IGNORE.has(norm)) continue;
    nouns.add(norm);
  }

  return nouns;
}

type ModelFamilyMap = Map<string, Set<string>>;

const MODEL_STOP_FOLLOWERS = new Set([
  'is',
  'are',
  'was',
  'now',
  'available',
  'for',
  'in',
  'on',
  'at',
  'to',
  'with',
  'and',
  'or',
  'of',
  'by',
  'as',
  'model',
  'models',
]);

function extractModelIdentifiers(title: string): ModelFamilyMap {
  const map: ModelFamilyMap = new Map();
  const add = (family: string, raw: string) => {
    const normalized = raw.toLowerCase().replace(/[-_\s]+/g, ' ').trim();
    if (!normalized) return;
    let set = map.get(family);
    if (!set) {
      set = new Set();
      map.set(family, set);
    }
    set.add(normalized);
  };

  // Gemini N[.N] [Variant]
  const geminiRe = /\bgemini[\s-]*(\d+(?:\.\d+)?)(?:\s+([a-z]+))?/gi;
  let m: RegExpExecArray | null;
  while ((m = geminiRe.exec(title)) !== null) {
    const ver = m[1];
    const variant = m[2] && !MODEL_STOP_FOLLOWERS.has(m[2].toLowerCase()) ? ` ${m[2]}` : '';
    add('gemini', `gemini ${ver}${variant}`);
  }

  // GPT-N[.N] [Variant]
  const gptRe = /\bgpt[-\s]*(\d+(?:\.\d+)?)(?:[-\s]+([a-z0-9]+))?/gi;
  while ((m = gptRe.exec(title)) !== null) {
    const ver = m[1];
    const variant = m[2] && !MODEL_STOP_FOLLOWERS.has(m[2].toLowerCase()) ? ` ${m[2]}` : '';
    add('gpt', `gpt ${ver}${variant}`);
  }

  // Claude <Variant> [Version]
  const claudeRe = /\bclaude\s+(opus|sonnet|haiku|meetings|[a-z]+)(?:\s+(\d+(?:\.\d+)?))?/gi;
  while ((m = claudeRe.exec(title)) !== null) {
    const variant = m[1].toLowerCase();
    if (MODEL_STOP_FOLLOWERS.has(variant)) continue;
    const ver = m[2] ? ` ${m[2]}` : '';
    add('claude', `claude ${variant}${ver}`);
  }

  // DeepSeek V3 / R1 / versioned model
  const dsRe = /\bdeepseek[-\s]*([vr]\d+(?:\.\d+)?|\d+(?:\.\d+)?)\b/gi;
  while ((m = dsRe.exec(title)) !== null) {
    add('deepseek', `deepseek ${m[1]}`);
  }

  // Llama / Qwen / Grok
  const otherRe = /\b(llama|qwen|grok)[-\s]*(\d+(?:\.\d+)?)(?:\s+([a-z0-9]+))?/gi;
  while ((m = otherRe.exec(title)) !== null) {
    const fam = m[1].toLowerCase();
    const ver = m[2];
    const variant = m[3] && !MODEL_STOP_FOLLOWERS.has(m[3].toLowerCase()) ? ` ${m[3]}` : '';
    add(fam, `${fam} ${ver}${variant}`);
  }

  return map;
}

function hasModelConflict(aModels: ModelFamilyMap, bModels: ModelFamilyMap): boolean {
  for (const [family, aSet] of aModels.entries()) {
    const bSet = bModels.get(family);
    if (!bSet) continue;
    for (const aVal of aSet) {
      for (const bVal of bSet) {
        if (aVal !== bVal) {
          return true;
        }
      }
    }
  }
  return false;
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const tok of a) {
    if (b.has(tok)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function countShared(a: Set<string>, b: Set<string>): number {
  let count = 0;
  for (const tok of a) {
    if (b.has(tok)) count += 1;
  }
  return count;
}

function getWindowDate(item: SignalItem): string {
  if (item.digest_date && /^\d{4}-\d{2}-\d{2}$/.test(item.digest_date)) {
    return item.digest_date;
  }
  return toLocalDateString(item.published_at || item.fetched_at);
}

function comparePrimaryPriority(a: SignalItem, b: SignalItem): number {
  const aLen = (a.raw_content || '').trim().length;
  const bLen = (b.raw_content || '').trim().length;

  // 1. Content length >= 400 chars preferred first
  const aHasRich = aLen >= 400 ? 1 : 0;
  const bHasRich = bLen >= 400 ? 1 : 0;
  if (bHasRich !== aHasRich) return bHasRich - aHasRich;
  if (bLen !== aLen) return bLen - aLen;

  // 2. Higher source_weight preferred
  const aWeight = a.source_weight ?? 0.9;
  const bWeight = b.source_weight ?? 0.9;
  if (bWeight !== aWeight) return bWeight - aWeight;

  // 3. Earlier published_at preferred
  const aDate = a.published_at ? new Date(a.published_at).getTime() : Number.MAX_SAFE_INTEGER;
  const bDate = b.published_at ? new Date(b.published_at).getTime() : Number.MAX_SAFE_INTEGER;
  if (aDate !== bDate) return aDate - bDate;

  return a.id - b.id;
}

/**
 * Cluster same-day cross-source items representing the same event (zero LLM calls).
 */
export function clusterSignals(items: SignalItem[]): MergePair[] {
  interface Prepared {
    item: SignalItem;
    window: string;
    tokens: Set<string>;
    properNouns: Set<string>;
    models: ModelFamilyMap;
  }

  const byWindow = new Map<string, Prepared[]>();
  for (const item of items) {
    if (!item || typeof item.id !== 'number') continue;
    if (isDigestParent(item)) continue;

    const window = getWindowDate(item);
    if (!window) continue;

    const prepared: Prepared = {
      item,
      window,
      tokens: extractNormalizedTokens(item.title || ''),
      properNouns: extractProperNouns(item.title || ''),
      models: extractModelIdentifiers(item.title || ''),
    };

    const list = byWindow.get(window);
    if (list) {
      list.push(prepared);
    } else {
      byWindow.set(window, [prepared]);
    }
  }

  const pairs: MergePair[] = [];

  for (const group of byWindow.values()) {
    if (group.length < 2) continue;

    // Build clusters greedily while forbidding model conflicts across all cluster members
    const clusters: Prepared[][] = [];

    for (const candidate of group) {
      let targetCluster: Prepared[] | null = null;

      for (const cluster of clusters) {
        const anyConflict = cluster.some((member) => hasModelConflict(member.models, candidate.models));
        if (anyConflict) continue;

        const matchesAny = cluster.some((member) => {
          const jaccard = jaccardSimilarity(member.tokens, candidate.tokens);
          if (jaccard >= 0.6) return true;
          const sharedProper = countShared(member.properNouns, candidate.properNouns);
          return sharedProper >= 2;
        });

        if (matchesAny) {
          targetCluster = cluster;
          break;
        }
      }

      if (targetCluster) {
        targetCluster.push(candidate);
      } else {
        clusters.push([candidate]);
      }
    }

    for (const cluster of clusters) {
      if (cluster.length < 2) continue;
      const sorted = cluster.map((c) => c.item).sort(comparePrimaryPriority);
      const primary = sorted[0];
      const mergedIds = sorted.slice(1).map((m) => m.id);
      if (mergedIds.length > 0) {
        pairs.push({ primaryId: primary.id, mergedIds });
      }
    }
  }

  return pairs;
}
