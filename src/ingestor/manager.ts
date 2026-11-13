import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import type { SourceConfig, SourcesConfigFile, SyncProgress } from '../types.js';
import type { IngestorResult, RawFeedItem } from './types.js';
import { fetchRssFeed } from './rss.js';
import { fetchHackerNews } from './hn.js';
import { fetchGitHubReleases } from './github.js';
import { DEFAULT_SOURCES, DEFAULT_SOURCES_YAML } from './default-sources.js';

export function getSourceDisplayName(source: SourceConfig): string {
  switch (source.id) {
    case 'hn':
      return 'Hacker News';
    case 'github':
      return 'GitHub Releases';
    case 'aihot':
      return 'AIHot News';
    case 'rss-openai':
      return 'OpenAI News';
    case 'rss-deepmind':
      return 'Google DeepMind';
    case 'rss-simonw':
      return "Simon Willison's Blog";
    default:
      return source.id;
  }
}

export class IngestorManager {
  private configPath: string;
  private sources: SourceConfig[] = [];

  constructor(configPath: string) {
    this.configPath = configPath;
    this.loadOrCreateSources();
  }

  public getSources(): SourceConfig[] {
    return this.sources;
  }

  public loadOrCreateSources(): SourceConfig[] {
    try {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      if (!fs.existsSync(this.configPath)) {
        fs.writeFileSync(this.configPath, DEFAULT_SOURCES_YAML, 'utf8');
        this.sources = DEFAULT_SOURCES;
        return this.sources;
      }

      const fileContent = fs.readFileSync(this.configPath, 'utf8');
      const parsed = YAML.parse(fileContent) as SourcesConfigFile;
      if (parsed && Array.isArray(parsed.sources)) {
        this.sources = parsed.sources;
      } else {
        this.sources = DEFAULT_SOURCES;
      }
    } catch (err) {
      console.warn(`[IngestorManager] Failed to read ${this.configPath}, fallback to defaults:`, err);
      this.sources = DEFAULT_SOURCES;
    }
    return this.sources;
  }

  /**
   * Fetch a single source by configuration.
   */
  public async fetchSource(config: SourceConfig): Promise<IngestorResult> {
    if (config.id === 'hn') {
      return fetchHackerNews(config);
    }
    if (config.id === 'github') {
      return fetchGitHubReleases(config);
    }
    if (config.type === 'rss' || config.type === 'atom') {
      return fetchRssFeed(config);
    }
    return {
      sourceId: config.id,
      success: false,
      items: [],
      error: `Unsupported source type: ${config.type}`,
      durationMs: 0,
    };
  }

  /**
   * Fetch all enabled sources concurrently with total error isolation.
   */
  public async syncAll(
    filterSourceIds?: string[],
    onProgress?: (progress: SyncProgress) => void
  ): Promise<{
    items: RawFeedItem[];
    results: IngestorResult[];
  }> {
    const targets = this.sources.filter((s) => {
      if (!s.enabled) return false;
      if (filterSourceIds && filterSourceIds.length > 0) {
        return filterSourceIds.includes(s.id);
      }
      return true;
    });

    const total = targets.length;
    let completed = 0;

    const tasks = targets.map(async (source) => {
      const displayName = getSourceDisplayName(source);
      onProgress?.({
        total,
        completed,
        current_source_name: displayName,
        current_source_id: source.id,
      });

      const res = await this.fetchSource(source);
      completed += 1;

      onProgress?.({
        total,
        completed,
        current_source_name: displayName,
        current_source_id: source.id,
      });

      return res;
    });

    const settled = await Promise.allSettled(tasks);

    const allItems: RawFeedItem[] = [];
    const results: IngestorResult[] = [];

    settled.forEach((res, idx) => {
      const source = targets[idx];
      if (res.status === 'fulfilled') {
        results.push(res.value);
        if (res.value.items) {
          allItems.push(...res.value.items);
        }
      } else {
        results.push({
          sourceId: source.id,
          success: false,
          items: [],
          error: res.reason?.message || String(res.reason),
          durationMs: 0,
        });
      }
    });

    return { items: allItems, results };
  }
}
