import type { SourceConfig } from '../types.js';
import type { IngestorResult, RawFeedItem } from './types.js';

const USER_AGENT = 'ai-news-feed/0.5.1';

export async function fetchHackerNews(config: SourceConfig): Promise<IngestorResult> {
  const startTime = Date.now();
  const maxItems = config.maxItemsPerRun || 20;
  const keywords = config.keywords && config.keywords.length > 0 ? config.keywords : ['AI', 'LLM', 'Agent'];
  const windowHours = config.windowHours || 48;
  const sinceTimestamp = Math.floor(Date.now() / 1000) - windowHours * 3600;

  const results: RawFeedItem[] = [];
  const seenUrls = new Set<string>();

  try {
    for (const kw of keywords) {
      if (results.length >= maxItems) break;

      const url = `https://hn.algolia.com/api/v1/search_by_date?tags=story&query=${encodeURIComponent(
        kw
      )}&hitsPerPage=${maxItems}&numericFilters=created_at_i>${sinceTimestamp}`;

      const res = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(15000),
      });

      if (!res.ok) {
        throw new Error(`HN Algolia query returned status ${res.status}`);
      }

      const data = (await res.json()) as any;
      const hits = Array.isArray(data.hits) ? data.hits : [];

      for (const hit of hits) {
        if (results.length >= maxItems) break;

        const targetUrl = hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`;
        if (seenUrls.has(targetUrl)) continue;
        seenUrls.add(targetUrl);

        results.push({
          source: 'hn',
          source_type: 'api',
          url: targetUrl,
          title: hit.title || 'Untitled HN Post',
          summary: hit.story_text
            ? hit.story_text.replace(/<[^>]+>/g, ' ').slice(0, 300)
            : `Hacker News [${hit.points || 0} pts, ${hit.num_comments || 0} comments]`,
          published_at: hit.created_at || new Date(hit.created_at_i * 1000).toISOString(),
          raw_content: null,
        });
      }
    }

    return {
      sourceId: config.id,
      success: true,
      items: results.slice(0, maxItems),
      durationMs: Date.now() - startTime,
    };
  } catch (err: any) {
    return {
      sourceId: config.id,
      success: false,
      items: results,
      error: err?.message || String(err),
      durationMs: Date.now() - startTime,
    };
  }
}
