/**
 * Resolves system IANA time zone with fallback to Asia/Shanghai.
 */
export function resolveTimeZone(customTz?: string): string {
  if (customTz && typeof customTz === 'string' && customTz.trim()) {
    try {
      // Validate time zone name by trying to format
      Intl.DateTimeFormat(undefined, { timeZone: customTz.trim() });
      return customTz.trim();
    } catch {
      // Invalid time zone, fall through
    }
  }

  try {
    const sysTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (sysTz && sysTz.trim()) {
      return sysTz.trim();
    }
  } catch {
    // Ignore error
  }

  return 'Asia/Shanghai';
}
