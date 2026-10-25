import { sql } from "drizzle-orm";

export function agentRefsAvailable(subjectId:string,refs:ReturnType<typeof sql>){
  return sql`not exists (
    select 1 from jsonb_to_recordset(${refs}) ref(kind text,id text,revision integer)
    where not case ref.kind
      when 'meal' then exists(select 1 from meals where id=ref.id and subject_id=${subjectId} and revision=ref.revision and state='active')
      when 'purchase' then exists(select 1 from purchases p join consumption_records r on r.id=p.record_id where p.id=ref.id and p.subject_id=${subjectId} and p.revision=ref.revision and r.state='confirmed')
      when 'money_entry' then exists(select 1 from money_entries e join consumption_records r on r.id=e.record_id where e.id=ref.id and e.subject_id=${subjectId} and e.revision=ref.revision and r.state='confirmed')
      when 'health_measurement' then exists(select 1 from health_measurements where id=ref.id and subject_id=${subjectId} and revision=ref.revision and effective)
      when 'health_workout' then exists(select 1 from health_workout_sessions where id=ref.id and subject_id=${subjectId} and revision=ref.revision and effective)
      when 'trip' then exists(select 1 from trips t where t.id=ref.id and t.revision=ref.revision and (t.subject_id=${subjectId} or exists(select 1 from trip_members m where m.trip_id=t.id and m.subject_id=${subjectId})))
      when 'library_item' then exists(select 1 from library_items i join library_revisions r on r.item_id=i.id where i.id=ref.id and i.subject_id=${subjectId} and i.state='active' and r.revision=ref.revision)
      else false end
  )`;
}
