import { extract } from '@extractus/feed-extractor';
import type { SourceConfig } from '../types.js';
import type { IngestorResult, RawFeedItem } from './types.js';
import { parseDigestItems, toLocalDateString } from './aihot-digest.js';

const USER_AGENT = 'ai-news-feed/0.5.1 (+https://github.com/laowang5/ai-news-feed)';

/**
 * Clean text from raw HTML snippets, removing script/style tags and decoding entities.
 */
function cleanTextSnippet(htmlOrText?: string): string {
  if (!htmlOrText) return '';
  return htmlOrText
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

/**
 * Universal RSS / Atom feed fetcher.
 * Handles timeouts, error isolation, per-source truncation.
 */
export async function fetchRssFeed(config: SourceConfig): Promise<IngestorResult> {
  const startTime = Date.now();
  const maxItems = config.maxItemsPerRun || 20;

  if (!config.url) {
    return {
      sourceId: config.id,
      success: false,
      items: [],
      error: 'Missing feed URL in configuration',
      durationMs: Date.now() - startTime,
    };
  }

  try {
    const feed = await extract(
      config.url,
      {
        normalization: true,
        useISODateFormat: true,
        descriptionMaxLen: 500,
        getExtraEntryFields: (entryData: any) => {
          const extractText = (v: any): string => {
            if (typeof v === 'string') return v;
            if (v && typeof v === 'object') return String(v['#text'] ?? v['__cdata'] ?? '');
            return '';
          };
          return {
            content: extractText(entryData['content:encoded']) || extractText(entryData.content) || '',
            rawDescription: extractText(entryData.description) || '',
            rawGuid: extractText(entryData.guid) || extractText(entryData.id) || '',
          };
        },
      },
      (targetUrl: string) =>
        fetch(targetUrl, {
          headers: {
            'User-Agent': USER_AGENT,
            Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
          },
          signal: AbortSignal.timeout(15000),
        })
    );

    const entries = Array.isArray(feed.entries) ? feed.entries : [];
    const sliced = entries.slice(0, maxItems);

    const items: RawFeedItem[] = [];
    for (const entry of sliced) {
      if (!entry.link || !entry.title) continue;

      const rawContent = (entry as any).content || (entry as any).rawDescription || entry.description || '';
      const summary = cleanTextSnippet(rawContent) || cleanTextSnippet(entry.title);
      const publishedAt = entry.published || new Date().toISOString();
      const digestDate = toLocalDateString(publishedAt);
      const entryTitle = cleanTextSnippet(entry.title);
      const guid = String((entry as any).rawGuid || entry.id || entry.link);

      const isAihotDigest = config.id === 'aihot' || entryTitle.includes('日报');
      const digestChildren = isAihotDigest ? parseDigestItems(rawContent, guid, publishedAt) : [];

      if (digestChildren.length > 0) {
        items.push({
          source: config.id,
          source_type: 'digest',
          url: entry.link,
          title: entryTitle,
          summary,
          published_at: publishedAt,
          raw_content: cleanTextSnippet(rawContent).slice(0, 8192) || rawContent.slice(0, 8192),
          digest_date: digestDate,
        });
        for (const child of digestChildren) {
          items.push({
            source: config.id,
            source_type: 'rss',
            url: child.url,
            title: child.title,
            summary: '',
            published_at: child.published_at,
            raw_content: null,
            parent_digest: child.parent_digest,
            digest_section: child.section,
            digest_date: digestDate,
          });
        }
      } else {
        items.push({
          source: config.id,
          source_type: config.type || 'rss',
          url: entry.link,
          title: entryTitle,
          summary,
          published_at: publishedAt,
          raw_content: rawContent.slice(0, 8192),
          digest_date: digestDate,
        });
      }
    }

    return {
      sourceId: config.id,
      success: true,
      items,
      durationMs: Date.now() - startTime,
    };
  } catch (err: any) {
    return {
      sourceId: config.id,
      success: false,
      items: [],
      error: err?.message || String(err),
      durationMs: Date.now() - startTime,
    };
  }
}
