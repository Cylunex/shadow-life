import { itemAttentionSchema, stockAttentionSchema, type deadlineStateSchema } from "@shadow/contracts";

function assessmentDate(asOf: string, timeZone: string, on?: string): string {
  return on ?? new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(asOf));
}
function deadline(date: string | null, on: string, soonDays: number, active = true): ReturnType<typeof deadlineStateSchema.parse> {
  if (!active) return { state: "inactive", days_until: null };
  if (!date) return { state: "unknown", days_until: null };
  // Calendar days, not elapsed hours: DST cannot move a date-only deadline.
  const days = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${on}T00:00:00Z`)) / 86_400_000);
  return { state: days < 0 ? "past" : days === 0 ? "today" : days <= soonDays ? "soon" : "later", days_until: days };
}
export function buildStockAttention(lots: readonly { id: string; quantity: string; expires_on: string | null }[], asOf: string, timeZone: string, date?: string) {
  const on = assessmentDate(asOf, timeZone, date);
  return stockAttentionSchema.parse({ on, time_zone: timeZone, soon_days: 7, items: lots.map(lot => ({
    lot_id: lot.id, ...(/[1-9]/u.test(lot.quantity) ? deadline(lot.expires_on, on, 7) : { state: "empty", days_until: null })
  })) });
}
export function buildItemAttention(items: readonly { id: string; ownership_state: string; return_by: string | null; warranty_ends_on: string | null }[], asOf: string, timeZone: string, date?: string) {
  const on = assessmentDate(asOf, timeZone, date);
  return itemAttentionSchema.parse({ on, time_zone: timeZone, return_soon_days: 7, warranty_soon_days: 30, items: items.map(item => ({
    item_id: item.id, return_window: deadline(item.return_by, on, 7, item.ownership_state === "owned"),
    warranty: deadline(item.warranty_ends_on, on, 30, item.ownership_state === "owned")
  })) });
}
