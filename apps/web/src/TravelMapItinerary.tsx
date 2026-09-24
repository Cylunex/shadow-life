import {googleDirectionsUrl,hasPlaceCoordinates,isOptionalTravelStop,routeForDay,type TravelDayPlan,type TravelPlace} from "./travel-workspace.js";

export function TravelMapItinerary({places,plans,selectedDate,scope}:{places:readonly TravelPlace[];plans:readonly TravelDayPlan[];selectedDate:string|undefined;scope:"day"|"all"}){
  const visible=scope==="day"?plans.filter(plan=>plan.plan_date===selectedDate):plans;
  const byId=new Map(places.map(place=>[place.id,place]));
  const count=visible.reduce((sum,plan)=>sum+plan.items.filter(stop=>{const place=stop.place_id?byId.get(stop.place_id):undefined;return place&&hasPlaceCoordinates(place);}).length,0);
  return <details className="travel-map-itinerary" open={scope==="day"}>
    <summary>{scope==="day"?"当天地点":"全程地点"} · {count} 个可定位停留点 <span>展开地点与路线</span></summary>
    {visible.length===0?<p>当前范围还没有保存日程。</p>:visible.map(plan=>{const route=routeForDay(places,plan);const legs=route.lines.flatMap(line=>line.slice(1).map((point,index)=>({from:line[index]!,to:point})));return <section key={plan.id}>
      <h4>{plan.plan_date} · {plan.items.length} 项</h4>
      <ol>{plan.items.map((stop,index)=>{const place=stop.place_id?byId.get(stop.place_id):undefined;const located=place&&hasPlaceCoordinates(place);return <li key={stop.stop_id}><b>{index+1}. {stop.title}</b><small>{located?`${place.name}${isOptionalTravelStop(stop)?" · 弹性备选，不连线":" · 计划地点"}`:place?"地点未录坐标":"未关联地点"}</small></li>;})}</ol>
      {scope==="day"&&legs.length>0&&<div className="travel-route-links">{legs.map((leg,index)=><a key={index} href={googleDirectionsUrl(leg.from,leg.to)} target="_blank" rel="noopener noreferrer">在 Google 地图查看第 {index+1} 段道路路线 ↗</a>)}</div>}
    </section>;})}
  </details>;
}
