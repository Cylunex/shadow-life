import assert from "node:assert/strict";
import test from "node:test";
import {reviewFixture,pgOnly} from "./review-fixture.js";

async function stage(run:(capability:string,input:unknown)=>Promise<any>,id:string,account="家庭"){
  return run("money.stage_import",{format:"csv",source_name:`${id}.csv`,source_account:account,time_zone:"Asia/Shanghai",content:`id,date,type,amount\n${id},2026-10-01,expense,12.30`});
}

test("import history is filtered, owner scoped, and pages equal timestamps without losing precision",pgOnly,async t=>{
  const {run,queries,context,pool,unitOfWork}=await reviewFixture(t);
  const ids=[];for(const id of ["history-1","history-2","history-3"])ids.push(String((await stage(run,id)).actual_values.batch_id));
  await stage(run,"other-account","另一个账户");
  await pool.query("update money_import_batches set created_at='2026-10-01T00:00:00.123456Z'");
  const input={platform:"generic",source_account:"家庭",status:"review",limit:1};
  const first=await queries.moneyImportHistory(context,input);assert.equal(first.items.length,1);assert.ok(first.next_cursor);assert.match(first.items[0]!.created_at,/123456Z$/);assert.equal(first.items[0]!.first_occurred_on,"2026-10-01");assert.equal(first.items[0]!.pending,1);
  const late=await stage(run,"later-upload");await pool.query("update money_import_batches set created_at=$2::timestamptz+interval '1 second' where id=$1",[late.actual_values.batch_id,first.as_of]);
  const all=first.items.map(item=>item.id);let cursor:string|null=first.next_cursor;
  while(cursor){const page=await queries.moneyImportHistory(context,{...input,cursor});all.push(...page.items.map(item=>item.id));cursor=page.next_cursor;assert.equal(page.as_of,first.as_of);}
  assert.deepEqual(all,ids.sort().reverse());assert.equal(new Set(all).size,3);
  await assert.rejects(()=>queries.moneyImportHistory(context,{...input,source_account:"另一个账户",cursor:first.next_cursor}),/cursor/);
  for(const cursor of ["null",JSON.stringify({version:1}),JSON.stringify({version:1,signature:JSON.stringify([context.subjectId,"generic","家庭","review"]),at:"bad",id:ids[0],as_of:first.as_of})])await assert.rejects(()=>queries.moneyImportHistory(context,{...input,cursor:Buffer.from(cursor).toString("base64url")}),/cursor/);
  await unitOfWork.ensurePrincipal("subject_history_other");
  const other={...context,subjectId:"subject_history_other"};assert.deepEqual((await queries.moneyImportHistory(other,{})).items,[]);
  await assert.rejects(()=>queries.moneyImportHistory(other,{...input,cursor:first.next_cursor}),/cursor/);
  await assert.rejects(()=>queries.moneyImportHistory({...context,effects:new Set()},{}),/Missing permission/);
});

test("import history reflects resolution counts and returns completed batches only when requested",pgOnly,async t=>{
  const {run,queries,context}=await reviewFixture(t);
  const result=await stage(run,"resolved");const batch=await queries.moneyImportReview(context,String(result.actual_values.batch_id));
  await run("money.resolve_import_candidate",{candidate_id:batch.candidates[0]!.id,expected_revision:1,decision:"confirm",reason:"合成账单核对"});
  assert.equal((await queries.moneyImportHistory(context,{status:"review"})).items.length,0);
  const completed=await queries.moneyImportHistory(context,{status:"completed"});assert.equal(completed.items.length,1);assert.equal(completed.items[0]!.confirmed,1);assert.equal(completed.items[0]!.pending,0);assert.equal(completed.items[0]!.total,1);
});
