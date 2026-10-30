import type { Pool } from "pg";
import { CommandExecutor,KernelError,sha256Fingerprinter,systemClock,uuidIds,type RequestContext } from "@shadow/kernel";
import { PostgresUnitOfWork } from "./postgres.js";
/** Rebuild only days whose source material changed; no model or external calls. */
export async function materializeCaptureReviews(pool:Pool,limit=20){
 if(!Number.isInteger(limit)||limit<1||limit>100)throw new RangeError("Review limit must be 1–100");
 const rows=await pool.query(`select a.subject_id,a.time_zone,(a.started_at at time zone a.time_zone)::date::text date
 from activity_captures a left join capture_reviews r on r.subject_id=a.subject_id and r.time_zone=a.time_zone and r.period='day' and r.from_on=(a.started_at at time zone a.time_zone)::date
 group by a.subject_id,a.time_zone,(a.started_at at time zone a.time_zone)::date,r.generated_at
 having r.generated_at is null or max(a.material_updated_at)>r.generated_at
 order by min(a.material_updated_at),a.subject_id limit $1`,[limit]);
 const executor=new CommandExecutor({unitOfWork:new PostgresUnitOfWork(pool),ids:uuidIds,clock:systemClock,fingerprinter:sha256Fingerprinter});const outcomes=[];
 for(const row of rows.rows){
  const context:RequestContext={actorId:row.subject_id,subjectId:row.subject_id,clientId:"worker_capture_review",traceId:uuidIds.next("event"),effects:new Set(["library.item.write","library.item.read"])};
  let failed=false;
  for(const period of ["day","week","month"]){try{await executor.execute(context,{protocol:"shadow.command",command_id:`cmd_${crypto.randomUUID()}`,capability:"life.generate_activity_review",input:{date:row.date,time_zone:row.time_zone,period}});}
  catch(error){if(!(error instanceof KernelError))throw error;failed=true;}}
  outcomes.push({date:row.date,state:failed?"partial":"completed"});
 }
 return outcomes;
}
