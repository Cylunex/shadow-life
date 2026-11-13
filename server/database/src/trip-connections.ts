import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { saveTripConnectionSchema, type TripConnection } from "@shadow/contracts";
import { conflict, connectionMargin, type TransactionStore } from "@shadow/kernel";

type Database=Pick<NodePgDatabase,"execute">;
type Write=Parameters<TransactionStore["executeDomainWrite"]>[0];

export async function writeTripConnection(database:Database,{subjectId,command,nextId}:Write):ReturnType<TransactionStore["executeDomainWrite"]>{
  const input=saveTripConnectionSchema.parse(command.input);
  const day=(await database.execute<{revision:number;items:Array<{stop_id:string}>}>(sql`
    select revision,items from trip_day_plans where id=${input.day_plan_id} and trip_id=${input.trip_id} for update`)).rows[0];
  if(!day || day.revision!==input.plan_revision)throw conflict("日程已变更，请重新读取");
  const origin=day.items.findIndex(item=>item.stop_id===input.from_stop_id);
  if(origin<0 || (input.to_stop_id && day.items[origin+1]?.stop_id!==input.to_stop_id))throw conflict("请选择当前相邻的停留点");
  if(input.reservation_id){
    const booking=await database.execute(sql`select id from reservations where id=${input.reservation_id}
      and trip_id=${input.trip_id} and voided_at is null and state='confirmed'
      and (subject_id=${subjectId} or visibility='shared') for share`);
    if(!booking.rowCount)throw conflict("预订不可用，请重选已确认的预订");
  }
  const prior=(await database.execute<{id:string;revision:number}>(sql`select id,revision from trip_connections
    where day_plan_id=${input.day_plan_id} and from_stop_id=${input.from_stop_id}
      and to_stop_id is not distinct from ${input.to_stop_id??null}
      and reservation_id is not distinct from ${input.reservation_id??null} for update`)).rows[0];
  if(prior?.revision!==input.expected_revision)throw conflict("衔接估时已更新，请重新读取");
  const id=prior?.id??nextId("connection"),revision=(prior?.revision??0)+1;
  if(prior)await database.execute(sql`update trip_connections set departure_at=${input.departure_at},mode=${input.mode},
    travel_minutes=${input.travel_minutes},buffer_minutes=${input.buffer_minutes},revision=${revision},updated_at=now() where id=${id}`);
  else await database.execute(sql`insert into trip_connections(id,day_plan_id,from_stop_id,to_stop_id,reservation_id,departure_at,mode,travel_minutes,buffer_minutes)
    values(${id},${input.day_plan_id},${input.from_stop_id},${input.to_stop_id??null},${input.reservation_id??null},
      ${input.departure_at},${input.mode},${input.travel_minutes},${input.buffer_minutes})`);
  return {resources:[{type:"trip_connection",id,revision}],actualValues:{connection_id:id,revision}};
}

export async function readTripConnections(database:Database,subjectId:string,tripId:string){
  const result=await database.execute<TripConnection & {adjacent:boolean;booking_ok:boolean}>(sql`
    select c.id,c.day_plan_id,d.plan_date::text,c.from_stop_id,c.to_stop_id,c.reservation_id,c.mode,c.travel_minutes,c.buffer_minutes,c.revision,
      to_char(c.departure_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') departure_at,
      origin.item->>'title' from_title,coalesce(b.title,dest.item->>'title') to_title,
      coalesce(to_char(b.starts_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),dest.item->>'starts_at') target_at,
      dest.position=origin.position+1 adjacent,(b.state='confirmed' and b.voided_at is null) booking_ok
    from trip_connections c join trip_day_plans d on d.id=c.day_plan_id join trips t on t.id=d.trip_id
    left join reservations b on b.id=c.reservation_id
    left join lateral jsonb_array_elements(d.items) with ordinality origin(item,position) on origin.item->>'stop_id'=c.from_stop_id
    left join lateral jsonb_array_elements(d.items) with ordinality dest(item,position) on dest.item->>'stop_id'=c.to_stop_id
    where t.id=${tripId} and (t.subject_id=${subjectId} or exists(select 1 from trip_members m where m.trip_id=t.id and m.subject_id=${subjectId}))
      and (c.reservation_id is null or (b.subject_id=${subjectId} or b.visibility='shared'))
    order by d.plan_date,origin.position,c.id`);
  return {as_of:new Date().toISOString(),items:result.rows.map(({adjacent,booking_ok,...row})=>{
    const status=!row.from_title || (row.to_stop_id&&!adjacent)?"check_stops":row.reservation_id&&!booking_ok?"check_booking":
      !row.target_at||row.travel_minutes===null?"missing_time":"ready";
    return {...row,status,margin_minutes:status==="ready"?connectionMargin(row.departure_at,row.target_at!,row.travel_minutes!,row.buffer_minutes):null};
  })};
}
