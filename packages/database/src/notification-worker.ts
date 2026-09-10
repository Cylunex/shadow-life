import { createHash } from "node:crypto";
import type { Pool } from "pg";

function notificationId(subjectId:string,sourceType:string,sourceId:string,kind:string):string{return`notification_${createHash("sha256").update(`${subjectId}:${sourceType}:${sourceId}:${kind}`).digest("hex").slice(0,24)}`;}

export async function materializeNotifications(pool:Pool):Promise<number>{
  const due=await pool.query<{subject_id:string;id:string;scheduled_at:Date}>("select plan.subject_id,occurrence.id,(occurrence.due_on::timestamp+coalesce(plan.local_time,time '09:00')) at time zone plan.time_zone scheduled_at from recurring_occurrences occurrence join recurring_plans plan on plan.id=occurrence.plan_id where occurrence.state in ('pending','reminded','snoozed') and occurrence.due_on between current_date-1 and current_date+7");
  const failed=await pool.query<{subject_id:string;id:string;scheduled_at:Date}>("select subject_id,id,updated_at scheduled_at from library_processing_jobs where state='failed' and updated_at>=now()-interval '7 days'");let inserted=0;
  for(const row of due.rows){const result=await pool.query("insert into notifications(id,subject_id,source_type,source_id,kind,redacted_title,redacted_body,scheduled_at) values($1,$2,'recurring_occurrence',$3,'due','有一项计划即将到期','打开 Shadow Life 查看详情。',$4) on conflict(subject_id,source_type,source_id,kind) do nothing",[notificationId(row.subject_id,"recurring_occurrence",row.id,"due"),row.subject_id,row.id,row.scheduled_at]);inserted+=result.rowCount??0;}
  for(const row of failed.rows){const result=await pool.query("insert into notifications(id,subject_id,source_type,source_id,kind,redacted_title,redacted_body,scheduled_at) values($1,$2,'library_processing_job',$3,'processing_failed','资料处理需要留意','打开 Shadow Life 查看失败状态并决定是否重试。',$4) on conflict(subject_id,source_type,source_id,kind) do nothing",[notificationId(row.subject_id,"library_processing_job",row.id,"processing_failed"),row.subject_id,row.id,row.scheduled_at]);inserted+=result.rowCount??0;}
  return inserted;
}
