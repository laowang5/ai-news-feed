import { resolveTimeZone } from './timezone.js';
import { getBriefingPrompt, type BriefingKind } from './prompt.js';

export const TITLE_MORNING = 'ai-news-feed:briefing:morning';
export const TITLE_EVENING = 'ai-news-feed:briefing:evening';
export const TITLE_PREFIX = 'ai-news-feed:briefing:';

export interface EnableBriefingOptions {
  morning?: string;
  evening?: string;
  timeZone?: string;
}

export interface BriefingTaskSummary {
  id: string;
  kind: BriefingKind;
  title: string;
  time: string;
  timeZone: string;
}

export class ScheduleManager {
  private ctx: any;

  constructor(ctx: any) {
    this.ctx = ctx;
  }

  private getScheduleService(): any {
    return typeof this.ctx?.get === 'function' ? this.ctx.get('schedule') : this.ctx?.schedule;
  }

  public isAvailable(): boolean {
    return Boolean(this.getScheduleService());
  }

  /**
   * Helper to query tasks for a given sessionId across different method signatures.
   */
  private async listSessionTasks(sessionId: string): Promise<any[]> {
    if (!this.isAvailable()) return [];

    const scheduleService = this.getScheduleService();
    try {
      if (typeof scheduleService.catalog === 'function') {
        const res = await scheduleService.catalog(sessionId);
        if (Array.isArray(res)) return res;
        if (res && Array.isArray(res.items)) return res.items;
      }
      if (typeof scheduleService.list === 'function') {
        const res = await scheduleService.list(sessionId);
        if (Array.isArray(res)) return res;
        if (res && Array.isArray(res.items)) return res.items;
      }
    } catch {
      try {
        if (typeof scheduleService.catalog === 'function') {
          const res = await scheduleService.catalog({ sessionId });
          if (Array.isArray(res)) return res;
          if (res && Array.isArray(res.items)) return res.items;
        }
        if (typeof scheduleService.list === 'function') {
          const res = await scheduleService.list({ sessionId });
          if (Array.isArray(res)) return res;
          if (res && Array.isArray(res.items)) return res.items;
        }
      } catch (err) {
        console.warn('[ScheduleManager] Failed to query session tasks:', err);
      }
    }
    return [];
  }

  /**
   * Helper to create or update a single briefing task with compare-and-set and conflict retry.
   */
  private async upsertTask(
    sessionId: string,
    title: string,
    prompt: string,
    time: string,
    timeZone: string,
    kind: BriefingKind
  ): Promise<BriefingTaskSummary> {
    const scheduleService = this.getScheduleService();
    const taskPayload = {
      title,
      prompt,
      daily: {
        time,
        time_zone: timeZone,
      },
    };

    let retries = 0;
    while (retries <= 2) {
      const existingList = await this.listSessionTasks(sessionId);
      const existing = existingList.find((t: any) => t.title === title);

      if (existing) {
        try {
          if (typeof scheduleService.update === 'function') {
            await scheduleService.update(sessionId, {
              ...existing,
              ...taskPayload,
              id: existing.id,
            });
            return {
              id: existing.id,
              kind,
              title,
              time,
              timeZone,
            };
          }
        } catch (err: any) {
          if (String(err?.message || err).includes('schedule_conflict') && retries < 2) {
            retries++;
            continue;
          }
          throw err;
        }
      }

      // If not existing, create new task
      let createdId = `task_${Date.now()}_${kind}`;
      try {
        let res: any;
        if (scheduleService.create.length >= 2) {
          res = await scheduleService.create(sessionId, taskPayload);
        } else {
          res = await scheduleService.create({ sessionId, ...taskPayload });
        }
        if (res && typeof res === 'object' && res.id) {
          createdId = res.id;
        }
      } catch (err: any) {
        if (String(err?.message || err).includes('schedule_conflict') && retries < 2) {
          retries++;
          continue;
        }
        throw err;
      }

      return {
        id: createdId,
        kind,
        title,
        time,
        timeZone,
      };
    }

    throw new Error(`Failed to upsert task ${title} due to schedule_conflict`);
  }

  /**
   * Enable morning & evening briefings for a session (Path A).
   */
  public async enableBriefing(sessionId: string, options: EnableBriefingOptions = {}) {
    if (!sessionId || typeof sessionId !== 'string') {
      return {
        success: false,
        error: 'no_session_context',
        message: '未检测到有效会话上下文，请在对话框中向助手呼叫开启',
      };
    }

    if (!this.isAvailable()) {
      return {
        success: false,
        error: 'schedule_unavailable',
        message: '宿主未启用 schedule 计划任务服务',
      };
    }

    const timeZone = resolveTimeZone(options.timeZone);
    const morningTime = options.morning || '08:00:00';
    const eveningTime = options.evening || '20:00:00';

    try {
      const morningTask = await this.upsertTask(
        sessionId,
        TITLE_MORNING,
        getBriefingPrompt('morning'),
        morningTime,
        timeZone,
        'morning'
      );

      const eveningTask = await this.upsertTask(
        sessionId,
        TITLE_EVENING,
        getBriefingPrompt('evening'),
        eveningTime,
        timeZone,
        'evening'
      );

      return {
        success: true,
        timeZone,
        tasks: [morningTask, eveningTask],
      };
    } catch (err: any) {
      return {
        success: false,
        error: 'schedule_error',
        message: err?.message || String(err),
      };
    }
  }

  /**
   * Disable briefings for a session and delete scheduled tasks to unblock session archiving.
   */
  public async disableBriefing(sessionId: string) {
    if (!sessionId || typeof sessionId !== 'string') {
      return {
        success: false,
        error: 'no_session_context',
        message: '未检测到有效会话上下文，请在对话框中向助手要求关闭',
      };
    }

    if (!this.isAvailable()) {
      return {
        success: false,
        error: 'schedule_unavailable',
        message: '宿主未启用 schedule 计划任务服务',
      };
    }

    const scheduleService = this.getScheduleService();
    const tasks = await this.listSessionTasks(sessionId);
    const briefingTasks = tasks.filter((t: any) => typeof t.title === 'string' && t.title.startsWith(TITLE_PREFIX));

    for (const t of briefingTasks) {
      try {
        if (typeof scheduleService.delete === 'function') {
          if (scheduleService.delete.length >= 2) {
            await scheduleService.delete(sessionId, t.id);
          } else {
            await scheduleService.delete({ sessionId, id: t.id });
          }
        }
      } catch (err) {
        console.warn(`[ScheduleManager] Failed to delete task ${t.id}:`, err);
      }
    }

    return {
      success: true,
      deletedCount: briefingTasks.length,
    };
  }
}
