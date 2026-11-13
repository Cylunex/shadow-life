import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { healthWellbeingPayloadSchema, saveMorningCheckinSchema } from "@shadow/contracts";
import { conflict, type TransactionStore } from "@shadow/kernel";

type Database = Pick<NodePgDatabase, "execute">;
type Write = Parameters<TransactionStore["executeDomainWrite"]>[0];

export async function projectWellbeing(database:Database, subjectId:string, rawId:string, version:number, payload:unknown) {
  const value = healthWellbeingPayloadSchema.parse(payload);
  const id = "healthfact_" + createHash("sha256").update(rawId).digest("hex").slice(0,24);
  await database.execute(sql`
    insert into health_daily_wellbeing
      (id,subject_id,raw_id,raw_version,occurred_on,time_zone,mood_score,energy_level,sleep_quality,morning_erection,notes,effective)
    values (${id},${subjectId},${rawId},${version},${value.occurred_on},${value.time_zone},${value.mood_score??null},
            ${value.energy_level??null},${value.sleep_quality??null},${value.morning_erection??null},${value.notes??null},true)
    on conflict(raw_id) do update set raw_version=excluded.raw_version,occurred_on=excluded.occurred_on,time_zone=excluded.time_zone,
      mood_score=excluded.mood_score,energy_level=excluded.energy_level,sleep_quality=excluded.sleep_quality,
      morning_erection=excluded.morning_erection,notes=excluded.notes,effective=true,revision=health_daily_wellbeing.revision+1`);
  return {id,date:value.occurred_on};
}

export async function writeMorningCheckin(database:Database,{subjectId,command,nextId}:Write):ReturnType<TransactionStore["executeDomainWrite"]> {
  const input = saveMorningCheckinSchema.parse(command.input);
  const sourceKey = "morning_checkin";
  await database.execute(sql`insert into health_source_instances(id,subject_id,source_type,instance_key)
    values(${nextId("source")},${subjectId},'manual',${sourceKey}) on conflict(subject_id,source_type,instance_key) do nothing`);
  const source = (await database.execute<{id:string}>(sql`select id from health_source_instances
    where subject_id=${subjectId} and source_type='manual' and instance_key=${sourceKey}`)).rows[0]!;
  const identity = JSON.stringify([input.wake_date,input.time_zone]);
  const payload = {occurred_on:input.wake_date,time_zone:input.time_zone,energy_level:input.energy_level,sleep_quality:input.sleep_quality,notes:input.notes};
  const hash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  const version = (input.expected_revision ?? 0) + 1;
  // The unique source identity also serializes two first submissions for the same morning.
  const record = input.expected_revision === undefined
    ? await database.execute<{id:string}>(sql`insert into health_raw_records
        (id,subject_id,source_instance_id,record_type,client_record_id,current_version,current_sync_epoch,current_hash,state,received_at)
        values(${nextId("raw")},${subjectId},${source.id},'wellbeing',${identity},1,1,${hash},'normalized',${input.filled_at})
        on conflict(subject_id,source_instance_id,record_type,client_record_id) do nothing returning id`)
    : await database.execute<{id:string}>(sql`update health_raw_records set current_version=${version},current_hash=${hash}
        where subject_id=${subjectId} and source_instance_id=${source.id} and client_record_id=${identity}
          and record_type='wellbeing' and current_version=${input.expected_revision} returning id`);
  const raw = record.rows[0];
  if (!raw) throw conflict("晨评已有更新，请读取最新版本后保存");
  await database.execute(sql`insert into health_raw_revisions(raw_id,record_version,payload_hash,payload,change_kind)
    values(${raw.id},${version},${hash},${JSON.stringify(payload)}::jsonb,'upsert')`);
  const fact = await projectWellbeing(database,subjectId,raw.id,version,payload);
  await database.execute(sql`insert into health_projection_invalidations(subject_id,occurred_on,projection_key,algorithm_version,valid)
    values(${subjectId},${input.wake_date},'daily_health','health-normalizer',false)
    on conflict(subject_id,occurred_on,projection_key,algorithm_version) do update set valid=false,updated_at=now()`);
  return {resources:[{type:"health_raw",id:raw.id,revision:version+1}],actualValues:{record_id:fact.id,revision:version,wake_date:input.wake_date}};
}

export async function readMorningWindow(database:Database,subjectId:string,to:string,timeZone:string) {
  const result = await database.execute(sql`
    select (${to}::date - day_offset)::text as wake_date, night.value as sleep, morning.value as checkin
    from generate_series(0,13) as day_offset
    left join lateral (
      select jsonb_build_object('id',id,'minutes',total_minutes) as value from health_sleep_sessions
      where subject_id=${subjectId} and effective and wake_date=${to}::date-day_offset and time_zone=${timeZone}
      order by total_minutes desc,revision desc,id limit 1
    ) night on true
    left join lateral (
      select jsonb_build_object('id',fact.id,'revision',raw.current_version,'filled_at',raw.received_at,
        'energy_level',fact.energy_level,'sleep_quality',fact.sleep_quality,'notes',fact.notes) as value
      from health_daily_wellbeing fact join health_raw_records raw on raw.id=fact.raw_id
      join health_source_instances src on src.id=raw.source_instance_id
      where fact.subject_id=${subjectId} and fact.effective and src.source_type='manual' and src.instance_key='morning_checkin'
        and fact.time_zone=${timeZone} and fact.occurred_on=${to}::date-day_offset
    ) morning on true order by day_offset`);
  return {days:result.rows};
}
