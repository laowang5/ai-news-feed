import { ScoreOnlySchema, CopywritingSchema, type CopywritingResult } from './schema.js';

export interface ParsedScoreResult {
  score: number;
  topic_match: string[];
}

/**
 * Attempts to repair and validate malformed JSON strings returned by LLMs for score + optional topic_match.
 */
export function repairAndParseScoreResult(raw: string): ParsedScoreResult | null {
  if (!raw || typeof raw !== 'string') return null;

  let text = raw.trim();

  // 1. Remove markdown fences
  text = text.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '').trim();

  // 2. Extract outermost JSON object
  const startIdx = text.indexOf('{');
  const endIdx = text.lastIndexOf('}');
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    text = text.slice(startIdx, endIdx + 1);
  }

  // 3. Remove trailing commas
  text = text.replace(/,\s*([}\]])/g, '$1');

  try {
    const parsed = JSON.parse(text);

    let score = parsed?.score;
    if (typeof score === 'string') {
      const num = parseInt(score, 10);
      if (!isNaN(num)) score = num;
    }

    if (typeof score === 'number' && !isNaN(score)) {
      if (score > 0 && score <= 10 && Number.isInteger(score) === false) {
        score = Math.round(score * 10);
      }
      const topicMatch = Array.isArray(parsed?.topic_match)
        ? parsed.topic_match.filter((t: unknown): t is string => typeof t === 'string' && t.trim().length > 0).map((t: string) => t.trim())
        : [];
      const valResult = ScoreOnlySchema.safeParse({
        score: Math.round(score),
        topic_match: topicMatch.length > 0 ? topicMatch : undefined,
      });
      if (valResult.success) {
        return {
          score: valResult.data.score,
          topic_match: valResult.data.topic_match || [],
        };
      }
    }
  } catch {
    // Parsing error
  }

  return null;
}

/**
 * Attempts to repair and validate malformed JSON strings returned by LLMs for score only.
 * Removes markdown code fences, trailing commas, extracts core JSON, normalizes 0-10 -> 0-100 if needed.
 */
export function repairAndParseScore(raw: string): number | null {
  return repairAndParseScoreResult(raw)?.score ?? null;
}

function cleanOptionalText(val: unknown, maxLen: number): string | null | undefined {
  if (val === undefined) return undefined;
  if (val === null) return null;
  if (typeof val !== 'string') return undefined;
  const trimmed = val.trim();
  return trimmed.length > 0 ? trimmed.slice(0, maxLen) : null;
}

/**
 * Parses copywriting result { summary, tags, title_zh, title_en, why_it_matters }
 * Also supports standalone `WHY: <one sentence>` lines per spec §6.
 */
export function repairAndParseCopy(raw: string): CopywritingResult | null {
  if (!raw || typeof raw !== 'string') return null;

  const whyMatch = raw.match(/^\s*WHY:\s*(.+?)\s*$/im);
  const inlineWhy = whyMatch?.[1]?.trim() || null;

  let text = raw.trim();
  text = text.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '').trim();

  const startIdx = text.indexOf('{');
  const endIdx = text.lastIndexOf('}');
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    text = text.slice(startIdx, endIdx + 1);
  }
  text = text.replace(/,\s*([}\]])/g, '$1');

  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object') {
      const legacySummary = typeof parsed.summary === 'string' ? parsed.summary.trim() : '';
      parsed.summary = legacySummary.length > 0 ? legacySummary.slice(0, 500) : undefined;
      parsed.title_zh = cleanOptionalText(parsed.title_zh, 300);
      parsed.title_en = cleanOptionalText(parsed.title_en, 300);

      const candidateWhy =
        typeof parsed.why_it_matters === 'string' && parsed.why_it_matters.trim()
          ? parsed.why_it_matters.trim().slice(0, 200)
          : inlineWhy
            ? inlineWhy.slice(0, 200)
            : null;
      parsed.why_it_matters = candidateWhy;
    }

    if (!parsed?.summary) {
      return null;
    }

    const valResult = CopywritingSchema.safeParse(parsed);
    if (valResult.success) {
      return valResult.data;
    }
  } catch {
    // Parsing error
  }

  return null;
}

/**
 * Backward compatibility helper for combined evaluation.
 */
export function repairAndParseEvaluation(raw: string): { score: number; summary: string; tags: string[] } | null {
  const score = repairAndParseScore(raw);
  const copy = repairAndParseCopy(raw);
  const summary = copy?.summary || '';
  if (score !== null && copy !== null && summary.length > 0) {
    return { score, summary, tags: copy.tags };
  }
  return null;
}
