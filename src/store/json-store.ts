import fs from 'node:fs';
import path from 'node:path';
import type { SignalItem, SignalsStoreFile } from '../types.js';
import { normalizeUrl } from './url-normalize.js';
import { toLocalDateString } from '../ingestor/aihot-digest.js';
import { clusterSignals } from '../scoring/cluster.js';

const DIGEST_DATE_PATTERN = /(\d{4}[-/.年]\d{1,2}|\d{1,2}月\d{1,2}日|\b\d{1,2}[-/.]\d{1,2}\b)/;

/** Detect digest / multi-news aggregation posts that should not compete in single-item S-tier rankings. */
export function isDigestItem(item: {
  source?: string;
  source_type?: string;
  title?: string;
  parent_digest?: string;
}): boolean {
  if (item.parent_digest) return false;
  if (item.source_type === 'digest') return true;
  const title = item.title || '';
  if (title.includes('日报')) return true;
  if (item.source === 'aihot' && DIGEST_DATE_PATTERN.test(title)) return true;
  return false;
}

export interface StoreOptions {
  storePath: string;
  maxItems?: number;
}

export class JsonStore {
  private filePath: string;
  private maxItems: number;
  private items: SignalItem[] = [];
  private itemMap: Map<string, SignalItem> = new Map(); // url_key -> SignalItem
  private maxId: number = 0;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(options: StoreOptions) {
    this.filePath = options.storePath;
    this.maxItems = options.maxItems || 2000;
    this.loadFromDisk();
  }

  public getFilePath(): string {
    return this.filePath;
  }

  public getItemsCount(): number {
    return this.items.length;
  }

  public getPendingCount(): number {
    return this.items.filter((i) => i.status === 'pending').length;
  }

  public getScoredCount(): number {
    return this.items.filter((i) => i.status === 'scored').length;
  }

  /** Count pending items skipped from LLM scoring due to insufficient article content. */
  public getInsufficientContentCount(): number {
    return this.items.filter((i) => i.status === 'pending' && i.skip_reason === 'insufficient_content').length;
  }

  public getFileSizeBytes(): number {
    try {
      if (fs.existsSync(this.filePath)) {
        return fs.statSync(this.filePath).size;
      }
    } catch {
      // ignore
    }
    return 0;
  }

  /**
   * Load JSON file from disk into memory.
   * If file does not exist or is invalid, initialize with empty array.
   */
  private loadFromDisk(): void {
    this.items = [];
    this.itemMap.clear();
    this.maxId = 0;

    if (!fs.existsSync(this.filePath)) {
      return;
    }

    try {
      const content = fs.readFileSync(this.filePath, 'utf8');
      if (!content.trim()) return;

      const data = JSON.parse(content) as SignalsStoreFile;
      if (Array.isArray(data.items)) {
        for (const item of data.items) {
          if (!item.url_key) {
            item.url_key = normalizeUrl(item.url).urlKey;
          }
          if (isDigestItem(item)) {
            item.source_type = 'digest';
          }
          if (item.id > this.maxId) {
            this.maxId = item.id;
          }
          this.itemMap.set(item.url_key, item);
        }
        this.items = Array.from(this.itemMap.values());
        this.recomputeClusters();
        this.sortInMemory();
      }
    } catch (err) {
      console.warn(`[JsonStore] Failed to read store at ${this.filePath}:`, err);
    }
  }

  private sortInMemory(): void {
    this.items.sort((a, b) => {
      const dateA = a.published_at ? new Date(a.published_at).getTime() : 0;
      const dateB = b.published_at ? new Date(b.published_at).getTime() : 0;
      if (dateB !== dateA) {
        return dateB - dateA;
      }
      return (b.score || 0) - (a.score || 0);
    });
  }

  /**
   * Query signals from memory index in <1ms.
   */
  public querySignals(options: {
    minScore?: number;
    limit?: number;
    category?: string;
    sortByScore?: boolean;
    sortByWeightAndDate?: boolean;
    /** Group scored items (sorted by score desc, date desc) ahead of pending items (sorted by date desc). */
    groupByStatus?: boolean;
    /** Exclude multi-item digest posts (e.g. aihot daily roundups) from single-item rankings. */
    excludeDigest?: boolean;
    sTierScore?: number;
    status?: 'pending' | 'scored' | 'all';
  } = {}): SignalItem[] {
    const limit = options.limit;
    const minScore = options.minScore;
    const category = options.category?.toLowerCase();
    const status = options.status;
    const sTierScore = options.sTierScore ?? 85;
    const excludeDigest = Boolean(options.excludeDigest) || (minScore !== undefined && minScore >= sTierScore);

    let result = this.items;

    if (status && status !== 'all') {
      result = result.filter((item) => item.status === status);
    }

    if (excludeDigest) {
      result = result.filter((item) => !isDigestItem(item));
    }

    if (minScore !== undefined && minScore > 0) {
      result = result.filter((item) => (item.score || 0) >= minScore);
    }

    if (category) {
      result = result.filter((item) => {
        const titleMatch = item.title?.toLowerCase().includes(category);
        const titleZhMatch = item.title_zh?.toLowerCase().includes(category);
        const summaryMatch = item.summary?.toLowerCase().includes(category);
        const tagsMatch = item.tags?.some((t) => t.toLowerCase().includes(category));
        return titleMatch || titleZhMatch || summaryMatch || tagsMatch;
      });
    }

    if (options.sortByWeightAndDate) {
      result = [...result].sort((a, b) => {
        const weightA = a.source_weight ?? 0.9;
        const weightB = b.source_weight ?? 0.9;
        if (weightB !== weightA) {
          return weightB - weightA;
        }
        const dateA = a.published_at ? new Date(a.published_at).getTime() : 0;
        const dateB = b.published_at ? new Date(b.published_at).getTime() : 0;
        return dateB - dateA;
      });
    } else if (options.sortByScore) {
      result = [...result].sort((a, b) => {
        if ((b.score || 0) !== (a.score || 0)) {
          return (b.score || 0) - (a.score || 0);
        }
        const dateA = a.published_at ? new Date(a.published_at).getTime() : 0;
        const dateB = b.published_at ? new Date(b.published_at).getTime() : 0;
        return dateB - dateA;
      });
    } else if (options.groupByStatus) {
      result = [...result].sort((a, b) => {
        const groupA = a.status === 'scored' ? 0 : 1;
        const groupB = b.status === 'scored' ? 0 : 1;
        if (groupA !== groupB) {
          return groupA - groupB;
        }
        if (groupA === 0 && (b.score || 0) !== (a.score || 0)) {
          return (b.score || 0) - (a.score || 0);
        }
        const dateA = a.published_at ? new Date(a.published_at).getTime() : 0;
        const dateB = b.published_at ? new Date(b.published_at).getTime() : 0;
        return dateB - dateA;
      });
    }

    if (limit !== undefined && limit > 0) {
      return result.slice(0, limit);
    }
    return result;
  }

  /**
   * Recompute cross-source clusters across all items in memory.
   */
  public recomputeClusters(): void {
    const idMap = new Map<number, SignalItem>();
    for (const item of this.items) {
      delete item.merged_from;
      delete item.merged_into;
      item.source_count = 1;
      idMap.set(item.id, item);
    }

    const pairs = clusterSignals(this.items);
    for (const pair of pairs) {
      const primary = idMap.get(pair.primaryId);
      if (!primary) continue;

      const mergedFrom: Array<{ source: string; url: string }> = [];
      for (const mergedId of pair.mergedIds) {
        const merged = idMap.get(mergedId);
        if (!merged) continue;
        merged.merged_into = primary.id;
        mergedFrom.push({ source: merged.source, url: merged.url });
      }
      if (mergedFrom.length > 0) {
        primary.merged_from = mergedFrom;
        primary.source_count = 1 + mergedFrom.length;
      }
    }
  }

  /**
   * Query today's top unread high-signal briefing items (Layer 1: 今日必看).
   * Strict hard cap of 5 items per day.
   */
  public queryDailyBriefing(opts: {
    date: string;
    includeRead?: boolean;
    limit?: number;
    featuredMinScore?: number;
    digestMinScore?: number;
  }): SignalItem[] {
    const featuredMin = opts.featuredMinScore ?? 80;
    const digestMin = opts.digestMinScore ?? 60;
    const includeRead = Boolean(opts.includeRead);
    const requestedLimit = opts.limit && opts.limit > 0 ? opts.limit : 5;
    const hardLimit = Math.min(5, requestedLimit);

    const matched = this.items.filter((item) => {
      const itemDate = item.digest_date || toLocalDateString(item.published_at || item.fetched_at);
      if (itemDate !== opts.date) return false;
      if (item.status !== 'scored') return false;
      const score = item.score || 0;
      const passesThreshold =
        score >= featuredMin ||
        (Boolean(item.parent_digest) && score >= digestMin);
      if (!passesThreshold) return false;
      if (isDigestItem(item)) return false;
      if (item.merged_into !== undefined && item.merged_into !== null) return false;
      if (!includeRead && item.read_at) return false;
      return true;
    });

    matched.sort((a, b) => {
      if ((b.score || 0) !== (a.score || 0)) {
        return (b.score || 0) - (a.score || 0);
      }
      const digestA = a.parent_digest ? 1 : 0;
      const digestB = b.parent_digest ? 1 : 0;
      if (digestB !== digestA) return digestB - digestA;
      const dateA = a.published_at ? new Date(a.published_at).getTime() : 0;
      const dateB = b.published_at ? new Date(b.published_at).getTime() : 0;
      return dateB - dateA;
    });

    return matched.slice(0, hardLimit);
  }

  /**
   * Mark item IDs as read idempotently (preserves original read_at timestamp if already read).
   */
  public async markRead(ids: number[], nowMs?: number): Promise<number> {
    if (!Array.isArray(ids) || ids.length === 0) return 0;
    const targetIds = new Set(ids.filter((id) => typeof id === 'number' && Number.isFinite(id)));
    if (targetIds.size === 0) return 0;

    const ts = nowMs ?? Date.now();
    let updated = 0;
    for (const item of this.items) {
      if (targetIds.has(item.id) && !item.read_at) {
        item.read_at = ts;
        updated += 1;
      }
    }

    if (updated > 0) {
      await this.saveAsync();
    }
    return updated;
  }

  /**
   * Add raw items into store.
   * Duplicate URLs are ignored (idempotent).
   * Returns the array of newly added items.
   */
  public async addItems(
    rawItems: Array<{
      source: string;
      source_type: string;
      url: string;
      title: string;
      summary?: string;
      published_at?: string;
      raw_content?: string | null;
      score?: number;
      source_weight?: number;
      tags?: string[];
      status?: 'pending' | 'scored' | 'failed';
      parent_digest?: string;
      digest_section?: string;
      digest_date?: string;
      topic_match?: string[];
      topic_boost?: number;
      title_zh?: string | null;
      title_en?: string | null;
      why_it_matters?: string | null;
      read_at?: number;
    }>
  ): Promise<SignalItem[]> {
    const added: SignalItem[] = [];
    const nowIso = new Date().toISOString();

    for (const raw of rawItems) {
      const { normalizedUrl, urlKey } = normalizeUrl(raw.url);
      if (this.itemMap.has(urlKey)) {
        continue;
      }

      this.maxId += 1;
      const newItem: SignalItem = {
        id: this.maxId,
        source: raw.source,
        source_type: isDigestItem(raw) ? 'digest' : raw.source_type,
        url: normalizedUrl,
        url_key: urlKey,
        title: raw.title,
        summary: raw.summary || '',
        score: raw.score || 0,
        source_weight: raw.source_weight,
        tags: raw.tags || [],
        raw_content: raw.raw_content ?? null,
        status: raw.status || 'pending',
        published_at: raw.published_at || nowIso,
        fetched_at: nowIso,
        ...(raw.parent_digest ? { parent_digest: raw.parent_digest } : {}),
        ...(raw.digest_section ? { digest_section: raw.digest_section } : {}),
        ...(raw.digest_date ? { digest_date: raw.digest_date } : {}),
        ...(raw.topic_match ? { topic_match: raw.topic_match } : {}),
        ...(raw.topic_boost !== undefined ? { topic_boost: raw.topic_boost } : {}),
        ...(raw.title_zh !== undefined ? { title_zh: raw.title_zh } : {}),
        ...(raw.title_en !== undefined ? { title_en: raw.title_en } : {}),
        ...(raw.why_it_matters !== undefined ? { why_it_matters: raw.why_it_matters } : {}),
        ...(raw.read_at !== undefined ? { read_at: raw.read_at } : {}),
      };

      this.itemMap.set(urlKey, newItem);
      this.items.push(newItem);
      added.push(newItem);
    }

    if (added.length > 0) {
      this.prune();
      this.recomputeClusters();
      this.sortInMemory();
      await this.saveAsync();
    }

    return added;
  }

  /**
   * Update pending item fields (e.g. hydrated raw_content or skip_reason) before/without scoring.
   */
  public async updatePendingItem(
    urlKey: string,
    patch: { raw_content?: string | null; skip_reason?: string | null }
  ): Promise<void> {
    const item = this.itemMap.get(urlKey);
    if (!item) return;

    let changed = false;
    if (patch.raw_content !== undefined && item.raw_content !== patch.raw_content) {
      item.raw_content = patch.raw_content;
      changed = true;
    }
    if (patch.skip_reason !== undefined) {
      const nextReason = patch.skip_reason === null ? undefined : patch.skip_reason;
      if (item.skip_reason !== nextReason) {
        item.skip_reason = nextReason;
        changed = true;
      }
    }

    if (changed) {
      await this.saveAsync();
    }
  }

  /**
   * Update scored items.
   */
  public async updateScoredItems(
    updates: Array<{
      url_key: string;
      score: number;
      score_mean?: number;
      score_raw?: number[];
      source_weight?: number;
      tracking_penalty?: number;
      is_s_tier?: boolean;
      prompt_version?: string;
      title_zh?: string | null;
      title_en?: string | null;
      summary?: string;
      tags?: string[];
      topic_match?: string[];
      topic_boost?: number;
      why_it_matters?: string | null;
      status?: 'pending' | 'scored' | 'failed';
    }>
  ): Promise<void> {
    let changed = false;

    for (const u of updates) {
      const item = this.itemMap.get(u.url_key);
      if (item) {
        item.score = u.score;
        if (u.score_mean !== undefined) item.score_mean = u.score_mean;
        if (u.score_raw !== undefined) item.score_raw = u.score_raw;
        if (u.source_weight !== undefined) item.source_weight = u.source_weight;
        if (u.tracking_penalty !== undefined) item.tracking_penalty = u.tracking_penalty;
        if (u.is_s_tier !== undefined) item.is_s_tier = u.is_s_tier;
        if (u.prompt_version !== undefined) item.prompt_version = u.prompt_version;
        if (u.title_zh !== undefined) item.title_zh = u.title_zh;
        if (u.title_en !== undefined) item.title_en = u.title_en;
        if (u.summary) item.summary = u.summary;
        if (u.tags) item.tags = u.tags;
        if (u.topic_match !== undefined) item.topic_match = u.topic_match;
        if (u.topic_boost !== undefined) item.topic_boost = u.topic_boost;
        if (u.why_it_matters !== undefined) item.why_it_matters = u.why_it_matters;
        item.status = u.status || 'scored';
        if (item.status === 'scored') {
          delete item.skip_reason;
        }
        changed = true;
      }
    }

    if (changed) {
      this.recomputeClusters();
      this.sortInMemory();
      await this.saveAsync();
    }
  }

  /**
   * Rolling prune to keep at most maxItems and delete items older than 90 days.
   */
  private prune(): void {
    const ninetyDaysAgoMs = Date.now() - 90 * 24 * 60 * 60 * 1000;

    // Filter out items older than 90 days
    this.items = this.items.filter((item) => {
      if (!item.fetched_at) return true;
      const fetchedMs = new Date(item.fetched_at).getTime();
      return fetchedMs >= ninetyDaysAgoMs;
    });

    // If still exceeding maxItems, sort and slice
    if (this.items.length > this.maxItems) {
      this.sortInMemory();
      this.items = this.items.slice(0, this.maxItems);
    }

    // Rebuild Map
    this.itemMap.clear();
    for (const item of this.items) {
      this.itemMap.set(item.url_key, item);
    }
  }

  /**
   * Enqueues an atomic write to disk.
   * Write .tmp -> fsync -> rename
   */
  public async saveAsync(): Promise<void> {
    this.writeQueue = this.writeQueue
      .then(() => this.atomicWrite())
      .catch((err) => {
        console.error('[JsonStore] Atomic write failed:', err);
      });
    return this.writeQueue;
  }

  private async atomicWrite(): Promise<void> {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const tmpPath = `${this.filePath}.tmp.${process.pid}.${Date.now()}`;
    const payload: SignalsStoreFile = {
      schema: 1,
      updated_at: new Date().toISOString(),
      items: this.items,
    };

    const content = JSON.stringify(payload, null, 2);

    // Write to tmp and sync
    await new Promise<void>((resolve, reject) => {
      fs.open(tmpPath, 'w', (err, fd) => {
        if (err) return reject(err);
        fs.writeFile(fd, content, 'utf8', (writeErr) => {
          if (writeErr) {
            fs.close(fd, () => {});
            return reject(writeErr);
          }
          fs.fsync(fd, (syncErr) => {
            fs.close(fd, () => {});
            if (syncErr) return reject(syncErr);
            resolve();
          });
        });
      });
    });

    // Atomic replace
    await fs.promises.rename(tmpPath, this.filePath);
  }
}
