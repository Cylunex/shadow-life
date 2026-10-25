import type { deadlineStateSchema, itemAttentionSchema, stockAttentionSchema } from "@shadow/contracts";

export type Deadline = ReturnType<typeof deadlineStateSchema.parse>;
export type StockAttention = ReturnType<typeof stockAttentionSchema.parse>;
export type ItemAttention = ReturnType<typeof itemAttentionSchema.parse>;
export const isUpcoming = (value: Deadline | undefined) => value?.state === "today" || value?.state === "soon";
export function deadlineLabel(value: Deadline | undefined): string {
  if (!value) return "期限状态未载入";
  switch (value.state) {
    case "past": return `已过期 ${Math.abs(value.days_until ?? 0)} 天`;
    case "today": return "今天截止";
    case "soon": return `剩 ${value.days_until} 天`;
    case "later": return `还有 ${value.days_until} 天`;
    case "inactive": return "已不再持有";
    case "empty": return "已用完";
    case "unknown": return "未记录日期";
  }
}
