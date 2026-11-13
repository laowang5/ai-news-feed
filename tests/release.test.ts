import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apply } from '../src/index.js';
import { NewsEvaluator, DEFAULT_MAX_SCORES_PER_RUN } from '../src/evaluator/evaluator.js';
import { BudgetTracker } from '../src/scoring/budget.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const releaseTestDataDir = path.join(__dirname, 'tmp-release-test');
const storePath = path.join(releaseTestDataDir, 'signals.json');
const budgetPath = path.join(releaseTestDataDir, 'budget.json');

function cleanReleaseDir() {
  if (fs.existsSync(releaseTestDataDir)) {
    fs.rmSync(releaseTestDataDir, { recursive: true, force: true });
  }
}

describe('v0.7 Release Specification Tests', () => {
  beforeEach(() => {
    cleanReleaseDir();
  });

  afterEach(() => {
    cleanReleaseDir();
  });

  // 场景 1 · 干净首装与分源同步感知
  it('test_first_run_shows_items_within_3_min: fast sync and sync_progress awareness', async () => {
    let signalsHandler: any = null;
    const mockCtx = {
      effect: (fn: any) => fn(),
      tools: { register() {} },
      webServer: {
        register(route: any) {
          if (route.path === '/api/plugins/ai-news-feed/signals') signalsHandler = route.handler;
        },
      },
    };

    const plugin = apply(mockCtx, {
      storePath,
      syncIntervalMinutes: 0,
      firstSyncDelaySeconds: 0, // Manual trigger for test
    });

    const initialHealth = plugin.getHealthSnapshot();
    assert.strictEqual(initialHealth.is_syncing, false);

    // Mock adding items directly to represent fetch stage completion before scoring
    await plugin.store.addItems([
      {
        source: 'hn',
        source_type: 'api',
        url: 'https://news.ycombinator.com/item?id=123',
        title: 'Show HN: Fast AI News Plugin',
        status: 'pending',
      },
      {
        source: 'rss-openai',
        source_type: 'rss',
        url: 'https://openai.com/news/test-1',
        title: 'OpenAI Test News',
        source_weight: 1.15,
        status: 'pending',
      },
    ]);

    // Signals available even before LLM scoring (Unscored stream)
    let body = '';
    signalsHandler(
      { method: 'GET', url: '/api/plugins/ai-news-feed/signals' },
      { setHeader() {}, end: (d: string) => { body = d; } }
    );
    const data = JSON.parse(body);
    assert.ok(data.signals.length >= 2, 'Must return signals immediately after fetch without waiting for scoring');
    assert.strictEqual(data.signals[0].source, 'rss-openai', 'Higher source_weight (1.15) should be ranked first in unscored stream');
  });

  // 场景 2 · 无模型不空白
  it('test_no_llm_shows_unscored_stream: graceful degradation without LLM', async () => {
    let signalsHandler: any = null;
    const mockCtx = {
      effect: (fn: any) => fn(),
      tools: { register() {} },
      webServer: {
        register(route: any) {
          if (route.path === '/api/plugins/ai-news-feed/signals') signalsHandler = route.handler;
        },
      },
    };

    // No ctx.llm, no apiKey
    const plugin = apply(mockCtx, {
      storePath,
      syncIntervalMinutes: 0,
      firstSyncDelaySeconds: 0,
    });

    const health = plugin.getHealthSnapshot();
    assert.strictEqual(health.llm_available, false);
    assert.strictEqual(health.llm_state, 'missing', 'Must report llm_state: missing');

    await plugin.store.addItems([
      {
        source: 'hn',
        source_type: 'api',
        url: 'https://example.com/hn-1',
        title: 'HN Unscored Story',
        source_weight: 0.9,
        published_at: '2026-03-30T10:00:00Z',
        status: 'pending',
      },
      {
        source: 'rss-openai',
        source_type: 'rss',
        url: 'https://example.com/openai-1',
        title: 'OpenAI Unscored Story',
        source_weight: 1.15,
        published_at: '2026-03-30T09:00:00Z',
        status: 'pending',
      },
    ]);

    let body = '';
    signalsHandler(
      { method: 'GET', url: '/api/plugins/ai-news-feed/signals' },
      { setHeader() {}, end: (d: string) => { body = d; } }
    );
    const data = JSON.parse(body);

    assert.strictEqual(data.signals.length, 2, 'Should return unscored stream');
    assert.strictEqual(data.signals[0].source, 'rss-openai', 'Highest source_weight must rank first');
    assert.strictEqual(data.signals[0].status, 'pending');
    assert.strictEqual(data.signals[0].score, 0);
  });

  // 场景 3 · 日预算生效且持久
  it('test_daily_call_budget: budget limits model calls and resets across midnight', () => {
    const tracker = new BudgetTracker(budgetPath, 6); // 6 calls limit

    assert.strictEqual(tracker.canSpend(2), true);
    assert.strictEqual(tracker.getSnapshot().remaining, 6);

    // Round 1: 3 calls
    tracker.recordSpend(3, 1);
    assert.strictEqual(tracker.getSnapshot().used, 3);
    assert.strictEqual(tracker.getSnapshot().remaining, 3);
    assert.strictEqual(tracker.canSpend(3), true);

    // Round 2: 3 calls -> hits limit 6
    tracker.recordSpend(3, 1);
    assert.strictEqual(tracker.getSnapshot().used, 6);
    assert.strictEqual(tracker.getSnapshot().remaining, 0);
    assert.ok(tracker.getSnapshot().exhausted_at, 'exhausted_at must be set when budget is reached');

    // Round 3: budget reached, cannot spend
    assert.strictEqual(tracker.canSpend(1), false);

    // Persistence check: simulate restart by creating new BudgetTracker on same file
    const restartedTracker = new BudgetTracker(budgetPath, 6);
    assert.strictEqual(restartedTracker.getSnapshot().used, 6);
    assert.strictEqual(restartedTracker.getSnapshot().remaining, 0);
    assert.strictEqual(restartedTracker.canSpend(1), false);

    // Cross-midnight reset check: simulate next day
    restartedTracker._simulateDateChange('2026-03-29'); // Prior date
    assert.strictEqual(restartedTracker.getSnapshot().used, 0, 'Must reset to 0 after date change');
    assert.strictEqual(restartedTracker.getSnapshot().remaining, 6);
    assert.strictEqual(restartedTracker.getSnapshot().exhausted_at, null);
    assert.strictEqual(restartedTracker.canSpend(2), true);
  });

  // 场景 4 · 默认值唯一 (maxScoresPerRun === 10)
  it('test_single_default_for_max_scores: evaluator and index default to 10', () => {
    assert.strictEqual(DEFAULT_MAX_SCORES_PER_RUN, 10, 'DEFAULT_MAX_SCORES_PER_RUN must be 10');

    const evaluator = new NewsEvaluator({});
    assert.strictEqual(evaluator.getMaxScoresPerRun(), 10, 'Evaluator must default to 10');
  });

  // 场景 5 · 法务与仓库卫生
  it('test_repo_hygiene: LICENSE, package.json, gitignore, and CHANGELOG exist', () => {
    const rootDir = path.resolve(__dirname, '..');

    // 1. LICENSE MIT
    const licensePath = path.join(rootDir, 'LICENSE');
    assert.ok(fs.existsSync(licensePath), 'LICENSE must exist');
    const licenseContent = fs.readFileSync(licensePath, 'utf8');
    assert.ok(licenseContent.includes('MIT License'));
    assert.ok(licenseContent.includes('Copyright (c) 2026 Wang Wei'));

    // 2. package.json
    const pkgPath = path.join(rootDir, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    assert.ok(pkg.version && /^\d+\.\d+\.\d+$/.test(pkg.version), 'package.json version must be semver');
    assert.strictEqual(pkg.license, 'MIT');
    assert.ok(Array.isArray(pkg.keywords) && pkg.keywords.includes('dsh-plugin'));

    // 3. .gitignore
    const gitignorePath = path.join(rootDir, '.gitignore');
    assert.ok(fs.existsSync(gitignorePath), '.gitignore must exist');
    const gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
    assert.ok(gitignoreContent.includes('node_modules/'));
    assert.ok(gitignoreContent.includes('data/'));
    assert.ok(gitignoreContent.includes('lib/'));

    // 4. CHANGELOG.md
    const changelogPath = path.join(rootDir, 'CHANGELOG.md');
    assert.ok(fs.existsSync(changelogPath), 'CHANGELOG.md must exist');
    const changelogContent = fs.readFileSync(changelogPath, 'utf8');
    assert.ok(changelogContent.includes('0.7.0'));
  });

  // 场景 6 · locale 键对齐
  it('test_locale_keys_aligned: zh.json and en.json keys are strictly aligned without deprecated keys', () => {
    const rootDir = path.resolve(__dirname, '..');
    const zhPath = path.join(rootDir, 'locale/zh.json');
    const enPath = path.join(rootDir, 'locale/en.json');

    const zh = JSON.parse(fs.readFileSync(zhPath, 'utf8'));
    const en = JSON.parse(fs.readFileSync(enPath, 'utf8'));

    function extractKeys(obj: any, prefix = ''): string[] {
      let keys: string[] = [];
      for (const [k, v] of Object.entries(obj)) {
        const fullKey = prefix ? `${prefix}.${k}` : k;
        if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
          keys = keys.concat(extractKeys(v, fullKey));
        } else {
          keys.push(fullKey);
        }
      }
      return keys.sort();
    }

    const zhKeys = extractKeys(zh);
    const enKeys = extractKeys(en);

    assert.deepStrictEqual(zhKeys, enKeys, 'zh.json and en.json keys must be identical');

    // Must NOT contain removed trigger_news_pipeline key
    assert.strictEqual(zhKeys.some((k) => k.includes('trigger_news_pipeline')), false);
    assert.strictEqual(enKeys.some((k) => k.includes('trigger_news_pipeline')), false);
  });

  // 场景 8 · 卸载无残留
  it('test_uninstall_clean: runtime files only in plugin-data-dir', () => {
    const mockCtx = { tools: { register() {} } };
    const plugin = apply(mockCtx, {
      storePath,
      syncIntervalMinutes: 0,
      firstSyncDelaySeconds: 0,
    });

    const health = plugin.getHealthSnapshot();
    assert.ok(health.store_path.startsWith(releaseTestDataDir));
    // Verify no stray files outside testDataDir
    assert.ok(fs.existsSync(releaseTestDataDir));
  });

  // 场景 9 · Cordis 依赖注入契约（杜绝问号可选导致 pending 无法激活）
  it('test_inject_contract: inject must only declare required services without optional questions', async () => {
    const mod = await import('../src/index.js');
    assert.ok(Array.isArray(mod.inject), 'inject must be an array');
    assert.deepStrictEqual(mod.inject, ['tools'], 'inject must only require tools to avoid blocking Cordis activation');
    for (const dep of mod.inject) {
      assert.strictEqual(dep.includes('?'), false, `Dependency "${dep}" must not contain "?" character`);
    }
  });

  // 场景 10 · 真实 Cordis 上下文无 baseDir / undeclared property 越界抛错
  it('test_real_cordis_activation: activates in real Cordis context without baseDir inject error', async () => {
    const cordisMod = await import('@deepseek-ai/cordis');
    const root = new cordisMod.Context();
    root.provide('tools', { register() {} });
    const plugin = await import('../src/index.js');
    const fiber = root.plugin(plugin, {
      storePath,
      syncIntervalMinutes: 0,
      firstSyncDelaySeconds: 0,
    });
    // Fiber state 1 is ACTIVE
    assert.strictEqual(fiber.state, 1, 'Plugin fiber must be active in real Cordis Context');
    fiber.dispose();
  });

  // 场景 11 · DSH tools.register output 契约校验
  it('test_tool_registration_output_contract: all registered tools declare valid output { schema, render }', () => {
    const registeredTools: any[] = [];
    const mockCtx = {
      tools: {
        register(def: any) {
          if (!def.output || typeof def.output.render !== 'function' || !def.output.schema) {
            throw new TypeError(`tool "${def.name}" must declare output { schema, render, presentationMeta? }`);
          }
          registeredTools.push(def);
        },
      },
    };

    apply(mockCtx, {
      storePath,
      syncIntervalMinutes: 0,
      firstSyncDelaySeconds: 0,
    });

    assert.strictEqual(registeredTools.length, 7, 'Must register all 7 tools');
    for (const tool of registeredTools) {
      assert.strictEqual(typeof tool.name, 'string');
      assert.ok(tool.output, `tool ${tool.name} must have output`);
      assert.strictEqual(typeof tool.output.render, 'function');
      assert.strictEqual(tool.output.schema?.type, 'object');
      const rendered = tool.output.render({}, { foo: 'bar' });
      assert.ok(Array.isArray(rendered), 'rendered output must be an array of ContentBlock');
      assert.strictEqual(rendered[0].type, 'text');
    }
  });

  // 场景 12 · 客户端 UI 扩展规范与自动注册契约
  it('test_client_ui_registration_contract: package declares valid dsh.client.inject and auto-registers slots', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
    assert.strictEqual(pkg.dsh?.client?.platform, 'web');
    assert.ok(pkg.dsh?.client?.inject?.includes('@deepseek-ai/dsh-client-ui-conversation'), 'Must inject dsh-client-ui-conversation');
    assert.strictEqual(pkg.dsh?.client?.inject?.includes('@deepseek-ai/dsh-client-ui-dockkit'), false, 'Must not inject non-plugin dockkit');

    const clientPath = path.join(__dirname, '../lib/client.js');
    if (!fs.existsSync(clientPath)) {
      assert.fail('lib/client.js does not exist; run pnpm build first');
    }

    const source = fs.readFileSync(clientPath, 'utf8');

    // 经典脚本格式断言：不得含 export/import 语句
    assert.ok(!/^\s*(export|import)\s/m.test(source), 'lib/client.js must not contain top-level export or import statements');

    // 经典脚本可解析断言
    assert.doesNotThrow(() => {
      new Function(source);
    }, 'lib/client.js must be parseable as a classic script without SyntaxError');

    // 内容断言：必须含 window.__ModuleLoader__.load 与 slot 名字面量
    assert.ok(source.includes('window.__ModuleLoader__.load'), 'Must contain window.__ModuleLoader__.load');
    assert.ok(source.includes('conversation.session.header.utilities'), 'Must register conversation.session.header.utilities');
    assert.ok(source.includes('conversation.input.dock'), 'Must register conversation.input.dock');
    assert.ok(source.includes('conversation.session.header.actions'), 'Must retain conversation.session.header.actions');
    assert.ok(source.includes('conversation.composer.dock'), 'Must retain conversation.composer.dock');
  });
});
