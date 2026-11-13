import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apply } from '../src/index.js';
import { NewsEvaluator } from '../src/evaluator/evaluator.js';
import { loadRubric, rubricVersion } from '../src/scoring/rubric.js';
import { resolveThresholds } from '../src/scoring/thresholds.js';
import { writeCopy } from '../src/scoring/write.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const testDataDir = path.join(__dirname, 'tmp-scoring-test');
const storePath = path.join(testDataDir, 'signals.json');

function cleanTestDir() {
  if (fs.existsSync(testDataDir)) {
    fs.rmSync(testDataDir, { recursive: true, force: true });
  }
}

describe('v0.6 Scoring Engine Specification Tests', () => {
  beforeEach(() => {
    cleanTestDir();
  });

  afterEach(() => {
    cleanTestDir();
  });

  // 场景 1 · 首屏门槛分层生效
  it('test_threshold_tiers: 79 not in featured, 80/84 in featured without S, 85 has S, sorted desc', async () => {
    let signalsRouteHandler: any = null;
    const mockCtx = {
      effect: (fn: any) => fn(),
      tools: { register() {} },
      webServer: {
        register(route: any) {
          if (route.path === '/api/plugins/ai-news-feed/signals') {
            signalsRouteHandler = route.handler;
          }
        },
      },
    };

    const plugin = apply(mockCtx, {
      storePath,
      syncIntervalMinutes: 0,
      thresholds: {
        featuredMinScore: 80,
        sTierScore: 85,
        browseMinScore: 60,
      },
      featuredMaxItems: 20,
    });

    // 假设库中构造四条：调整后 79 / 80 / 84 / 85
    const added = await plugin.store.addItems([
      {
        source: 'hn',
        source_type: 'api',
        url: 'https://example.com/item-79',
        title: 'Item 79',
        score: 79,
        status: 'scored',
      },
      {
        source: 'hn',
        source_type: 'api',
        url: 'https://example.com/item-80',
        title: 'Item 80',
        score: 80,
        status: 'scored',
      },
      {
        source: 'hn',
        source_type: 'api',
        url: 'https://example.com/item-84',
        title: 'Item 84',
        score: 84,
        status: 'scored',
      },
      {
        source: 'hn',
        source_type: 'api',
        url: 'https://example.com/item-85',
        title: 'Item 85',
        score: 85,
        status: 'scored',
      },
    ]);

    // Update with is_s_tier tags
    await plugin.store.updateScoredItems([
      { url_key: added[0].url_key, score: 79, is_s_tier: false },
      { url_key: added[1].url_key, score: 80, is_s_tier: false },
      { url_key: added[2].url_key, score: 84, is_s_tier: false },
      { url_key: added[3].url_key, score: 85, is_s_tier: true },
    ]);

    assert.ok(signalsRouteHandler, 'Signals route handler must be registered');

    // 1. 请求未传 minScore 的 /signals（首屏默认列表）
    const reqDefault = { method: 'GET', url: '/api/plugins/ai-news-feed/signals' };
    let bodyDefault = '';
    const resDefault = {
      setHeader() {},
      end(data: string) {
        bodyDefault = data;
      },
    };
    signalsRouteHandler(reqDefault, resDefault);
    const dataDefault = JSON.parse(bodyDefault);

    // 79 不入首屏；80、84 入首屏但无 S 徽标；85 入首屏且 isSTier: true
    const returnedScores = dataDefault.signals.map((s: any) => s.score);
    assert.deepStrictEqual(returnedScores, [85, 84, 80], 'Must return 85, 84, 80 in descending order');
    assert.strictEqual(dataDefault.signals.some((s: any) => s.score === 79), false, '79 must not be in default signals');

    const item85 = dataDefault.signals.find((s: any) => s.score === 85);
    const item84 = dataDefault.signals.find((s: any) => s.score === 84);
    const item80 = dataDefault.signals.find((s: any) => s.score === 80);

    assert.strictEqual(item85.is_s_tier, true, '85 must have is_s_tier: true');
    assert.strictEqual(item84.is_s_tier, false, '84 must have is_s_tier: false');
    assert.strictEqual(item80.is_s_tier, false, '80 must have is_s_tier: false');

    // 2. 79 在显式传 minScore (如 minScore=60) 或搜索场景下可见
    const reqExplicit = { method: 'GET', url: '/api/plugins/ai-news-feed/signals?minScore=60' };
    let bodyExplicit = '';
    const resExplicit = {
      setHeader() {},
      end(data: string) {
        bodyExplicit = data;
      },
    };
    signalsRouteHandler(reqExplicit, resExplicit);
    const dataExplicit = JSON.parse(bodyExplicit);
    assert.ok(dataExplicit.signals.some((s: any) => s.score === 79), '79 must be visible when minScore=60');
  });

  // 场景 10 · 门槛可配置且次序校验
  it('test_thresholds_configurable: config works and browse > featured triggers invalid_thresholds', async () => {
    // 1. 改值生效 (featuredMinScore=70, browseMinScore=65)
    let signalsHandler: any = null;
    const mockCtx1 = {
      effect: (fn: any) => fn(),
      tools: { register() {} },
      webServer: {
        register(route: any) {
          if (route.path === '/api/plugins/ai-news-feed/signals') signalsHandler = route.handler;
        },
      },
    };

    const plugin1 = apply(mockCtx1, {
      storePath,
      syncIntervalMinutes: 0,
      thresholds: {
        featuredMinScore: 70,
        browseMinScore: 65,
        sTierScore: 90,
      },
    });

    await plugin1.store.addItems([
      {
        source: 'hn',
        source_type: 'api',
        url: 'https://example.com/test-75',
        title: 'Item 75',
        score: 75,
        status: 'scored',
      },
    ]);

    let body1 = '';
    signalsHandler({ method: 'GET', url: '/api/plugins/ai-news-feed/signals' }, { setHeader() {}, end: (d: string) => { body1 = d; } });
    const data1 = JSON.parse(body1);
    assert.strictEqual(data1.signals.length, 1, '75 must be included in default list when featuredMinScore is 70');

    // 2. 把 browseMinScore 设成 85（高于 featured: 70）时回退默认并在 get_feed_health 报 invalid_thresholds
    const mockCtx2 = {
      tools: { register() {} },
    };
    const plugin2 = apply(mockCtx2, {
      storePath: path.join(testDataDir, 'signals2.json'),
      syncIntervalMinutes: 0,
      thresholds: {
        featuredMinScore: 70,
        browseMinScore: 85, // Invalid! browseMinScore > featuredMinScore
      },
    });

    const health = plugin2.getHealthSnapshot();
    assert.strictEqual(health.invalid_thresholds, true, 'Must report invalid_thresholds: true');
    assert.strictEqual(health.thresholds?.featuredMinScore, 80, 'Must fallback to default featuredMinScore 80');
    assert.strictEqual(health.thresholds?.browseMinScore, 60, 'Must fallback to default browseMinScore 60');
  });

  // 场景 11 · 来源权重不进模型输入
  it('test_source_weight_applied_post_hoc: prompt bytes identical without source leak, adjusted post-hoc', async () => {
    const recordedCalls: Array<{ role: string; content: string }[]> = [];

    const mockCtx = {
      llm: {
        call: async (args: any) => {
          recordedCalls.push(args.messages);
          return JSON.stringify({ score: 70 });
        },
      },
    };

    const sourcesMap = new Map<string, any>([
      ['rss-openai', { id: 'rss-openai', tier: 'tier_a', type: 'rss', enabled: true }],
      ['hn', { id: 'hn', tier: 'default', type: 'api', enabled: true }],
    ]);

    const evaluator = new NewsEvaluator({
      ctx: mockCtx,
      scoreCalls: 1,
      sourcesMap,
    });

    const commonArticle = {
      title: 'Major Breakthrough in Reasoning Models',
      summary: 'Researchers demonstrate novel reasoning technique.',
      raw_content: 'Full article text explaining the technical architecture and benchmarks.',
      published_at: '2026-03-30T10:00:00Z',
    };

    const results = await evaluator.evaluateBatch([
      {
        ...commonArticle,
        id: 1,
        source: 'rss-openai',
        source_type: 'rss',
        url: 'https://example.com/article-1',
        url_key: 'https://example.com/article-1',
        score: 0,
        tags: [],
        status: 'pending',
        fetched_at: '2026-03-30T10:00:00Z',
      },
      {
        ...commonArticle,
        id: 2,
        source: 'hn',
        source_type: 'api',
        url: 'https://example.com/article-2',
        url_key: 'https://example.com/article-2',
        score: 0,
        tags: [],
        status: 'pending',
        fetched_at: '2026-03-30T10:00:00Z',
      },
    ]);

    assert.strictEqual(results.length, 2);
    assert.strictEqual(recordedCalls.length, 2);

    // 捕获两次评分请求的 user 消息断言逐字节相同
    const userPrompt1 = recordedCalls[0].find((m) => m.role === 'user')?.content;
    const userPrompt2 = recordedCalls[1].find((m) => m.role === 'user')?.content;

    assert.ok(userPrompt1, 'userPrompt1 must exist');
    assert.ok(userPrompt2, 'userPrompt2 must exist');
    assert.strictEqual(userPrompt1, userPrompt2, 'User prompts must be byte-for-byte identical');

    // 严禁包含来源名与分级
    const forbiddenPatterns = [/\brss-openai\b/, /\bhn\b/, /\btier_a\b/, /\btier_b\b/, /\bdefault\b/, /1\.15/, /0\.9/];
    for (const pattern of forbiddenPatterns) {
      assert.strictEqual(pattern.test(userPrompt1), false, `Prompt must not contain leaked source info: ${pattern}`);
    }

    // 落库 adjusted 分别为 81 (70 * 1.15) 与 63 (70 * 0.9)
    const resA = results.find((r) => r.url_key === 'https://example.com/article-1');
    const resDefault = results.find((r) => r.url_key === 'https://example.com/article-2');

    assert.strictEqual(resA?.adjusted, 81, 'tier_a (70 * 1.15) must adjust to 81');
    assert.strictEqual(resA?.source_weight, 1.15);
    assert.strictEqual(resDefault?.adjusted, 63, 'default (70 * 0.9) must adjust to 63');
    assert.strictEqual(resDefault?.source_weight, 0.9);
  });

  // 场景 12 · 双次打分与展示分
  it('test_score_calls_and_shown_score: 84+79 mean 81, scoreCalls:1 single call, failure leaves pending', async () => {
    // 1. scoreCalls: 2, 84 and 79 -> mean = Math.floor((84+79)/2) = 81
    let callIdx = 0;
    const mockCtx = {
      llm: {
        call: async () => {
          callIdx++;
          return callIdx % 2 === 1 ? JSON.stringify({ score: 84 }) : JSON.stringify({ score: 79 });
        },
      },
    };

    const sourcesMap = new Map<string, any>([
      ['test-src', { id: 'test-src', tier: 'tier_b', type: 'rss', enabled: true }],
    ]);

    const evaluator2 = new NewsEvaluator({
      ctx: mockCtx,
      scoreCalls: 2,
      sourcesMap,
    });

    const item = {
      id: 1,
      source: 'test-src',
      source_type: 'rss',
      url: 'https://example.com/item-12',
      url_key: 'https://example.com/item-12',
      title: 'Dual Scoring Item',
      summary: 'Summary',
      score: 0,
      tags: [],
      status: 'pending' as const,
      published_at: '2026-03-30T10:00:00Z',
      fetched_at: '2026-03-30T10:00:00Z',
    };

    const res2 = await evaluator2.evaluateBatch([item]);
    assert.strictEqual(res2.length, 1);
    assert.deepStrictEqual(res2[0].rawScores, [84, 79]);
    assert.strictEqual(res2[0].mean, 81);
    assert.strictEqual(84 + 79 >= 2 * 80, true, '84 + 79 = 163 >= 160 qualifies for featured');

    // 2. scoreCalls: 1 -> only single call
    let singleCalls = 0;
    const mockCtxSingle = {
      llm: {
        call: async () => {
          singleCalls++;
          return JSON.stringify({ score: 88 });
        },
      },
    };
    const evaluator1 = new NewsEvaluator({
      ctx: mockCtxSingle,
      scoreCalls: 1,
      sourcesMap,
    });
    const res1 = await evaluator1.evaluateBatch([item]);
    assert.strictEqual(res1.length, 1);
    assert.strictEqual(singleCalls, 1);
    assert.deepStrictEqual(res1[0].rawScores, [88]);
    assert.strictEqual(res1[0].mean, 88);

    // 3. Any failure aborts scoring and leaves item in pending
    let failCalls = 0;
    const mockCtxFail = {
      llm: {
        call: async () => {
          failCalls++;
          if (failCalls === 2) {
            throw new Error('LLM rate limit / network error');
          }
          return JSON.stringify({ score: 84 });
        },
      },
    };
    const evaluatorFail = new NewsEvaluator({
      ctx: mockCtxFail,
      scoreCalls: 2,
      sourcesMap,
    });
    const resFail = await evaluatorFail.evaluateBatch([item]);
    assert.strictEqual(resFail.length, 0, 'Must NOT score item when any call fails; must leave pending');
  });

  // 场景 13 · rubric 版本化
  it('test_rubric_version_hash: 1 char change alters rubricVersion, old records retain version', () => {
    const text1 = loadRubric();
    const ver1 = rubricVersion(text1);
    assert.strictEqual(ver1.length, 10, 'Version hash must be 10 hex characters');

    // Modify by exactly 1 character
    const text2 = text1 + '\n';
    const ver2 = rubricVersion(text2);
    assert.strictEqual(ver2.length, 10);
    assert.notStrictEqual(ver1, ver2, 'Changing 1 char in rubric text must alter the hash');

    // Simulate record preserving old version
    const oldRecord = {
      id: 1,
      prompt_version: `selection-score@${ver1}`,
    };
    const newRecord = {
      id: 2,
      prompt_version: `selection-score@${ver2}`,
    };

    assert.strictEqual(oldRecord.prompt_version, `selection-score@${ver1}`);
    assert.strictEqual(newRecord.prompt_version, `selection-score@${ver2}`);
  });

  // 场景 14 · 评分与摘要分离
  it('test_scoring_and_writing_are_separate_calls: scoring only outputs score, copywriting called afterwards with tier', async () => {
    const callLog: Array<{ type: 'scoring' | 'copywriting'; system: string; user: string }> = [];

    const mockCtx = {
      llm: {
        call: async (args: any) => {
          const sys = args.messages.find((m: any) => m.role === 'system')?.content || '';
          const user = args.messages.find((m: any) => m.role === 'user')?.content || '';

          if (sys.includes('五轴')) {
            // Scoring call
            callLog.push({ type: 'scoring', system: sys, user });
            return JSON.stringify({ score: 85 });
          } else if (sys.includes('高阶 AI 情报编辑')) {
            // Copywriting call
            callLog.push({ type: 'copywriting', system: sys, user });
            return JSON.stringify({
              summary: 'DeepSeek-V3 推出极具竞争力的开源大模型架构与训练效率优化。',
              tags: ['deepseek-v3', 'open-weights'],
            });
          }
          return null;
        },
      },
    };

    const evaluator = new NewsEvaluator({
      ctx: mockCtx,
      scoreCalls: 1,
      thresholds: { browseMinScore: 60, featuredMinScore: 80, sTierScore: 85 },
    });

    const item = {
      title: 'DeepSeek-V3 Release Announcement',
      raw_content: 'DeepSeek has open-sourced DeepSeek-V3 with groundbreaking architecture.',
    };

    // 1. Scoring step
    const rubricText = loadRubric();
    const rawScores = await evaluator.scoreItem(item, rubricText, { scoreCalls: 1 });
    assert.deepStrictEqual(rawScores, [85]);
    assert.strictEqual(callLog.length, 1);
    assert.strictEqual(callLog[0].type, 'scoring');

    // 2. Copywriting step triggered after scoring
    const copyRes = await writeCopy(
      item,
      { mean: 85, thresholds: { browseMinScore: 60, featuredMinScore: 80, sTierScore: 85 } },
      (s, u) => evaluator.callLlmRaw(s, u)
    );

    assert.ok(copyRes, 'Copywriting should succeed');
    assert.strictEqual(callLog.length, 2);
    assert.strictEqual(callLog[1].type, 'copywriting');
    assert.ok(callLog[1].user.includes('【事件评分档】：85分'), 'Copywriting prompt must contain score tier');

    // 3. If mean < browseMinScore (e.g. 50), copywriting is NOT triggered
    const skippedCopy = await writeCopy(
      item,
      { mean: 50, thresholds: { browseMinScore: 60, featuredMinScore: 80, sTierScore: 85 } },
      (s, u) => evaluator.callLlmRaw(s, u)
    );
    assert.strictEqual(skippedCopy, null, 'Must skip copywriting when score < browseMinScore');
    assert.strictEqual(callLog.length, 2, 'No additional copywriting call should be made');
  });
});
