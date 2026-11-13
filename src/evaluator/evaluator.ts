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
  llmProvider?: string;
  llmTimeoutMs?: number;
  maxScoresPerRun?: number;
  scoreCalls?: number;
  thresholds?: Partial<Thresholds>;
  sourcesMap?: Map<string, SourceConfig>;
}

/**
 * How the evaluator reaches a model. `host-stream` drives the DSH LLM runtime
 * (no user configuration required), `host-call` is the legacy
 * `ctx.llm.call()` shape some older hosts exposed, `fetch` posts straight to an
 * OpenAI-compatible endpoint, and `none` means scoring cannot run at all.
 */
export type LlmBackend = 'host-stream' | 'host-call' | 'fetch' | 'none';

/** Last failure observed by {@link NewsEvaluator}, surfaced through health. */
export interface LlmDiagnostics {
  backend: LlmBackend;
  route?: { provider: string; model: string };
  last_error?: string;
  last_error_at?: string;
  failed_calls: number;
  ok_calls: number;
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
  private llmModel?: string;
  private llmProvider?: string;
  private maxScoresPerRun: number;
  private scoreCalls: number;
  private llmTimeoutMs: number;
  private thresholds: Thresholds;
  private sourcesMap: Map<string, SourceConfig>;
  private diagnostics: LlmDiagnostics = {
    backend: 'none',
    failed_calls: 0,
    ok_calls: 0,
  };
  /** Resolved host route, cached after the first successful resolution. */
  private routeCache?: { provider: string; model: string };

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
    // No hard-coded default model: a wrong model name makes every call fail
    // silently. The host default route is preferred, then explicit config.
    this.llmModel =
      options.llmModel ||
      process.env.AI_NEWS_LLM_MODEL ||
      undefined;
    this.llmProvider =
      options.llmProvider ||
      process.env.AI_NEWS_LLM_PROVIDER ||
      undefined;
    this.maxScoresPerRun = options.maxScoresPerRun ?? DEFAULT_MAX_SCORES_PER_RUN;
    this.llmTimeoutMs = options.llmTimeoutMs ?? 60_000;
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

  /** The host service that owns the user's selected default model, if any. */
  private getDefaultModelService(): any {
    return typeof this.ctx?.get === 'function'
      ? this.ctx.get('agentDefaultModel')
      : this.ctx?.agentDefaultModel;
  }

  /**
   * Pick the transport that can actually run. The host `llm` service is a
   * streaming runtime (`prepareCall` + `stream`); it never exposed `call()`, so
   * probing only for the service's existence reported "available" while every
   * score silently failed.
   */
  public getBackend(): LlmBackend {
    const llm = this.getLlmService();
    if (llm && typeof llm.prepareCall === 'function' && typeof llm.stream === 'function') {
      return 'host-stream';
    }
    if (llm && typeof llm.call === 'function') {
      return 'host-call';
    }
    if (this.llmApiKey) {
      return 'fetch';
    }
    return 'none';
  }

  public isAvailable(): boolean {
    return this.getBackend() !== 'none';
  }

  public getDiagnostics(): LlmDiagnostics {
    const backend = this.getBackend();
    return {
      ...this.diagnostics,
      backend,
      route: this.routeCache,
    };
  }

  private recordFailure(err: unknown): void {
    this.diagnostics.failed_calls += 1;
    this.diagnostics.last_error =
      err instanceof Error ? err.message : String(err);
    this.diagnostics.last_error_at = new Date().toISOString();
    console.warn('[NewsEvaluator] LLM call failed:', this.diagnostics.last_error);
  }

  /**
   * Resolve the exact provider/model route to call on the host runtime.
   * Preference: explicit config, then the host's default model selection, then
   * the single registered provider's own model list.
   */
  private async resolveRoute(): Promise<{ provider: string; model: string }> {
    if (this.routeCache) return this.routeCache;

    const llm = this.getLlmService();
    const configured =
      this.llmProvider && this.llmModel
        ? { provider: this.llmProvider, model: this.llmModel }
        : undefined;

    let route = configured;
    if (!route) {
      const selection = this.getDefaultModelService()?.currentSelection?.();
      if (selection?.provider && selection?.model) {
        route = { provider: selection.provider, model: selection.model };
      }
    }
    if (!route && this.llmProvider && !this.llmModel) {
      route = { provider: this.llmProvider, model: undefined as any };
    }
    if (!route && this.llmModel && !this.llmProvider) {
      // Find the provider that actually serves this model.
      const provider = await this.findProviderForModel(this.llmModel);
      if (provider) route = { provider, model: this.llmModel };
    }
    if (!route && typeof llm?.listProviders === 'function') {
      const providers = llm.listProviders();
      if (providers.length === 1) {
        const models = await this.listProviderModels(providers[0].id);
        if (models.length > 0) route = { provider: providers[0].id, model: models[0] };
      }
    }
    if (!route?.provider || !route?.model) {
      throw new Error(
        'no LLM route available: set llmModel/llmProvider in the plugin config, or select a default model in DSH'
      );
    }
    this.routeCache = route;
    return route;
  }

  private async listProviderModels(provider: string): Promise<string[]> {
    const llm = this.getLlmService();
    try {
      const models = await llm.listModels(provider);
      return (models || [])
        .map((m: any) => (typeof m === 'string' ? m : m?.id))
        .filter((id: any): id is string => typeof id === 'string' && id.length > 0);
    } catch {
      return [];
    }
  }

  private async findProviderForModel(model: string): Promise<string | undefined> {
    const llm = this.getLlmService();
    if (typeof llm?.listProviders !== 'function') return undefined;
    for (const provider of llm.listProviders()) {
      const models = await this.listProviderModels(provider.id);
      if (models.includes(model)) return provider.id;
    }
    return undefined;
  }

  /** Call the DSH LLM runtime through its real streaming API. */
  private async callHostStream(
    systemPrompt: string,
    userPrompt: string
  ): Promise<string | null> {
    const llm = this.getLlmService();
    const route = await this.resolveRoute();
    const signal = AbortSignal.timeout(this.llmTimeoutMs);

    const call = await llm.prepareCall(
      {
        provider: route.provider,
        model: route.model,
        temperature: 0.2,
      },
      signal
    );

    const options = {
      ...call.config,
      messages: [
        {
          id: `ai-news-feed-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          role: 'user' as const,
          content: [{ type: 'text' as const, text: userPrompt }],
          source: { kind: 'ai-news-feed' },
        },
      ],
      system: systemPrompt,
      purpose: 'ai-news-feed-score',
      signal,
    };

    let text = '';
    for await (const chunk of call.stream(options)) {
      if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') {
        text += chunk.text;
      } else if (chunk?.type === 'finish') {
        const reason = chunk.reason;
        if (reason?.kind === 'error') {
          const failure = reason.failure;
          throw new Error(
            `host LLM stream failed: ${failure?.message || failure?.code || 'unknown'}`
          );
        }
        if (reason?.kind === 'aborted') {
          throw new Error('host LLM stream aborted');
        }
      }
    }

    const trimmed = text.trim();
    return trimmed.length > 0 ? trimmed : null;
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
    const backend = this.getBackend();
    if (backend === 'none') {
      this.recordFailure(
        new Error(
          'no LLM backend: the host exposes neither a streaming llm service nor llmApiKey'
        )
      );
      return null;
    }
    if (backend === 'fetch' && !this.llmModel) {
      this.recordFailure(
        new Error('llmApiKey is set but llmModel is empty; configure llmModel')
      );
      return null;
    }

    try {
      const text = await this.callWithBackend(backend, systemPrompt, userPrompt);
      if (!text) {
        this.recordFailure(new Error('LLM returned an empty response'));
        return null;
      }
      this.diagnostics.ok_calls += 1;
      this.diagnostics.last_error = undefined;
      this.diagnostics.last_error_at = undefined;
      return text;
    } catch (err) {
      this.recordFailure(err);
      return null;
    }
  }

  private async callWithBackend(
    backend: LlmBackend,
    systemPrompt: string,
    userPrompt: string
  ): Promise<string | null> {
    if (backend === 'host-stream') {
      return await this.callHostStream(systemPrompt, userPrompt);
    }
    if (backend === 'host-call') {
      const llm = this.getLlmService();
      return await llm.call({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        model: this.llmModel,
        temperature: 0.2,
      });
    }
    return await this.callFetch(systemPrompt, userPrompt);
  }

  /** POST straight to an OpenAI-compatible `/chat/completions` endpoint. */
  private async callFetch(
    systemPrompt: string,
    userPrompt: string
  ): Promise<string | null> {
    const baseUrl = (this.llmBaseUrl || 'https://api.deepseek.com/v1').replace(/\/+$/, '');
    const bodyPayload: any = {
      model: this.llmModel,
      temperature: 0.2,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    };
    if (this.llmModel?.includes('gemini') || this.llmModel?.includes('flash')) {
      bodyPayload.reasoning_effort = 'low';
    }

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.llmApiKey}`,
      },
      body: JSON.stringify(bodyPayload),
      signal: AbortSignal.timeout(this.llmTimeoutMs),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(
        `LLM API responded with ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`
      );
    }

    const data = (await res.json()) as any;
    return data?.choices?.[0]?.message?.content || null;
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
