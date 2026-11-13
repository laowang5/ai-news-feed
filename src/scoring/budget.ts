import fs from 'node:fs';
import path from 'node:path';
import type { BudgetSnapshot } from '../types.js';

export interface BudgetRecord {
  date: string;
  calls: number;
  items: number;
  exhausted_at?: string | null;
}

export function getLocalDateString(d: Date = new Date()): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export class BudgetTracker {
  private filePath: string;
  private dailyLimit: number;
  private state: BudgetRecord;

  constructor(filePath: string, dailyLimit: number = 120) {
    this.filePath = filePath;
    this.dailyLimit = dailyLimit > 0 ? dailyLimit : 120;
    this.state = this.loadOrCreate();
  }

  private loadOrCreate(): BudgetRecord {
    const today = getLocalDateString();
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const parsed = JSON.parse(raw) as Partial<BudgetRecord>;
        if (parsed && typeof parsed.calls === 'number' && parsed.date) {
          if (parsed.date === today) {
            return {
              date: today,
              calls: parsed.calls,
              items: parsed.items ?? 0,
              exhausted_at: parsed.exhausted_at ?? null,
            };
          }
        }
      }
    } catch (err) {
      console.warn('[BudgetTracker] Failed to load budget file, creating new record:', err);
    }

    const initial: BudgetRecord = {
      date: today,
      calls: 0,
      items: 0,
      exhausted_at: null,
    };
    this.saveDirect(initial);
    return initial;
  }

  private checkMidnightReset(): void {
    const today = getLocalDateString();
    if (this.state.date !== today) {
      this.state = {
        date: today,
        calls: 0,
        items: 0,
        exhausted_at: null,
      };
      this.saveDirect(this.state);
    }
  }

  private saveDirect(record: BudgetRecord): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const tmpPath = `${this.filePath}.tmp.${Date.now()}`;
      fs.writeFileSync(tmpPath, JSON.stringify(record, null, 2), 'utf8');
      fs.renameSync(tmpPath, this.filePath);
    } catch (err) {
      console.error('[BudgetTracker] Failed to persist budget record:', err);
    }
  }

  public canSpend(cost: number = 1): boolean {
    this.checkMidnightReset();
    return this.state.calls + cost <= this.dailyLimit;
  }

  public recordSpend(calls: number = 1, items: number = 0): void {
    this.checkMidnightReset();
    this.state.calls += calls;
    this.state.items += items;
    if (this.state.calls >= this.dailyLimit && !this.state.exhausted_at) {
      this.state.exhausted_at = new Date().toISOString();
    }
    this.saveDirect(this.state);
  }

  public getSnapshot(): BudgetSnapshot {
    this.checkMidnightReset();
    return {
      limit: this.dailyLimit,
      used: this.state.calls,
      remaining: Math.max(0, this.dailyLimit - this.state.calls),
      exhausted_at: this.state.exhausted_at || null,
    };
  }

  public setLimit(limit: number): void {
    this.dailyLimit = limit > 0 ? limit : 120;
  }

  /**
   * For testing purpose: simulates date change across midnight.
   */
  public _simulateDateChange(dateStr: string): void {
    this.state.date = dateStr;
    this.checkMidnightReset();
  }
}
