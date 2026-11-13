import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apply } from '../src/index.js';
import { getBriefingPrompt, MORNING_BRIEFING_PROMPT, EVENING_BRIEFING_PROMPT } from '../src/schedule/prompt.js';
import { resolveTimeZone } from '../src/schedule/timezone.js';
import { TITLE_MORNING, TITLE_EVENING } from '../src/schedule/manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const scheduleTestDataDir = path.join(__dirname, 'tmp-schedule-test');
const storePath = path.join(scheduleTestDataDir, 'signals.json');

function cleanScheduleDir() {
  if (fs.existsSync(scheduleTestDataDir)) {
    fs.rmSync(scheduleTestDataDir, { recursive: true, force: true });
  }
}

// In-memory mock schedule service for testing
class MockScheduleService {
  public tasks: Map<string, any[]> = new Map();
  public conflictCount = 0;

  public async catalog(sessionId: string) {
    return this.tasks.get(sessionId) || [];
  }

  public async list(sessionId: string) {
    return this.tasks.get(sessionId) || [];
  }

  public async create(sessionId: string, task: any) {
    const list = this.tasks.get(sessionId) || [];
    const id = `task_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const newTask = { ...task, id };
    list.push(newTask);
    this.tasks.set(sessionId, list);
    return newTask;
  }

  public async update(sessionId: string, task: any) {
    if (this.conflictCount > 0) {
      this.conflictCount--;
      throw new Error('schedule_conflict: task was modified');
    }

    const list = this.tasks.get(sessionId) || [];
    const idx = list.findIndex((t) => t.id === task.id);
    if (idx !== -1) {
      list[idx] = { ...list[idx], ...task };
      this.tasks.set(sessionId, list);
      return list[idx];
    }
    throw new Error('task not found');
  }

  public async delete(sessionId: string, id: string) {
    const list = this.tasks.get(sessionId) || [];
    const filtered = list.filter((t) => t.id !== id);
    this.tasks.set(sessionId, filtered);
    return { success: true };
  }
}

describe('v0.8 Schedule & Briefing Specification Tests', () => {
  beforeEach(() => {
    cleanScheduleDir();
  });

  afterEach(() => {
    cleanScheduleDir();
  });

  // 场景 1 · 注册两条日更（路径 A）
  it('test_enable_briefing_registers_two_daily_tasks: registers morning and evening daily tasks', async () => {
    const mockSchedule = new MockScheduleService();
    const registeredTools = new Map<string, any>();

    const mockCtx = {
      schedule: mockSchedule,
      tools: {
        register(tool: any) {
          registeredTools.set(tool.name, tool);
        },
      },
    };

    const plugin = apply(mockCtx, {
      storePath,
      syncIntervalMinutes: 0,
      firstSyncDelaySeconds: 0,
    });

    const enableTool = registeredTools.get('enable_briefing');
    assert.ok(enableTool, 'enable_briefing tool must be registered');

    // Execute within context of session "sess_123"
    const context = { agent: { sessionId: 'sess_123' } };
    const res = await enableTool.execute({}, context);

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.tasks.length, 2);

    const catalog = await mockSchedule.catalog('sess_123');
    assert.strictEqual(catalog.length, 2);

    const morning = catalog.find((t: any) => t.title === TITLE_MORNING);
    const evening = catalog.find((t: any) => t.title === TITLE_EVENING);

    assert.ok(morning, 'Morning task must exist in catalog');
    assert.ok(evening, 'Evening task must exist in catalog');
    assert.strictEqual(morning.daily.time, '08:00:00');
    assert.strictEqual(evening.daily.time, '20:00:00');
    assert.ok(morning.daily.time_zone.length > 0, 'Timezone must be specified');
  });

  // 场景 2 · 重复注册幂等
  it('test_enable_briefing_is_idempotent: subsequent calls update tasks without duplicating', async () => {
    const mockSchedule = new MockScheduleService();
    const registeredTools = new Map<string, any>();

    const mockCtx = {
      schedule: mockSchedule,
      tools: {
        register(tool: any) {
          registeredTools.set(tool.name, tool);
        },
      },
    };

    apply(mockCtx, { storePath, syncIntervalMinutes: 0, firstSyncDelaySeconds: 0 });
    const enableTool = registeredTools.get('enable_briefing');
    const context = { agent: { sessionId: 'sess_idempotent' } };

    // Call 1
    const res1 = await enableTool.execute({}, context);
    assert.strictEqual(res1.success, true);
    const catalog1 = await mockSchedule.catalog('sess_idempotent');
    assert.strictEqual(catalog1.length, 2);
    const morningId1 = catalog1.find((t) => t.title === TITLE_MORNING).id;

    // Call 2
    const res2 = await enableTool.execute({}, context);
    assert.strictEqual(res2.success, true);
    const catalog2 = await mockSchedule.catalog('sess_idempotent');
    assert.strictEqual(catalog2.length, 2, 'Total tasks must remain 2, not 4');
    const morningId2 = catalog2.find((t) => t.title === TITLE_MORNING).id;

    assert.strictEqual(morningId1, morningId2, 'Task IDs must be preserved across idempotent updates');
  });

  // 场景 3 · 改时间与冲突重试
  it('test_briefing_time_update: updates time and retries on schedule_conflict', async () => {
    const mockSchedule = new MockScheduleService();
    const registeredTools = new Map<string, any>();

    const mockCtx = {
      schedule: mockSchedule,
      tools: {
        register(tool: any) {
          registeredTools.set(tool.name, tool);
        },
      },
    };

    apply(mockCtx, { storePath, syncIntervalMinutes: 0, firstSyncDelaySeconds: 0 });
    const enableTool = registeredTools.get('enable_briefing');
    const context = { agent: { sessionId: 'sess_conflict' } };

    // Register initial
    await enableTool.execute({ morning: '08:00:00' }, context);

    // Inject 1 conflict to simulate CAS collision
    mockSchedule.conflictCount = 1;

    // Update time to 07:30:00
    const resUpdate = await enableTool.execute({ morning: '07:30:00' }, context);
    assert.strictEqual(resUpdate.success, true);

    const catalog = await mockSchedule.catalog('sess_conflict');
    const morning = catalog.find((t) => t.title === TITLE_MORNING);
    assert.strictEqual(morning.daily.time, '07:30:00');
  });

  // 场景 4 · 关闭与会话归档
  it('test_disable_briefing_unblocks_archive: deletes all briefing tasks for session', async () => {
    const mockSchedule = new MockScheduleService();
    const registeredTools = new Map<string, any>();

    const mockCtx = {
      schedule: mockSchedule,
      tools: {
        register(tool: any) {
          registeredTools.set(tool.name, tool);
        },
      },
    };

    apply(mockCtx, { storePath, syncIntervalMinutes: 0, firstSyncDelaySeconds: 0 });
    const enableTool = registeredTools.get('enable_briefing');
    const disableTool = registeredTools.get('disable_briefing');
    const context = { agent: { sessionId: 'sess_archive' } };

    // Enable first
    await enableTool.execute({}, context);
    let catalog = await mockSchedule.catalog('sess_archive');
    assert.strictEqual(catalog.length, 2);

    // Disable
    const resDisable = await disableTool.execute({}, context);
    assert.strictEqual(resDisable.success, true);
    assert.strictEqual(resDisable.deletedCount, 2);

    catalog = await mockSchedule.catalog('sess_archive');
    assert.strictEqual(catalog.length, 0, 'Catalog must be empty to unblock session archiving');
  });

  // 场景 5 · 服务缺失降级（路径 C）
  it('test_briefing_without_schedule_service: graceful degradation when ctx.schedule missing', async () => {
    const registeredTools = new Map<string, any>();
    // ctx has NO schedule service
    const mockCtx = {
      tools: {
        register(tool: any) {
          registeredTools.set(tool.name, tool);
        },
      },
    };

    const plugin = apply(mockCtx, {
      storePath,
      syncIntervalMinutes: 0,
      firstSyncDelaySeconds: 0,
    });

    const health = plugin.getHealthSnapshot();
    assert.strictEqual(health.schedule?.available, false);

    const enableTool = registeredTools.get('enable_briefing');
    const context = { agent: { sessionId: 'sess_nosched' } };
    const res = await enableTool.execute({}, context);

    assert.strictEqual(res.success, false);
    assert.strictEqual(res.error, 'schedule_unavailable');
  });

  // 场景 6 · 零新增也投递与 stats 元数据
  it('test_briefing_with_no_new_items: get_top_ai_news returns stats even when empty', async () => {
    const registeredTools = new Map<string, any>();
    const mockCtx = {
      tools: {
        register(tool: any) {
          registeredTools.set(tool.name, tool);
        },
      },
    };

    const plugin = apply(mockCtx, {
      storePath,
      syncIntervalMinutes: 0,
      firstSyncDelaySeconds: 0,
    });

    const getTopNewsTool = registeredTools.get('get_top_ai_news');
    assert.ok(getTopNewsTool);

    // Store is empty
    const resEmpty = await getTopNewsTool.execute({ minScore: 85, limit: 3 });
    assert.strictEqual(resEmpty.items.length, 0);
    assert.ok(resEmpty.stats, 'Must return stats object even when 0 items returned');
    assert.strictEqual(resEmpty.stats.candidate_count, 0);
    assert.strictEqual(resEmpty.stats.pending_count, 0);
    assert.ok(typeof resEmpty.stats.budget_remaining_percent === 'number');
  });

  // 场景 7 · 预算耗尽走纯列表
  it('test_briefing_list_only_when_budget_exhausted: stats reflects budget exhaustion', async () => {
    const registeredTools = new Map<string, any>();
    const mockCtx = {
      tools: {
        register(tool: any) {
          registeredTools.set(tool.name, tool);
        },
      },
    };

    const plugin = apply(mockCtx, {
      storePath,
      syncIntervalMinutes: 0,
      firstSyncDelaySeconds: 0,
      dailyModelCallBudget: 5,
    });

    // Exhaust budget
    plugin.budgetTracker.recordSpend(5, 2);

    const getTopNewsTool = registeredTools.get('get_top_ai_news');
    const res = await getTopNewsTool.execute({ minScore: 80, limit: 5 });

    assert.ok(res.stats);
    assert.strictEqual(res.stats.budget_remaining_percent, 0, 'Remaining budget percent must be 0');
    assert.strictEqual(res.stats.budget_used, 5);
  });

  // 场景 8 · prompt 模板可回归
  it('test_briefing_prompt_template_stable: morning and evening templates are stable and without absolute paths', () => {
    const morning = getBriefingPrompt('morning');
    const evening = getBriefingPrompt('evening');

    assert.ok(morning.includes('get_top_ai_news'));
    assert.ok(morning.includes('minScore: 85'));
    assert.ok(morning.includes('minScore: 80'));
    assert.ok(morning.includes('尾部一行：今日候选 N 条 / 未评分 M 条 / 预算剩余 K%'));

    assert.ok(evening.includes('get_top_ai_news'));
    assert.ok(evening.includes('AI 晚报'));
    assert.ok(evening.includes('尾部一行：今日候选 N 条 / 未评分 M 条 / 预算剩余 K%'));

    // Assert no absolute paths or environment specific paths
    assert.strictEqual(morning.includes('/Users/'), false);
    assert.strictEqual(evening.includes('/Users/'), false);
    assert.strictEqual(morning.includes('C:\\'), false);
  });
});
