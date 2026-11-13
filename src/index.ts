import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import type { PluginConfig, SignalItem, FeedHealthItem, FeedHealthSnapshot, SyncProgress } from './types.js';
import { JsonStore, isDigestItem } from './store/json-store.js';
import { IngestorManager } from './ingestor/manager.js';
import { fetchArticleContent } from './ingestor/article.js';
import { toLocalDateString } from './ingestor/aihot-digest.js';
import { NewsEvaluator, DEFAULT_MAX_SCORES_PER_RUN } from './evaluator/evaluator.js';
import { loadRubric, rubricVersion, buildRubricWithTopics } from './scoring/rubric.js';
import { resolveThresholds, resolveFeaturedMaxItems } from './scoring/thresholds.js';
import { writeCopy } from './scoring/write.js';
import { sourceWeight, adjustScore } from './scoring/adjust.js';
import { resolveTopics } from './scoring/topics.js';
import { BudgetTracker } from './scoring/budget.js';
import { ScheduleManager } from './schedule/manager.js';
import { getBriefingPrompt } from './schedule/prompt.js';

export const name = 'ai-news-feed';
export const inject = ['tools'];

export function resolveDataDir(_ctx: any, config: PluginConfig): string {
  // 1. Explicit storePath in config (or legacy signalsDbPath alias)
  const explicitStorePath = config.storePath || config.signalsDbPath;
  if (explicitStorePath) {
    return path.dirname(explicitStorePath);
  }

  // 2. Explicit dataDir in config (or legacy dailyNewsDir alias)
  const explicitDataDir = config.dataDir || config.dailyNewsDir;
  if (explicitDataDir) {
    return explicitDataDir;
  }

  // 3. Environment variable override
  if (process.env.AI_NEWS_DATA_DIR) {
    return process.env.AI_NEWS_DATA_DIR;
  }

  // 4. In DSH desktop environment, locate standard ~/.dsh user storage
  const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  if (fs.existsSync(dshHome)) {
    return path.join(dshHome, 'storages', 'ai-news-feed');
  }

  // 5. Default fallback to local process data folder
  return path.resolve(process.cwd(), 'data');
}

export function apply(ctx: any, config: PluginConfig = {}) {
  const dataDir = resolveDataDir(ctx, config);
  const storePath = config.storePath || path.join(dataDir, 'signals.json');
  const sourcesPath = path.join(dataDir, 'sources.yaml');
  const budgetPath = path.join(dataDir, 'budget.json');
  const prefsPath = path.join(dataDir, 'preferences.json');

  // Resolve v0.6 thresholds & v0.9/v1.0 display / appearance / article hydration / topic parameters
  const thresholdRes = resolveThresholds(config.thresholds);
  const featuredMaxItems = resolveFeaturedMaxItems(config.featuredMaxItems);
  const scoreCalls = config.scoreCalls || 2;
  const maxScoresPerRun = config.maxScoresPerRun ?? DEFAULT_MAX_SCORES_PER_RUN;
  const appearance = config.appearance ?? 'auto';
  const VALID_LANGUAGES = new Set(['auto', 'zh', 'en']);

  function readPreferences(): Record<string, any> {
    try {
      if (fs.existsSync(prefsPath)) {
        const parsed = JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed;
        }
      }
    } catch {
      // ignore corrupted preferences
    }
    return {};
  }

  function writePreferences(patch: Record<string, any>): Record<string, any> {
    const current = readPreferences();
    const merged = {
      ...current,
      ...patch,
      updated_at: new Date().toISOString(),
    };
    try {
      const dir = path.dirname(prefsPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(prefsPath, JSON.stringify(merged, null, 2), 'utf8');
    } catch {
      // ignore persistence errors
    }
    return merged;
  }

  const initialPrefs = readPreferences();
  let displayLanguage: 'zh' | 'en' | 'auto' =
    config.display?.language !== undefined && VALID_LANGUAGES.has(config.display.language)
      ? config.display.language
      : typeof initialPrefs.language === 'string' && VALID_LANGUAGES.has(initialPrefs.language)
        ? (initialPrefs.language as 'zh' | 'en' | 'auto')
        : 'auto';

  let activeTopics = resolveTopics(
    config.display?.topics !== undefined
      ? config.display.topics
      : Array.isArray(initialPrefs.topics)
        ? initialPrefs.topics
        : undefined
  );

  const getEffectiveRubric = () => buildRubricWithTopics(activeTopics, loadRubric());
  const getPromptVersion = () => `selection-score@${rubricVersion(getEffectiveRubric())}`;

  const fetchArticleCfg = {
    enabled: config.fetchArticle?.enabled ?? true,
    timeoutMs: config.fetchArticle?.timeoutMs ?? 5000,
    minContentChars: config.fetchArticle?.minContentChars ?? 400,
  };

  // Initialize Budget Tracker (default 120 calls/day)
  const dailyModelCallBudget = config.dailyModelCallBudget ?? 120;
  const budgetTracker = new BudgetTracker(budgetPath, dailyModelCallBudget);

  // Initialize Schedule Manager for Briefings
  const scheduleManager = new ScheduleManager(ctx);

  // 1. Initialize Core Store & Ingestor & Evaluator
  const store = new JsonStore({
    storePath,
    maxItems: config.maxItems || 2000,
  });

  const ingestor = new IngestorManager(sourcesPath);
  const sourcesMap = new Map(ingestor.getSources().map((s) => [s.id, s]));

  const evaluator = new NewsEvaluator({
    ctx,
    llmBaseUrl: config.llmBaseUrl,
    llmApiKey: config.llmApiKey,
    llmModel: config.llmModel,
    maxScoresPerRun,
    scoreCalls,
    thresholds: thresholdRes.thresholds,
    sourcesMap,
  });

  // 2. Health tracking state
  const healthMap = new Map<string, FeedHealthItem>();
  for (const src of ingestor.getSources()) {
    healthMap.set(src.id, {
      id: src.id,
      type: src.type,
      enabled: src.enabled,
      success_count: 0,
      fail_count: 0,
      total_fetched: 0,
    });
  }

  let isSyncing = false;
  let currentSyncProgress: SyncProgress | undefined;
  let activeSyncPromise: Promise<void> | null = null;

  function getHealthSnapshot(): FeedHealthSnapshot {
    const sourcesRecord: Record<string, FeedHealthItem> = {};
    for (const [id, item] of healthMap.entries()) {
      sourcesRecord[id] = item;
    }

    const snapshot: FeedHealthSnapshot = {
      updated_at: new Date().toISOString(),
      sources: sourcesRecord,
      total_items: store.getItemsCount(),
      pending_items: store.getPendingCount(),
      scored_items: store.getScoredCount(),
      insufficient_content_items: store.getInsufficientContentCount(),
      store_path: store.getFilePath(),
      store_size_bytes: store.getFileSizeBytes(),
      llm_available: evaluator.isAvailable(),
      llm_state: evaluator.isAvailable() ? 'available' : 'missing',
      is_syncing: isSyncing,
      sync_progress: isSyncing ? currentSyncProgress : undefined,
      budget: budgetTracker.getSnapshot(),
      thresholds: thresholdRes.thresholds,
      featured_max_items: featuredMaxItems,
      score_calls: scoreCalls,
      prompt_version: getPromptVersion(),
      appearance,
      display: {
        language: displayLanguage,
        topics: [...activeTopics],
      },
      schedule: {
        available: scheduleManager.isAvailable(),
        reason: scheduleManager.isAvailable() ? undefined : 'Host has not mounted schedule service',
      },
    };

    if (thresholdRes.error === 'invalid_thresholds') {
      snapshot.invalid_thresholds = true;
    }

    return snapshot;
  }

  // 3. Execution Pipeline (Fetch -> Ingest -> Hydrate -> Evaluate)
  async function runSync(options: { sources?: string[]; forceScore?: boolean; skipIngest?: boolean } = {}) {
    if (isSyncing) {
      return { accepted: false, reason: 'Sync already in progress' };
    }
    isSyncing = true;
    const runId = `run_${Date.now()}`;

    const syncTask = (async () => {
      try {
        if (!options.skipIngest) {
          console.log(`[ai-news-feed] Starting ingestion run ${runId}...`);
          const { items, results } = await ingestor.syncAll(options.sources, (prog) => {
            currentSyncProgress = prog;
          });
          currentSyncProgress = undefined;

          // Update health stats
          for (const res of results) {
            const entry = healthMap.get(res.sourceId) || {
              id: res.sourceId,
              type: 'unknown',
              enabled: true,
              success_count: 0,
              fail_count: 0,
              total_fetched: 0,
            };
            if (res.success) {
              entry.success_count += 1;
              entry.total_fetched += res.items.length;
              entry.last_ok_at = new Date().toISOString();
            } else {
              entry.fail_count += 1;
              entry.last_error = res.error;
            }
            healthMap.set(res.sourceId, entry);
          }

          // Add to Store (Idempotent) with pre-computed source weight for unscored stream
          const itemsWithWeight = items.map((raw) => {
            const srcCfg = sourcesMap.get(raw.source);
            const weight = sourceWeight(srcCfg?.tier);
            return {
              ...raw,
              source_weight: weight,
            };
          });
          const added = await store.addItems(itemsWithWeight);
          console.log(`[ai-news-feed] Ingested ${items.length} raw items, ${added.length} new signals added`);
        }

        // Scoring step
        if (evaluator.isAvailable()) {
          const pending = store
            .querySignals({ sortByWeightAndDate: true, status: 'pending' })
            .filter((item) => !isDigestItem(item))
            .filter((item) => options.forceScore || item.skip_reason !== 'insufficient_content')
            .slice(0, maxScoresPerRun);
          if (pending.length > 0) {
            console.log(`[ai-news-feed] Evaluating ${pending.length} pending items with LLM...`);
            evaluator.setSourcesMap(new Map(ingestor.getSources().map((s) => [s.id, s])));

            const updates = [];
            for (const item of pending) {
              // W5.2: Hydrate raw_content from source URL if empty (idempotent)
              if (fetchArticleCfg.enabled && (!item.raw_content || !item.raw_content.trim())) {
                const fetched = await fetchArticleContent(item.url, {
                  timeoutMs: fetchArticleCfg.timeoutMs,
                });
                if (fetched && fetched.trim().length > 0) {
                  item.raw_content = fetched.trim();
                  await store.updatePendingItem(item.url_key, {
                    raw_content: item.raw_content,
                    skip_reason: null,
                  });
                }
              }

              // W5.3: Skip LLM scoring when effective content length is below threshold
              const effectiveBody = (item.raw_content || item.summary || '').trim();
              if (effectiveBody.length < fetchArticleCfg.minContentChars) {
                await store.updatePendingItem(item.url_key, {
                  skip_reason: 'insufficient_content',
                });
                continue;
              }

              // Cost guardrail: check daily model budget before scoring
              if (!budgetTracker.canSpend(scoreCalls)) {
                console.log('[ai-news-feed] Daily model call budget exhausted, aborting scoring for remaining items');
                break;
              }

              const effectiveRubric = getEffectiveRubric();
              const currentPromptVersion = getPromptVersion();
              const scoreRes = await evaluator.scoreItemDetailed(item, effectiveRubric, { scoreCalls });
              if (!scoreRes || scoreRes.rawScores.length === 0) {
                continue;
              }
              const rawScores = scoreRes.rawScores;
              const topicMatch = scoreRes.topicMatch;
              budgetTracker.recordSpend(scoreCalls, 0);

              const sum = rawScores.reduce((acc, s) => acc + s, 0);
              const mean = Math.floor(sum / rawScores.length);
              const sourceConfig = sourcesMap.get(item.source);
              const tier = (sourceConfig as any)?.tier || 'default';
              const adjustedRes = adjustScore(mean, {
                tier,
                topicMatch,
                activeTopics,
                sTierScore: thresholdRes.thresholds.sTierScore,
              });
              const isSTier = adjustedRes.is_s_tier;

              let summary: string | undefined;
              let tags: string[] | undefined;
              let titleZh: string | null | undefined;
              let titleEn: string | null | undefined;
              let whyItMatters: string | null | undefined;

              if (mean >= thresholdRes.thresholds.browseMinScore) {
                if (budgetTracker.canSpend(1)) {
                  const copyRes = await writeCopy(
                    item,
                    {
                      mean,
                      thresholds: thresholdRes.thresholds,
                      lang: displayLanguage === 'en' ? 'en' : 'zh',
                    },
                    (sys, user) => evaluator.callLlmRaw(sys, user)
                  );
                  if (copyRes) {
                    summary = copyRes.summary;
                    tags = copyRes.tags;
                    titleZh = copyRes.title_zh;
                    titleEn = copyRes.title_en;
                    whyItMatters = copyRes.why_it_matters;
                    budgetTracker.recordSpend(1, 1);
                  } else {
                    budgetTracker.recordSpend(0, 1);
                  }
                } else {
                  budgetTracker.recordSpend(0, 1);
                }
              } else {
                budgetTracker.recordSpend(0, 1);
              }

              updates.push({
                url_key: item.url_key,
                score: adjustedRes.adjusted,
                score_mean: mean,
                score_raw: rawScores,
                source_weight: adjustedRes.source_weight,
                tracking_penalty: adjustedRes.tracking_penalty,
                is_s_tier: isSTier,
                prompt_version: currentPromptVersion,
                title_zh: titleZh,
                title_en: titleEn,
                summary,
                tags,
                topic_match: topicMatch,
                topic_boost: adjustedRes.topic_boost,
                why_it_matters: whyItMatters,
                status: 'scored' as const,
              });
            }

            if (updates.length > 0) {
              await store.updateScoredItems(updates);
              console.log(`[ai-news-feed] Successfully scored ${updates.length} items`);
            }
          }
        } else {
          console.log('[ai-news-feed] LLM is not available, items remain in pending status');
        }
      } catch (err) {
        console.error(`[ai-news-feed] Sync ${runId} encountered unexpected error:`, err);
      } finally {
        isSyncing = false;
        currentSyncProgress = undefined;
        activeSyncPromise = null;
      }
    })();

    activeSyncPromise = syncTask;
    return { accepted: true, run_id: runId, timestamp: new Date().toISOString() };
  }

  async function readJsonBody(req: any): Promise<any> {
    if (req?.body && typeof req.body === 'object') {
      return req.body;
    }
    if (typeof req?.body === 'string') {
      try {
        return JSON.parse(req.body);
      } catch {
        return {};
      }
    }
    if (req && typeof req.on === 'function') {
      const raw = await new Promise<string>((resolve) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer | string) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', () => resolve(''));
      });
      if (!raw.trim()) return {};
      try {
        return JSON.parse(raw);
      } catch {
        return {};
      }
    }
    return {};
  }

  // 4. HTTP API Endpoints
  function registerWebServerRoutes(targetCtx: any, ws: any) {
    if (!ws || typeof ws.register !== 'function') return;

    const endpoints = [
      {
        paths: [
          '/dsh-plugins/ai-news-feed/signals',
          '/api/plugins/ai-news-feed/signals',
          '/ai-news-feed/signals',
        ],
        handler: (req: any, res: any) => {
          if (req.method !== 'GET') {
            res.statusCode = 405;
            res.end('Method Not Allowed');
            return;
          }
          const reqUrl = new URL(req.url, 'http://127.0.0.1');
          const minScoreParam = reqUrl.searchParams.get('minScore');
          const hasExplicitMinScore = minScoreParam !== null && minScoreParam !== '';
          const unscoredParam = reqUrl.searchParams.get('unscored');
          const streamParam = reqUrl.searchParams.get('stream');
          const groupByStatusParam = reqUrl.searchParams.get('groupByStatus');
          const category = reqUrl.searchParams.get('category') || undefined;
          const limitParam = reqUrl.searchParams.get('limit');
          const limit = limitParam ? Number(limitParam) : 50;

          if (streamParam === 'briefing') {
            const dateParam = reqUrl.searchParams.get('date') || toLocalDateString();
            const includeRead = reqUrl.searchParams.get('includeRead') === 'true';
            const signals = store.queryDailyBriefing({
              date: dateParam,
              includeRead,
              limit: limitParam ? limit : 5,
              featuredMinScore: thresholdRes.thresholds.featuredMinScore,
              digestMinScore: thresholdRes.thresholds.browseMinScore,
            });
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ total: signals.length, date: dateParam, signals }));
            return;
          }

          const isLatestStream = streamParam === 'latest' || groupByStatusParam === 'true';
          const isFallbackUnscored =
            unscoredParam === 'true' ||
            minScoreParam === '0' ||
            (store.getScoredCount() === 0 && !hasExplicitMinScore);

          let signals: SignalItem[];
          if (isLatestStream) {
            signals = store.querySignals({
              groupByStatus: true,
              limit,
              category,
              sTierScore: thresholdRes.thresholds.sTierScore,
            });
          } else if (isFallbackUnscored) {
            signals = store.querySignals({
              sortByWeightAndDate: true,
              limit,
              category,
              sTierScore: thresholdRes.thresholds.sTierScore,
            });
          } else if (!hasExplicitMinScore) {
            signals = store.querySignals({
              minScore: thresholdRes.thresholds.featuredMinScore,
              sortByScore: true,
              excludeDigest: true,
              limit: limitParam ? limit : featuredMaxItems,
              category,
              sTierScore: thresholdRes.thresholds.sTierScore,
            });
          } else {
            const minScore = Number(minScoreParam);
            signals = store.querySignals({
              minScore,
              sortByScore: true,
              excludeDigest: minScore >= thresholdRes.thresholds.sTierScore,
              limit,
              category,
              sTierScore: thresholdRes.thresholds.sTierScore,
            });
          }

          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ total: signals.length, signals }));
        },
      },
      {
        paths: [
          '/dsh-plugins/ai-news-feed/briefing',
          '/api/plugins/ai-news-feed/briefing',
          '/ai-news-feed/briefing',
        ],
        handler: (req: any, res: any) => {
          if (req.method !== 'GET') {
            res.statusCode = 405;
            res.end('Method Not Allowed');
            return;
          }
          const reqUrl = new URL(req.url, 'http://127.0.0.1');
          const dateParam = reqUrl.searchParams.get('date') || toLocalDateString();
          const includeRead = reqUrl.searchParams.get('includeRead') === 'true';
          const limitParam = reqUrl.searchParams.get('limit');
          const limit = limitParam ? Number(limitParam) : 5;
          const signals = store.queryDailyBriefing({
            date: dateParam,
            includeRead,
            limit,
            featuredMinScore: thresholdRes.thresholds.featuredMinScore,
            digestMinScore: thresholdRes.thresholds.browseMinScore,
          });
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ total: signals.length, date: dateParam, signals }));
        },
      },
      {
        paths: [
          '/dsh-plugins/ai-news-feed/mark-read',
          '/api/plugins/ai-news-feed/mark-read',
          '/ai-news-feed/mark-read',
        ],
        handler: async (req: any, res: any) => {
          if (req.method !== 'POST') {
            res.statusCode = 405;
            res.end('Method Not Allowed');
            return;
          }
          const body = await readJsonBody(req);
          const ids = Array.isArray(body?.ids) ? body.ids.map(Number) : [];
          const marked = await store.markRead(ids);
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ ok: true, marked }));
        },
      },
      {
        paths: [
          '/dsh-plugins/ai-news-feed/topics',
          '/api/plugins/ai-news-feed/topics',
          '/ai-news-feed/topics',
        ],
        handler: async (req: any, res: any) => {
          if (req.method !== 'POST') {
            res.statusCode = 405;
            res.end('Method Not Allowed');
            return;
          }
          const body = await readJsonBody(req);
          activeTopics = resolveTopics(Array.isArray(body?.topics) ? body.topics : []);
          writePreferences({ topics: activeTopics });
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ ok: true, topics: activeTopics, prompt_version: getPromptVersion() }));
        },
      },
      {
        paths: [
          '/dsh-plugins/ai-news-feed/language',
          '/api/plugins/ai-news-feed/language',
          '/ai-news-feed/language',
        ],
        handler: async (req: any, res: any) => {
          if (req.method !== 'POST') {
            res.statusCode = 405;
            res.end('Method Not Allowed');
            return;
          }
          const body = await readJsonBody(req);
          const lang = body?.language;
          if (typeof lang !== 'string' || !VALID_LANGUAGES.has(lang)) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ ok: false, error: 'invalid_language' }));
            return;
          }
          displayLanguage = lang as 'auto' | 'zh' | 'en';
          writePreferences({ language: displayLanguage });
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ ok: true, language: displayLanguage }));
        },
      },
      {
        paths: [
          '/dsh-plugins/ai-news-feed/health',
          '/api/plugins/ai-news-feed/health',
          '/ai-news-feed/health',
        ],
        handler: (req: any, res: any) => {
          if (req.method !== 'GET') {
            res.statusCode = 405;
            res.end('Method Not Allowed');
            return;
          }
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify(getHealthSnapshot()));
        },
      },
      {
        paths: [
          '/dsh-plugins/ai-news-feed/sync',
          '/api/plugins/ai-news-feed/sync',
          '/ai-news-feed/sync',
        ],
        handler: async (req: any, res: any) => {
          const result = await runSync();
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify(result));
        },
      },
    ];

    for (const ep of endpoints) {
      for (const p of ep.paths) {
        try {
          targetCtx.effect?.(() =>
            ws.register({
              kind: 'exact',
              path: p,
              handler: ep.handler,
            })
          );
        } catch {}
      }
    }
  }

  const syncWs = typeof ctx.get === 'function' ? ctx.get('webServer') : ctx.webServer;
  if (syncWs?.register) {
    registerWebServerRoutes(ctx, syncWs);
  }

  if (typeof ctx.inject === 'function') {
    try {
      ctx.inject(['webServer'], (hostCtx: any) => {
        const ws = hostCtx.webServer || (typeof hostCtx.get === 'function' ? hostCtx.get('webServer') : undefined);
        registerWebServerRoutes(hostCtx, ws);
      });
    } catch {}
  }

  // 5. Agent Tools Registration
  const DEFAULT_TOOL_OUTPUT = {
    schema: {
      type: 'object' as const,
    },
    render: (_args: unknown, value: any) => [
      {
        type: 'text' as const,
        text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
      },
    ],
  };

  if (ctx.tools?.register) {
    // 5.1 获取顶级资讯
    ctx.tools.register({
      name: 'get_top_ai_news',
      description: '获取近期高分 AI 资讯与前沿动态（来自内生自驱采集与大模型研判打分）。',
      output: DEFAULT_TOOL_OUTPUT,
      parameters: {
        limit: {
          type: 'number',
          description: '返回的新闻条数，默认 10 条',
          required: false,
        },
        minScore: {
          type: 'number',
          description: `最低相关度评分门槛（默认 ${thresholdRes.thresholds.featuredMinScore} 为精选门槛）`,
          required: false,
        },
        category: {
          type: 'string',
          description: '关键词或标签（如 deepseek, agent, llm, openai, anthropic）',
          required: false,
        },
      },
      execute: async (args: any) => {
        const minScore = args.minScore !== undefined ? Number(args.minScore) : thresholdRes.thresholds.featuredMinScore;
        const limit = args.limit ? Number(args.limit) : 10;
        const category = args.category;

        const totalCandidates = store.getItemsCount();
        const pendingCount = store.getPendingCount();
        const budgetSnapshot = budgetTracker.getSnapshot();
        const budgetRemainingPercent = budgetSnapshot.limit > 0
          ? Math.round((budgetSnapshot.remaining / budgetSnapshot.limit) * 100)
          : 0;

        const stats = {
          candidate_count: totalCandidates,
          pending_count: pendingCount,
          budget_remaining_percent: budgetRemainingPercent,
          budget_used: budgetSnapshot.used,
          budget_limit: budgetSnapshot.limit,
        };

        const results = store.querySignals({ minScore, limit, category, sortByScore: true });
        if (results.length === 0) {
          return {
            message: '近期未检索到匹配的 AI 动态。',
            total: 0,
            items: [],
            stats,
          };
        }

        return {
          total: results.length,
          stats,
          items: results.map((r) => ({
            id: r.id,
            source: r.source,
            title: r.title,
            score: r.score,
            score_mean: r.score_mean,
            is_s_tier: r.is_s_tier,
            summary: r.summary,
            tags: r.tags,
            url: r.url,
            published_at: r.published_at,
          })),
        };
      },
    });

    // 5.2 搜索资讯
    ctx.tools.register({
      name: 'search_ai_signals',
      description: '根据关键词全文检索 AI 信号库中的前沿文章与技术突破。',
      output: DEFAULT_TOOL_OUTPUT,
      parameters: {
        keyword: {
          type: 'string',
          description: '搜索关键词（如 DeepSeek-V3, reasoning, vllm）',
          required: true,
        },
        limit: {
          type: 'number',
          description: '最多返回条数，默认 10 条',
          required: false,
        },
      },
      execute: async (args: any) => {
        const keyword = String(args.keyword || '').trim();
        const limit = args.limit ? Number(args.limit) : 10;

        if (!keyword) {
          return { message: '请输入有效的检索关键词', items: [] };
        }

        const results = store.querySignals({ category: keyword, limit });
        return {
          keyword,
          total: results.length,
          items: results.map((r) => ({
            id: r.id,
            source: r.source,
            title: r.title,
            score: r.score,
            summary: r.summary,
            url: r.url,
            published_at: r.published_at,
          })),
        };
      },
    });

    // 5.3 触发原生同步
    ctx.tools.register({
      name: 'trigger_feed_sync',
      description: '立即触发 AI 新闻源的异步拉取与评分流水线。',
      output: DEFAULT_TOOL_OUTPUT,
      parameters: {
        sources: {
          type: 'array',
          items: { type: 'string' },
          description: '可选指定信源 ID 列表（如 ["hn", "rss-openai", "aihot"]），不传则同步所有已启用源',
          required: false,
        },
        forceScore: {
          type: 'boolean',
          description: '是否强制重新评分',
          required: false,
        },
      },
      execute: async (args: any) => {
        return runSync(args);
      },
    });

    // 5.4 获取信源健康状态
    ctx.tools.register({
      name: 'get_feed_health',
      description: '获取当前 AI 情报流订阅源的健康状态、成功率及存储统计。',
      output: DEFAULT_TOOL_OUTPUT,
      parameters: {},
      execute: async () => {
        return getHealthSnapshot();
      },
    });

    // 5.5 开启晨报与晚报（Path A 插件自注册）
    ctx.tools.register({
      name: 'enable_briefing',
      description: '为当前会话启用 AI 晨报与晚报定时提醒（利用宿主 schedule 服务原会话投递）。',
      output: DEFAULT_TOOL_OUTPUT,
      parameters: {
        morning: {
          type: 'string',
          description: '晨报推送时间，格式 HH:mm:ss，默认 08:00:00',
          required: false,
        },
        evening: {
          type: 'string',
          description: '晚报推送时间，格式 HH:mm:ss，默认 20:00:00',
          required: false,
        },
        timeZone: {
          type: 'string',
          description: 'IANA 时区名称（如 Asia/Shanghai），默认取系统时区',
          required: false,
        },
      },
      execute: async (args: any, context?: any) => {
        const sessionId =
          context?.agent?.sessionId ||
          context?.agent?.id ||
          context?.session?.id ||
          context?.sessionId ||
          args?.sessionId;

        return scheduleManager.enableBriefing(sessionId, args);
      },
    });

    // 5.6 关闭晨报与晚报
    ctx.tools.register({
      name: 'disable_briefing',
      description: '关闭当前会话的 AI 晨报与晚报定时提醒，解除会话归档拦截。',
      output: DEFAULT_TOOL_OUTPUT,
      parameters: {},
      execute: async (args: any, context?: any) => {
        const sessionId =
          context?.agent?.sessionId ||
          context?.agent?.id ||
          context?.session?.id ||
          context?.sessionId ||
          args?.sessionId;

        return scheduleManager.disableBriefing(sessionId);
      },
    });

    // 5.7 获取简报 Prompt 模板（Path B 降级与回归）
    ctx.tools.register({
      name: 'get_briefing_prompt',
      description: '获取标准的 AI 晨报或晚报生成 Prompt 模板（用于指导 Agent 结构化输出）。',
      output: DEFAULT_TOOL_OUTPUT,
      parameters: {
        kind: {
          type: 'string',
          enum: ['morning', 'evening'],
          description: '简报类型：morning（晨报）或 evening（晚报）',
          required: true,
        },
      },
      execute: async (args: any) => {
        const kind = args?.kind === 'evening' ? 'evening' : 'morning';
        return {
          kind,
          prompt: getBriefingPrompt(kind),
        };
      },
    });
  }

  // 6. Background Scheduled Sync
  const syncIntervalMinutes = config.syncIntervalMinutes ?? 60;
  const firstSyncDelaySeconds = config.firstSyncDelaySeconds ?? 5;

  if (syncIntervalMinutes > 0 && firstSyncDelaySeconds > 0) {
    // Initial sync delayed by firstSyncDelaySeconds (default 5s)
    const initialTimer = setTimeout(() => {
      runSync().catch((err) => console.warn('[ai-news-feed] Initial sync warning:', err));
    }, firstSyncDelaySeconds * 1000);

    ctx.effect?.(() => () => {
      clearTimeout(initialTimer);
    });
  }

  if (syncIntervalMinutes > 0) {
    const intervalTimer = setInterval(() => {
      runSync().catch((err) => console.warn('[ai-news-feed] Periodic sync warning:', err));
    }, syncIntervalMinutes * 60 * 1000);

    ctx.effect?.(() => () => {
      clearInterval(intervalTimer);
    });
  }

  return {
    store,
    ingestor,
    evaluator,
    budgetTracker,
    scheduleManager,
    runSync,
    waitForSync: () => activeSyncPromise || Promise.resolve(),
    getHealthSnapshot,
  };
}
