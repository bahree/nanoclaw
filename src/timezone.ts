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
 * Returns the UTC datetime string (YYYY-MM-DD HH:MM:SS) for the start of today
 * in the given timezone. Used for timezone-aware SQLite WHERE clauses.
 */
export function startOfLocalDayUtcString(timezone: string): string {
  const tz = resolveTimezone(timezone);
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) =>
    parseInt(parts.find((p) => p.type === type)!.value);
  const elapsedMs =
    (get('hour') * 3600 + get('minute') * 60 + get('second')) * 1000;
  const midnightUtc = new Date(
    now.getTime() - elapsedMs - now.getMilliseconds(),
  );
  return midnightUtc.toISOString().replace('T', ' ').slice(0, 19);
}

/**
 * Returns a SQLite modifier string (e.g. '+330 minutes') to shift UTC timestamps
 * into the local timezone for date grouping. Uses the current UTC offset.
 */
export function sqliteUtcOffsetModifier(timezone: string): string {
  const tz = resolveTimezone(timezone);
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const lh = parseInt(parts.find((p) => p.type === 'hour')!.value);
  const lm = parseInt(parts.find((p) => p.type === 'minute')!.value);
  let offsetMin =
    lh * 60 + lm - (now.getUTCHours() * 60 + now.getUTCMinutes());
  if (offsetMin > 720) offsetMin -= 1440;
  if (offsetMin < -720) offsetMin += 1440;
  const sign = offsetMin >= 0 ? '+' : '-';
  return `${sign}${Math.abs(offsetMin)} minutes`;
}

/**
 * Convert a UTC ISO timestamp to a localized display string.
 * Uses the Intl API (no external dependencies).
 * Falls back to UTC if the timezone is invalid.
 */
export function formatLocalTime(utcIso: string, timezone: string): string {
  const date = new Date(utcIso);
  return date.toLocaleString('en-US', {
    timeZone: resolveTimezone(timezone),
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}
