import type { Pool } from "pg";
import { CommandExecutor,sha256Fingerprinter,systemClock,uuidIds,type RequestContext } from "@shadow/kernel";
import { PostgresUnitOfWork } from "./postgres.js";
/** User policies authorize source retention; deployment retention never applies to personal data. */
export async function maintainCaptureRetention(pool:Pool,limit=20){
 if(!Number.isInteger(limit)||limit<1||limit>100)throw new RangeError('Capture retention limit must be 1–100');
 const owners=await pool.query(`select subject_id from (
 select p.subject_id,p.updated_at from capture_policies p where
 exists(select 1 from activity_captures a where a.subject_id=p.subject_id and a.kind='screen_text' and a.deleted_at is null and not a.protected and (p.policy->>'screen_keep_days')::int is not null and a.started_at<clock_timestamp()-(p.policy->>'screen_keep_days')::int*interval '1 day')
 or exists(select 1 from capture_recording_segments r where r.subject_id=p.subject_id and r.deleted_at is null and r.audio_expired_at is null and not r.protected and r.state='completed' and (p.policy->>'audio_keep_days')::int is not null and r.processed_at<clock_timestamp()-(p.policy->>'audio_keep_days')::int*interval '1 day')
 union select r.subject_id,coalesce(r.deleted_at,r.audio_expired_at) from capture_recording_segments r join asset_blobs b on b.asset_version_id=r.asset_version_id where (r.deleted_at is not null or r.audio_expired_at is not null)
 and not exists(select 1 from capture_recording_segments live where live.asset_version_id=r.asset_version_id and live.deleted_at is null and live.audio_expired_at is null)
 and not exists(select 1 from sources s where s.asset_version_id=r.asset_version_id)
 and not exists(select 1 from library_derivations d where d.source_asset_version_id=r.asset_version_id or d.derived_asset_version_id=r.asset_version_id)
 ) candidates group by subject_id order by min(updated_at) limit $1`,[limit]);
 const executor=new CommandExecutor({unitOfWork:new PostgresUnitOfWork(pool),ids:uuidIds,clock:systemClock,fingerprinter:sha256Fingerprinter});const results=[];
 for(const row of owners.rows){const context:RequestContext={actorId:row.subject_id,subjectId:row.subject_id,clientId:'worker_capture_retention',traceId:uuidIds.next('event'),effects:new Set(['library.item.write'])};const result=await executor.execute(context,{protocol:'shadow.command',capability:'life.cleanup_captures',command_id:'cmd_'+crypto.randomUUID().replaceAll('-',''),input:{limit:50}});results.push(result.actual_values);}
 return results;
}
