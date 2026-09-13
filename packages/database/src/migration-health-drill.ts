import { Pool } from "pg";
import { writeFile } from "node:fs/promises";
import { processPendingHealth } from "./health-worker.js";

const connectionString=process.env.DATABASE_URL;
if(!connectionString)throw new Error("DATABASE_URL is required");
const mode=process.env.SHADOW_MIGRATION_DRILL==="isolated-empty-database"?"isolated":process.env.SHADOW_MIGRATION_NORMALIZE==="production-frozen"?"production-frozen":null;
if(!mode)throw new Error("normalization requires SHADOW_MIGRATION_DRILL=isolated-empty-database or SHADOW_MIGRATION_NORMALIZE=production-frozen");
const maxRecords=Number(process.argv[2]??2_000),reportPath=process.argv[3];if(!Number.isSafeInteger(maxRecords)||maxRecords<1)throw new Error("max records must be a positive integer");
const pool=new Pool({connectionString});let processed=0;
try{
  if(mode==="production-frozen")await assertProductionFrozen(pool);
  while(processed<maxRecords){
    if(mode==="production-frozen")await assertProductionFrozen(pool);
    const pending=Number((await pool.query("select count(*) count from health_normalization_queue where state in ('pending','failed')")).rows[0]?.count??0);
    if(!pending)break;
    const results=await processPendingHealth(pool,Math.min(250,maxRecords-processed));processed+=results.length;
    if(!results.length||results.some(result=>result.state==="failed"))break;
  }
  const queues=await pool.query("select state,count(*)::int count from health_normalization_queue group by state order by state"),raw=await pool.query("select state,count(*)::int count from health_raw_records group by state order by state"),failures=await pool.query("select raw.record_type,queue.last_error,count(*)::int count from health_normalization_queue queue join health_raw_records raw on raw.id=queue.raw_id where queue.state='failed' group by raw.record_type,queue.last_error order by count(*) desc limit 20"),invalid=await pool.query("select count(*)::int count from health_projection_invalidations where not valid");
  const report={mode,processed,queues:queues.rows,raw:raw.rows,invalid_days:invalid.rows[0]?.count??0,failures:failures.rows};if(reportPath)await writeFile(reportPath,JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify(report));if(failures.rowCount||Number(invalid.rows[0]?.count??0)>0)process.exitCode=2;
}finally{await pool.end();}

async function assertProductionFrozen(pool:Pool){
  const result=await pool.query<{domain:string;stage:string}>("select domain,stage from write_epochs where domain in ('health','ledger') order by domain");
  const state=new Map(result.rows.map(row=>[row.domain,row.stage]));
  if(state.get("health")!=="read_only"||state.get("ledger")!=="read_only")throw new Error(`production normalization requires frozen health and ledger epochs: ${JSON.stringify(Object.fromEntries(state))}`);
}
