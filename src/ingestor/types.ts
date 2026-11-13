export interface RawFeedItem {
  source: string;
  source_type: string;
  url: string;
  title: string;
  summary: string;
  published_at?: string;
  raw_content?: string | null;
  parent_digest?: string;
  digest_section?: string;
  digest_date?: string;
}

export interface IngestorResult {
  sourceId: string;
  success: boolean;
  items: RawFeedItem[];
  error?: string;
  durationMs: number;
}
