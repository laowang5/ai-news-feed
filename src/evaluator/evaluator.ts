import type { SignalItem, SourceConfig } from '../types.js';
import { loadRubric, rubricVersion, getRubricConfig } from '../scoring/rubric.js';
import { buildScoreInput } from '../scoring/prompt.js';
import { adjustScore } from '../scoring/adjust.js';
import { resolveThresholds, type Thresholds, DEFAULT_THRESHOLDS } from '../scoring/thresholds.js';
import { repairAndParseScoreResult } from './repair.js';

export interface EvaluatorOptions {
  ctx?: any;
  llmBaseUrl?: string;
  llmApiKey?: string;
  llmModel?: string;
  maxScoresPerRun?: number;
  scoreCalls?: number;
  thresholds?: Partial<Thresholds>;
  sourcesMap?: Map<string, SourceConfig>;
}

export interface EvaluatedBatchItem {
  url_key: string;
  rawScores: number[];
  mean: number;
  adjusted: number;
  source_weight: number;
  tracking_penalty: number;
  is_s_tier: boolean;
  prompt_version: string;
  status: 'scored';
}

export const DEFAULT_MAX_SCORES_PER_RUN = 10;

export class NewsEvaluator {
  private ctx?: any;
  private llmBaseUrl?: string;
  private llmApiKey?: string;
  private llmModel: string;
  private maxScoresPerRun: number;
  private scoreCalls: number;
  private thresholds: Thresholds;
  private sourcesMap: Map<string, SourceConfig>;

  constructor(options: EvaluatorOptions = {}) {
    this.ctx = options.ctx;
    this.llmBaseUrl =
      options.llmBaseUrl ||
      process.env.AI_NEWS_LLM_BASE_URL ||
      process.env.OPENAI_BASE_URL;
    this.llmApiKey =
      options.llmApiKey ||
      process.env.AI_NEWS_LLM_API_KEY ||
      process.env.DEEPSEEK_API_KEY ||
      process.env.OPENAI_API_KEY;
    this.llmModel =
      options.llmModel ||
      process.env.AI_NEWS_LLM_MODEL ||
      'deepseek-chat';
    this.maxScoresPerRun = options.maxScoresPerRun ?? DEFAULT_MAX_SCORES_PER_RUN;
    this.scoreCalls = options.scoreCalls || 2;
    this.thresholds = resolveThresholds(options.thresholds).thresholds;
    this.sourcesMap = options.sourcesMap || new Map();
  }

  public getMaxScoresPerRun(): number {
    return this.maxScoresPerRun;
  }

  private getLlmService(): any {
    return typeof this.ctx?.get === 'function' ? this.ctx.get('llm') : this.ctx?.llm;
  }

  public isAvailable(): boolean {
    if (this.getLlmService()) return true;
    if (this.llmApiKey) return true;
    return false;
  }

  public getThresholds(): Thresholds {
    return this.thresholds;
  }

  public setSourcesMap(map: Map<string, SourceConfig>): void {
    this.sourcesMap = map;
  }

  public async evaluateItem(item: { title: string; summary?: string; raw_content?: string | null; source?: string }): Promise<EvaluatedBatchItem | null> {
    if (!this.isAvailable()) return null;
    const res = await this.evaluateBatch([item as any]);
    return res[0] || null;
  }

  /**
   * Invokes LLM with system prompt (rubric) and user prompt.
   */
  public async callLlmRaw(systemPrompt: string, userPrompt: string): Promise<string | null> {
    if (!this.isAvailable()) return null;

    try {
      const llm = this.getLlmService();
      if (llm?.call) {
        return await llm.call({
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          model: this.llmModel,
          temperature: 0.2,
        });
      }

      if (this.llmApiKey) {
        const baseUrl = (this.llmBaseUrl || 'https://api.deepseek.com/v1').replace(/\/+$/, '');
        const bodyPayload: any = {
          model: this.llmModel,
          temperature: 0.2,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        };
        if (
          this.llmModel?.includes('gemini') ||
          this.llmModel?.includes('flash')
        ) {
          bodyPayload.reasoning_effort = 'low';
        }

        const res = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.llmApiKey}`,
          },
          body: JSON.stringify(bodyPayload),
          signal: AbortSignal.timeout(60000),
        });

        if (!res.ok) {
          console.warn(`[NewsEvaluator] LLM API responded with ${res.status}`);
          return null;
        }

        const data = (await res.json()) as any;
        return data?.choices?.[0]?.message?.content || null;
      }
    } catch (err) {
      console.warn('[NewsEvaluator] LLM call error:', err);
      return null;
    }
    return null;
  }

  /**
   * Evaluates an item by making scoreCalls serial requests, returning raw scores + matched topic IDs.
   * If ANY call fails, returns null (cannot use partial results).
   */
  public async scoreItemDetailed(
    item: {
      title: string;
      raw_content?: string | null;
      summary?: string;
      published_at?: string;
    },
    rubricText: string,
    opts: { scoreCalls?: number } = {}
  ): Promise<{ rawScores: number[]; topicMatch: string[] } | null> {
    if (!this.isAvailable()) {
      return null;
    }

    const callsCount = opts.scoreCalls ?? this.scoreCalls;
    const userPrompt = buildScoreInput(item);
    const rawScores: number[] = [];
    const topicSet = new Set<string>();

    for (let i = 0; i < callsCount; i++) {
      const rawResponse = await this.callLlmRaw(rubricText, userPrompt);
      if (!rawResponse) {
        return null; // Any failure aborts scoring for this item
      }

      const parsed = repairAndParseScoreResult(rawResponse);
      if (!parsed) {
        return null;
      }
      rawScores.push(parsed.score);
      for (const topicId of parsed.topic_match) {
        topicSet.add(topicId);
      }
    }

    return {
      rawScores,
      topicMatch: Array.from(topicSet),
    };
  }

  /**
   * Evaluates an item by making scoreCalls serial requests.
   * If ANY call fails, returns null (cannot use partial results).
   */
  public async scoreItem(
    item: {
      title: string;
      raw_content?: string | null;
      summary?: string;
      published_at?: string;
    },
    rubricText: string,
    opts: { scoreCalls?: number } = {}
  ): Promise<number[] | null> {
    const res = await this.scoreItemDetailed(item, rubricText, opts);
    return res ? res.rawScores : null;
  }

  /**
   * Processes a batch of pending items up to maxScoresPerRun.
   */
  public async evaluateBatch(
    pendingItems: SignalItem[],
    opts: {
      scoreCalls?: number;
      rubricCwd?: string;
      isFollowUp?: boolean;
    } = {}
  ): Promise<EvaluatedBatchItem[]> {
    if (!this.isAvailable()) {
      return [];
    }

    const rubricText = loadRubric(opts.rubricCwd);
    const promptVersion = `selection-score@${rubricVersion(rubricText)}`;
    const toProcess = pendingItems.slice(0, this.maxScoresPerRun);
    const results: EvaluatedBatchItem[] = [];

    for (const item of toProcess) {
      const rawScores = await this.scoreItem(item, rubricText, opts);
      if (!rawScores || rawScores.length === 0) {
        // Any failure leaves item in pending
        continue;
      }

      const sum = rawScores.reduce((acc, s) => acc + s, 0);
      const mean = Math.floor(sum / rawScores.length);

      // Determine source tier from sourcesMap
      const sourceConfig = this.sourcesMap.get(item.source);
      const tier = (sourceConfig as any)?.tier || 'default';

      const adjustedRes = adjustScore(mean, {
        tier,
        isFollowUp: opts.isFollowUp,
      });

      const isSTier = adjustedRes.adjusted >= this.thresholds.sTierScore;

      results.push({
        url_key: item.url_key,
        rawScores,
        mean,
        adjusted: adjustedRes.adjusted,
        source_weight: adjustedRes.source_weight,
        tracking_penalty: adjustedRes.tracking_penalty,
        is_s_tier: isSTier,
        prompt_version: promptVersion,
        status: 'scored',
      });
    }

    return results;
  }
}
