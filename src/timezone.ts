/**
 * Check whether a timezone string is a valid IANA identifier
 * that Intl.DateTimeFormat can use.
 */
export function isValidTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Return the given timezone if valid IANA, otherwise fall back to UTC.
 */
export function resolveTimezone(tz: string): string {
  return isValidTimezone(tz) ? tz : 'UTC';
}

/**
 * Convert a UTC ISO timestamp to a localized display string.
 * Uses the Intl API (no external dependencies).
 * Falls back to UTC if the timezone is invalid.
 *
 * IMPORTANT: Rounds timestamps to 5-minute intervals to enable Anthropic prompt caching.
 * This ensures consecutive messages within 5 minutes have identical timestamps,
 * allowing cache hits. See: https://github.com/openclaw/openclaw/issues/19534
 */
export function formatLocalTime(utcIso: string, timezone: string): string {
  const date = new Date(utcIso);

  // Round to nearest 5-minute interval for cache stability
  const roundedMs = Math.floor(date.getTime() / 300000) * 300000;
  const roundedDate = new Date(roundedMs);

  return roundedDate.toLocaleString('en-US', {
    timeZone: resolveTimezone(timezone),
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}
