import { parseInTimeZone } from "./travel-time.js";

/** Return unobserved spans from the union of observed intervals. */
export function offlineGaps(date: string, timeZone: string, rows: Array<{started_at?: unknown; ended_at?: unknown}>, complete: boolean) {
  const calendar = new Date(date + "T00:00:00Z");
  if (!Number.isFinite(calendar.getTime())) return [];
  const next = new Date(calendar.getTime() + 86_400_000).toISOString().slice(0, 10);
  let from: number, to: number;
  try {
    from = Date.parse(parseInTimeZone(date + "T00:00", timeZone));
    to = Date.parse(parseInTimeZone(next + "T00:00", timeZone));
  } catch { return []; }
  const intervals = rows.map(row => [Math.max(from, Date.parse(String(row.started_at))), Math.min(to, Date.parse(String(row.ended_at)))] as const)
    .filter(([start, end]) => start < end).sort(([a], [b]) => a - b);
  const gaps: Array<{start: number; end: number}> = [];
  let cursor = from;
  for (const [start, end] of intervals) {
    if (start - cursor >= 60_000) gaps.push({start: cursor, end: start});
    cursor = Math.max(cursor, end);
  }
  if (complete && to - cursor >= 60_000) gaps.push({start: cursor, end: to});
  return gaps;
}
