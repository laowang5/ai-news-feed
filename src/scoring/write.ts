import type { Thresholds } from './thresholds.js';
import { repairAndParseCopy } from '../evaluator/repair.js';
import type { DisplayLanguage } from '../types.js';

export interface WriteCopyOptions {
  mean: number;
  thresholds: Thresholds;
  /** Language the summary must be written in. Defaults to 'zh'. */
  lang?: DisplayLanguage;
}

export function getWordCountTarget(score: number): { min: number; max: number; label: string } {
  if (score >= 95) return { min: 150, max: 200, label: '150-200字' };
  if (score >= 90) return { min: 100, max: 140, label: '100-140字' };
  if (score >= 80) return { min: 60, max: 80, label: '60-80字' };
  if (score >= 70) return { min: 40, max: 60, label: '40-60字' };
  return { min: 1, max: 20, label: '20字以内' };
}

const FORBIDDEN_TAGS = new Set(['ai-news', 'technology', 'funding']);

export interface WriteCopyOutput {
  summary: string;
  tags: string[];
  title_zh: string | null;
  title_en: string | null;
  why_it_matters: string | null;
}

/**
 * Generates a summary in the configured language, localized titles, a "why it matters"
 * one-liner, and topic tags.
 *
 * Summaries are NOT bilingual on purpose: the copy is written in `opts.lang`, so one
 * generation already matches the reader's language and costs half the output tokens.
 * Only the titles are dual (title_zh / title_en) because a Chinese source item has no
 * English title to fall back to.
 *
 * Only executes if mean >= thresholds.browseMinScore.
 */
export async function writeCopy(
  item: { title: string; summary?: string; raw_content?: string | null },
  opts: WriteCopyOptions,
  callLlm: (systemPrompt: string, userPrompt: string) => Promise<string | null>
): Promise<WriteCopyOutput | null> {
  if (opts.mean < opts.thresholds.browseMinScore) {
    return null;
  }

  const lang: DisplayLanguage = opts.lang ?? 'zh';
  const { label } = getWordCountTarget(opts.mean);
  const content = (item.raw_content || item.summary || item.title).slice(0, 2000);
  const languageRule =
    lang === 'zh'
      ? '摘要必须使用简体中文书写（专有名词如 OpenAI、Gemini、DeepSeek、Transformer 可保留英文原文）。即使素材是英文，也必须先理解再用中文转述，严禁直接照抄英文句子。'
      : 'Write the summary in English.';

  const systemPrompt = `你是一位高阶 AI 情报编辑。请根据提供的事件材料和已定分档生成标题翻译、摘要、重要性说明与标签。

【要求】
1. 摘要字数必须严格控制在 ${label}。直击技术实质、工程价值与业务影响，语言极其精练，杜绝废话套话。
2. ${languageRule}
3. 标题翻译（title_zh / title_en）：原文是中文时 title_zh 可填 null，title_en 必须给英文翻译；原文是英文时 title_en 可填 null，title_zh 必须给简洁准确的中文翻译（专有名词如 OpenAI、Gemini、DeepSeek、Transformer 可保留英文原文）。
4. 为什么重要（why_it_matters）：一句话点明这条动态对读者的真实价值或影响（≤40 字，禁止空泛套话），也可在末尾另起一行写 \`WHY: <一句话>\`。
5. 标签：输出 1~3 个具体的 kebab-case 实体/领域标签（如 deepseek-v3, inference-optimization, flash-attention）。
   严禁使用空泛标签：ai-news, technology, funding。

【输出格式】
必须严格输出纯 JSON，结构如下：
{
  "title_zh": "中文标题，原文已是中文则填 null",
  "title_en": "English title, null when the source title is already English",
  "summary": "摘要，语言与第 2 条要求一致，字数严格控制在 ${label}",
  "why_it_matters": "一句话点明真实价值或影响，≤40 字",
  "tags": ["tag-1", "tag-2"]
}`;

  const userPrompt = [
    `【事件评分档】：${opts.mean}分（${label}）`,
    `【标题】：${item.title}`,
    `【内容】：${content}`,
  ].join('\n');

  try {
    const raw = await callLlm(systemPrompt, userPrompt);
    if (!raw) return null;

    const parsed = repairAndParseCopy(raw);
    if (!parsed) return null;

    const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : '';
    if (!summary) return null;

    const filteredTags = parsed.tags
      .map((t) => t.trim().toLowerCase().replace(/\s+/g, '-'))
      .filter((t) => t && !FORBIDDEN_TAGS.has(t));

    const titleZh = typeof parsed.title_zh === 'string' && parsed.title_zh.trim()
      ? parsed.title_zh.trim()
      : null;

    const titleEn = typeof parsed.title_en === 'string' && parsed.title_en.trim()
      ? parsed.title_en.trim()
      : null;

    const whyItMatters = typeof parsed.why_it_matters === 'string' && parsed.why_it_matters.trim()
      ? parsed.why_it_matters.trim()
      : null;

    return {
      summary,
      tags: filteredTags,
      title_zh: titleZh,
      title_en: titleEn,
      why_it_matters: whyItMatters,
    };
  } catch (err) {
    console.warn('[writeCopy] Copywriting failed:', err);
    return null;
  }
}
