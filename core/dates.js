// Asia/Bishkek: UTC+6 all year, no daylight saving time.
export const TZ_OFFSET_MS = 6 * 3600000;

// Calendar date 'YYYY-MM-DD' of a timestamp (ms) in Bishkek.
export function localDate(ms) {
  return new Date(ms + TZ_OFFSET_MS).toISOString().slice(0, 10);
}
