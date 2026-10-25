import { formatInTimeZone } from "./travel-time.js";
import { itineraryDates, type TravelDayPlan, type TravelPlace, type TravelTrip } from "./travel-workspace.js";

export function TravelItinerary({trip,plans,places=[],date,onDate,onEdit}:{trip:Pick<TravelTrip,"starts_on"|"ends_on"|"time_zone">;plans:readonly TravelDayPlan[];places?:readonly TravelPlace[];date:string|undefined;onDate:(date:string)=>void;onEdit?:(()=>void)|undefined}){
  const dates=itineraryDates(trip,plans),plan=plans.find(item=>item.plan_date===date),index=dates.indexOf(date??"");
  return <section className="daily-itinerary" aria-label="每日行程">
    <div className="itinerary-date-bar"><button type="button" className="secondary" aria-label="前一天" disabled={index<=0} onClick={()=>onDate(dates[index-1]!)}>‹</button><label>行程日期<select value={date??""} onChange={event=>onDate(event.target.value)}>{dates.map((day,position)=><option key={day} value={day}>第 {position+1} 天 · {day} · {plans.find(item=>item.plan_date===day)?.items.length??0} 站</option>)}</select></label><button type="button" className="secondary" aria-label="后一天" disabled={index<0||index===dates.length-1} onClick={()=>onDate(dates[index+1]!)}>›</button></div>
    <div className="panel-heading"><div><h3>{date} · {plan?.items.length??0} 个停留点</h3><small>时间按 {trip.time_zone} 显示</small></div>{onEdit&&<button type="button" onClick={onEdit}>{plan?"调整当天":"安排当天"}</button>}</div>
    {!plan?.items.length?<p className="itinerary-empty">当天还没有安排，可以添加地点或留作自由活动。</p>:<ol className="itinerary-stops">{plan.items.map((stop,index)=>{const place=places.find(item=>item.id===stop.place_id);return <li key={stop.stop_id}><span className="stop-number">{index+1}</span><div><time>{stop.starts_at?formatInTimeZone(stop.starts_at,trip.time_zone).slice(11):"时间待定"}</time><h4>{stop.title}</h4>{place&&<p>{place.name}{place.address?` · ${place.address}`:""}</p>}{stop.note&&<p className="stop-note">{stop.note}</p>}</div></li>;})}</ol>}
  </section>;
}
