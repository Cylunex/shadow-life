import { tripConnectionsResultSchema, type TripConnection } from "@shadow/contracts";

export const connectionModes={walk:"步行",metro:"地铁",bus:"公交",rail:"铁路",taxi:"打车",car:"驾车",other:"其他"} as const;
export function connectionDescription(row:TripConnection) {
  if(row.status==="check_stops")return "停留点已调整，请重选";
  if(row.status==="check_booking")return "预订状态已变更，请重选";
  if(row.margin_minutes===null)return "时间待补";
  return row.margin_minutes<0?`来不及，差 ${-row.margin_minutes} 分钟`:`可机动 ${row.margin_minutes} 分钟`;
}
export async function fetchConnections(tripId:string,headers:HeadersInit,signal?:AbortSignal){
  const response=await fetch(`/api/travel/connections?trip_id=${encodeURIComponent(tripId)}`,{headers,...(signal?{signal}:{})});
  if(!response.ok)throw new Error("行程衔接读取失败");
  return tripConnectionsResultSchema.parse(await response.json());
}
