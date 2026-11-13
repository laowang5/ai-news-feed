import type { Thresholds } from './scoring/thresholds.js';

export type SignalStatus = 'pending' | 'scored' | 'failed';

export interface SignalItem {
  id: number;
  source: string;
  source_type: string;
  url: string;
  url_key: string;
  title: string;
  summary: string;
  score: number; // Represents adjusted score
  tags: string[];
  raw_content: string | null;
  status: SignalStatus;
  published_at?: string;
  fetched_at?: string;

  // v0.6 extensions (all optional for backward compatibility)
  score_mean?: number;
  score_raw?: number[];
  source_weight?: number;
  tracking_penalty?: number;
  is_s_tier?: boolean;
  prompt_version?: string;

  // v0.9 experience fixes extensions
  /** Simplified-Chinese translation of `title`; `title` always keeps the original text. */
  title_zh?: string | null;
  /** English translation of `title`; null when the source title is already English. */
  title_en?: string | null;
  /** Skip reason when article content is insufficient for scoring. */
  skip_reason?: 'insufficient_content' | string;

  // v1.0 daily briefing extensions
  parent_digest?: string;
  digest_section?: string;
  digest_date?: string;
  merged_from?: Array<{ source: string; url: string }>;
  merged_into?: number;
  source_count?: number;
  read_at?: number;
  topic_match?: string[];
  topic_boost?: number;
  why_it_matters?: string | null;
}

export type AppearanceMode = 'auto' | 'light' | 'dark';
export type DisplayLanguage = 'zh' | 'en' | 'auto';

export interface SignalsStoreFile {
  schema: number;
  updated_at: string;
  items: SignalItem[];
}

export type SourceType = 'api' | 'rss' | 'atom';
export type SourceTier = 'tier_a' | 'tier_b' | 'tier_c' | 'default';

export interface SourceConfig {
  id: string;
  type: SourceType;
  enabled: boolean;
  tier?: SourceTier | string;
  url?: string;
  keywords?: string[];
  windowHours?: number;
  repos?: string[];
  maxItemsPerRun?: number;
}

export interface SourcesConfigFile {
  sources: SourceConfig[];
}

export interface FeedHealthItem {
  id: string;
  type: string;
  enabled: boolean;
  last_ok_at?: string;
  last_error?: string;
  success_count: number;
  fail_count: number;
  total_fetched: number;
}

export interface BudgetSnapshot {
  limit: number;
  used: number;
  remaining: number;
  exhausted_at?: string | null;
}

export interface SyncProgress {
  total: number;
  completed: number;
  current_source_name: string;
  current_source_id: string;
}

export interface FeedHealthSnapshot {
  updated_at: string;
  sources: Record<string, FeedHealthItem>;
  total_items: number;
  pending_items: number;
  scored_items: number;
  store_path: string;
  store_size_bytes: number;
  llm_available: boolean;

  // v0.6 health additions
  thresholds?: Thresholds;
  featured_max_items?: number;
  score_calls?: number;
  invalid_thresholds?: true;
  prompt_version?: string;

  // v0.7 release additions
  llm_state?: 'available' | 'missing';
  is_syncing?: boolean;
  sync_progress?: SyncProgress;
  budget?: BudgetSnapshot;

  // v0.8 briefing additions
  schedule?: {
    available: boolean;
    reason?: string;
  };

  // v0.9 experience fixes additions
  appearance?: AppearanceMode;
  display?: {
    language: DisplayLanguage;
    topics?: string[];
  };
  insufficient_content_items?: number;
}

export interface PluginConfig {
  storePath?: string;
  dataDir?: string;
  signalsDbPath?: string;
  dailyNewsDir?: string;
  syncIntervalMinutes?: number;
  firstSyncDelaySeconds?: number;
  maxItems?: number;
  maxScoresPerRun?: number;
  dailyModelCallBudget?: number;
  thresholds?: Partial<Thresholds>;
  featuredMaxItems?: number;
  scoreCalls?: number;
  llmBaseUrl?: string;
  llmApiKey?: string;
  llmModel?: string;

  // v0.9 & v1.0 display / topic personalization config
  appearance?: AppearanceMode;
  display?: {
    language?: DisplayLanguage;
    topics?: string[];
  };
  fetchArticle?: {
    enabled?: boolean;
    timeoutMs?: number;
    minContentChars?: number;
    fetchFn?: typeof fetch;
  };
}
