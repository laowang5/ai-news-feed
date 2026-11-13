const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MIN_SECTION_CHARS = 200;
const MAX_HTML_BYTES = 2 * 1024 * 1024;

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_m, dec) => {
      const code = Number(dec);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    })
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    });
}

function stripTagsToText(htmlFragment: string): string {
  const withoutNoise = htmlFragment
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  const withSpaces = withoutNoise.replace(/<\/?(p|div|section|article|main|li|br|h[1-6]|tr|td|th|blockquote|pre)\b[^>]*>/gi, ' ');
  const plain = withSpaces.replace(/<[^>]+>/g, ' ');
  return decodeHtmlEntities(plain).replace(/\s+/g, ' ').trim();
}

function extractMetaContent(html: string, attrType: 'property' | 'name', attrValue: string): string {
  const metaRegex = /<meta\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = metaRegex.exec(html)) !== null) {
    const tag = match[0];
    const keyMatch = new RegExp(`\\b${attrType}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
    const keyVal = (keyMatch?.[1] || keyMatch?.[2] || keyMatch?.[3] || '').trim().toLowerCase();
    if (keyVal !== attrValue.toLowerCase()) continue;

    const contentMatch = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    const rawContent = contentMatch?.[1] ?? contentMatch?.[2] ?? contentMatch?.[3] ?? '';
    const cleaned = decodeHtmlEntities(rawContent).replace(/\s+/g, ' ').trim();
    if (cleaned) return cleaned;
  }
  return '';
}

function extractTagText(html: string, tagName: 'article' | 'main'): string {
  const regex = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'gi');
  const parts: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const text = stripTagsToText(match[1]);
    if (text) parts.push(text);
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Extract readable article text from HTML with priority:
 * og:description -> <article>/<main> -> meta[name=description], picking first >= 200 chars.
 * When both og:description and <article>/<main> are >= 200 chars, combines them so full body text is preserved.
 */
export function extractContentFromHtml(html: string, minChars: number = DEFAULT_MIN_SECTION_CHARS): string {
  if (!html || typeof html !== 'string') return '';

  const ogDesc = extractMetaContent(html, 'property', 'og:description') || extractMetaContent(html, 'name', 'og:description');
  const articleText = extractTagText(html, 'article') || extractTagText(html, 'main');
  const metaDesc = extractMetaContent(html, 'name', 'description');

  if (ogDesc.length >= minChars && articleText.length >= minChars) {
    if (articleText.includes(ogDesc)) {
      return articleText;
    }
    return `${ogDesc}\n\n${articleText}`;
  }

  if (ogDesc.length >= minChars) return ogDesc;
  if (articleText.length >= minChars) return articleText;
  if (metaDesc.length >= minChars) return metaDesc;
  return '';
}

export interface FetchArticleOptions {
  timeoutMs?: number;
  retries?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Fetch an article URL and extract clean text content.
 * Retries once on failure/timeout and silently returns '' without throwing.
 */
export async function fetchArticleContent(url: string, opts: FetchArticleOptions = {}): Promise<string> {
  if (!url || typeof url !== 'string') return '';
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return '';
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return '';
  }

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = opts.retries ?? 1;
  const fetchFn = opts.fetchImpl ?? fetch;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetchFn(parsedUrl.toString(), {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'User-Agent': 'ai-news-feed/0.9 (+https://github.com/dsh-plugins/ai-news-feed)',
          Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5',
        },
      });

      if (!res.ok) {
        continue;
      }

      const contentType = res.headers?.get?.('content-type') || '';
      if (contentType && !/(text\/html|application\/xhtml\+xml|text\/plain)/i.test(contentType)) {
        return '';
      }

      const html = (await res.text()).slice(0, MAX_HTML_BYTES);
      return extractContentFromHtml(html);
    } catch {
      // Silent retry / fallback per spec W5.1
    } finally {
      clearTimeout(timer);
    }
  }

  return '';
}
