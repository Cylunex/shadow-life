import { useState } from "react";
import { formatInTimeZone } from "./travel-time.js";
import { isConfirmedOvernight, reservationDayLabel, reservationIsInactive, reservationsForDay, reservationStateLabel, reservationTypeLabel, type TravelReservation } from "./travel-reservations.js";

export function TravelReservations({ reservations, date, zone, loading, error, onRetry }: {
  reservations: readonly TravelReservation[]; date: string | undefined; zone: string;
  loading: boolean; error: string | undefined; onRetry: () => void;
}) {
  const [scope, setScope] = useState<"day" | "all">("day");
  const shown = scope === "all" ? reservations : reservationsForDay(reservations, date ?? "", zone);
  const undated = scope === "day" ? reservations.filter(item => !item.starts_at && !item.ends_at) : [];
  const time = (instant: string | null) => instant ? formatInTimeZone(instant, zone).replace("T", " ") : "未定";
  function cards(items: readonly TravelReservation[]) {
    return <ul className="reservation-cards">{items.map((item, index) => <li key={item.id??index} className={reservationIsInactive(item) ? "inactive" : ""}>
      <div className="panel-heading"><strong>{item.title}</strong><span className="reservation-state">{reservationStateLabel(item.state)}</span></div>
      <p>{reservationTypeLabel(item.reservation_type)}{item.service_number ? ` · ${item.service_number}` : ""}{scope === "day" && date && reservationDayLabel(item, date, zone) ? ` · ${reservationDayLabel(item, date, zone)}` : ""}</p>
      {scope === "day" && date && isConfirmedOvernight(item, date, zone) && <p className="reservation-night">当晚住宿（已确认预订）</p>}
      <p>{item.reservation_type === "hotel" ? "入住" : "开始"}：{time(item.starts_at)}<br/>{item.reservation_type === "hotel" ? "退房" : "结束"}：{time(item.ends_at)}</p>
      {(item.origin || item.destination) && <p>{item.origin ?? "出发地未填"} → {item.destination ?? "目的地未填"}</p>}
      {(item.confirmation_code || item.seat) && <details><summary>查看确认号与座位</summary>{item.confirmation_code && <p>确认号：<code>{item.confirmation_code}</code></p>}{item.seat && <p>座位：{item.seat}</p>}</details>}
    </li>)}</ul>;
  }
  return <section className="travel-reservations" aria-label="旅行预订">
    <div className="panel-heading"><h3>预订与住宿</h3><label>预订范围<select value={scope} onChange={event => setScope(event.target.value as "day" | "all")}><option value="day">当天 · {date}</option><option value="all">全部预订</option></select></label></div>
    <p className="form-context">按旅程时区 {zone} 显示。预订不代表实际到访或付款；候补、改签仍保留原状态。</p>
    {loading ? <p role="status">正在读取预订…</p> : error ? <div role="alert"><p className="inline-error">{error}</p><button type="button" className="secondary" onClick={onRetry}>重试读取预订</button></div> : <>
      {shown.length ? cards(shown) : <p>{scope === "day" ? "当天没有已记录日期的预订。" : "还没有预订，可在上方添加。"}</p>}
      {undated.length > 0 && <details className="undated-reservations"><summary>未定时间 · {undated.length} 项</summary>{cards(undated)}</details>}
    </>}
  </section>;
}
