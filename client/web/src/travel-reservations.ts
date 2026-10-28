import { formatInTimeZone } from "./travel-time.js";

export const reservationStates = { pending: "待确认", waitlisted: "候补", confirmed: "已确认", changed: "已改签", cancelled: "已取消", refunded: "已退款" } as const;
export const reservationTypes = { flight: "航班", rail: "铁路", hotel: "住宿", restaurant: "餐厅", activity: "活动", other: "其他" } as const;
export interface TravelReservation {
  id?: string;
  title: string;
  reservation_type: string;
  state: string;
  starts_at: string | null;
  ends_at: string | null;
  origin: string | null;
  destination: string | null;
  confirmation_code?: string | null;
  seat?: string | null;
  service_number?: string | null;
}

export function reservationDate(instant: string | null, zone: string): string {
  return instant ? formatInTimeZone(instant, zone).slice(0, 10) : "";
}
export function reservationIsInactive(item: TravelReservation): boolean {
  return item.state === "cancelled" || item.state === "refunded";
}
export function reservationDates(items: readonly TravelReservation[], zone: string): string[] {
  return [...new Set(items.flatMap(item => [reservationDate(item.starts_at, zone), reservationDate(item.ends_at, zone)]).filter(Boolean))].sort();
}

/** A day projection only: it never infers attendance, payment or confirmation. */
export function reservationDayLabel(item: TravelReservation, date: string, zone: string): string | null {
  const start = reservationDate(item.starts_at, zone), end = reservationDate(item.ends_at, zone);
  const hotel = item.reservation_type === "hotel";
  if (start === date && end === date) return hotel ? "当天入住与退房" : "当天开始与结束";
  if (start === date) return hotel ? "入住日" : "开始日";
  if (end === date) return hotel ? "退房日" : "结束日";
  if (!reservationIsInactive(item) && start && end && start < date && date < end) return hotel ? "住宿期间（按预订）" : "跨日预订";
  return null;
}

export function isConfirmedOvernight(item: TravelReservation, date: string, zone: string): boolean {
  const start = reservationDate(item.starts_at, zone), end = reservationDate(item.ends_at, zone);
  return item.reservation_type === "hotel" && item.state === "confirmed" && Boolean(start && end) && start <= date && date < end;
}

export function reservationsForDay<T extends TravelReservation>(items: readonly T[], date: string, zone: string): T[] {
  const eventTime = (item: T) => reservationDate(item.starts_at, zone) === date ? item.starts_at : reservationDate(item.ends_at, zone) === date ? item.ends_at : null;
  return items.filter(item => reservationDayLabel(item, date, zone) !== null).sort((a, b) => {
    const left = eventTime(a), right = eventTime(b);
    return (left ? Date.parse(left) : -Infinity) - (right ? Date.parse(right) : -Infinity) || a.title.localeCompare(b.title);
  });
}

export function reservationStateLabel(state: string): string { return reservationStates[state as keyof typeof reservationStates] ?? state; }
export function reservationTypeLabel(type: string): string { return reservationTypes[type as keyof typeof reservationTypes] ?? type; }
