import {sql} from "drizzle-orm";
import type {NodePgDatabase} from "drizzle-orm/node-postgres";
import {destinationCardSchema,type DestinationQuery} from "@shadow/contracts";
import {conflict,type TransactionStore} from "@shadow/kernel";

type Database=Pick<NodePgDatabase,"execute">;
type Write=Parameters<TransactionStore["executeDomainWrite"]>[0];
function validHotel(tripId:string,subject:string,on:string){
  return sql`b.trip_id=${tripId} and b.reservation_type='hotel' and b.state='confirmed' and b.voided_at is null
    and (b.subject_id=${subject} or b.visibility='shared') and (b.starts_at at time zone t.time_zone)::date<=${on}::date
    and (b.ends_at at time zone t.time_zone)::date>${on}::date`;
}
export async function saveDestination(database:Database,{subjectId,command,nextId}:Write):ReturnType<TransactionStore["executeDomainWrite"]>{
  const v=destinationCardSchema.parse(command.input);
  const trip=await database.execute(sql`select t.id from trips t where t.id=${v.trip_id} and ${v.on}::date between t.starts_on and t.ends_on
    and (t.subject_id=${subjectId} or exists(select 1 from trip_members m where m.trip_id=t.id and m.subject_id=${subjectId})) for share`);
  if(!trip.rowCount)throw conflict("旅程不可用或日期不在旅程内");
  if(v.place_id&&!(await database.execute(sql`select id from places where id=${v.place_id} and subject_id=${subjectId} for share`)).rowCount)throw conflict("地点不可用");
  if(v.reservation_id&&!(await database.execute(sql`select b.id from reservations b join trips t on t.id=b.trip_id
    where b.id=${v.reservation_id} and ${validHotel(v.trip_id,subjectId,v.on)} for share of b`)).rowCount)throw conflict("当天住宿已变更");
  const result=await database.execute<{id:string;revision:number}>(sql`insert into destination_cards as d(id,subject_id,trip_id,on_date,reservation_id,place_id,local_name,address,entrance)
    select ${nextId("destination")},${subjectId},${v.trip_id},${v.on}::date,${v.reservation_id??null},${v.place_id??null},${v.local_name??null},${v.address??null},${v.entrance??null}
    where ${v.expected_revision??null}::int is null or exists(select 1 from destination_cards where subject_id=${subjectId} and trip_id=${v.trip_id} and on_date=${v.on}::date)
    on conflict(subject_id,trip_id,on_date) do update set reservation_id=excluded.reservation_id,place_id=excluded.place_id,local_name=excluded.local_name,
    address=excluded.address,entrance=excluded.entrance,revision=d.revision+1 where d.revision=${v.expected_revision??null}
    returning id,revision`);
  const row=result.rows[0];if(!row)throw conflict("目的地卡已更新，请重新读取");
  return {resources:[{type:"destination_card",...row}],actualValues:{card_id:row.id,revision:row.revision}};
}

export async function destinations(database:Database,subject:string,v:DestinationQuery){
  const days=await database.execute(sql`with allowed as (
    select t.* from trips t where t.id=${v.trip_id} and (t.subject_id=${subject} or exists(select 1 from trip_members m where m.trip_id=t.id and m.subject_id=${subject}))
    ), dates as (
      select t.*,d::date on_date from allowed t cross join lateral generate_series(
        greatest(t.starts_on,coalesce(${v.on??null}::date,t.starts_on))::timestamp,least(t.ends_on,coalesce(${v.on??null}::date,t.ends_on))::timestamp,'1 day') d
    ) select t.on_date::text,d.revision,d.place_id,d.reservation_id,
      case when d.id is not null and (d.reservation_id is null or chosen.id is not null) then coalesce(p.name,chosen.title) else hotel.title end name,
      case when d.id is not null and (d.reservation_id is null or chosen.id is not null) then d.local_name end local_name,
      case when d.id is not null and (d.reservation_id is null or chosen.id is not null) then coalesce(d.address,p.address,chosen.destination) else hotel.destination end address,
      case when d.id is not null and (d.reservation_id is null or chosen.id is not null) then d.entrance end entrance,
      case when d.id is not null and (d.reservation_id is null or chosen.id is not null) then chosen.id else hotel.id end hotel_id
    from dates t left join destination_cards d on d.subject_id=${subject} and d.trip_id=t.id and d.on_date=t.on_date
    left join places p on p.id=d.place_id and p.subject_id=${subject}
    left join lateral(select b.id,b.title,b.destination from reservations b where b.trip_id=t.id and b.reservation_type='hotel'
      and b.voided_at is null and b.state='confirmed' and (b.subject_id=${subject} or b.visibility='shared')
      and (b.starts_at at time zone t.time_zone)::date<=t.on_date and (b.ends_at at time zone t.time_zone)::date>t.on_date
      order by b.starts_at desc,b.id limit 1) hotel on true
    left join reservations chosen on chosen.id=d.reservation_id and chosen.trip_id=t.id and chosen.voided_at is null and chosen.state='confirmed'
      and (chosen.subject_id=${subject} or chosen.visibility='shared') and (chosen.starts_at at time zone t.time_zone)::date<=t.on_date
      and (chosen.ends_at at time zone t.time_zone)::date>t.on_date
    where d.id is not null or hotel.id is not null order by t.on_date`);
  return {as_of:new Date().toISOString(),items:days.rows.map(row=>({...row,reservation_id:row.reservation_id===row.hotel_id?row.reservation_id:null}))};
}
