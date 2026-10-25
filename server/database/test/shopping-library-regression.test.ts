import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { AssetService,processPendingLibrary } from "../src/index.js";
import { reviewFixture,pgOnly } from "./review-fixture.js";

test("F05: two blocked clients serialize before child changes and commit correct list state",pgOnly,async t=>{
  const {pool,run,executor,command,context}=await reviewFixture(t);
  const plan=await run("life.save_meal_plan",{title:"并发餐单",starts_on:"2026-09-10",ends_on:"2026-09-10",time_zone:"Asia/Shanghai",entries:[{plan_date:"2026-09-10",meal_type:"dinner",title:"待定",servings:"1"}]});
  const list=await run("life.build_shopping_list",{meal_plan_id:plan.actual_values.meal_plan_id,expected_meal_plan_revision:1,title:"并发清单",extras:[{name:"米",quantity:"1",unit:"kg"},{name:"蛋",quantity:"1",unit:"盒"}]});
  const items=list.resources.filter(x=>x.type==="shopping_list_item"),listId=list.actual_values.shopping_list_id;
  async function race(revision:number,states:string[]){
    const blocker=await pool.connect();await blocker.query("begin");await blocker.query("select id from shopping_lists where id=$1 for update",[listId]);
    const commands=items.map((item,i)=>command("life.update_shopping_item",{shopping_item_id:item.id,expected_revision:revision,state:states[i]}));
    const pending=commands.map(c=>executor.execute(context,c));let waited=false;
    try{for(let attempt=0;attempt<100;attempt++){
      const waiters=(await pool.query("select count(*)::int n from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like 'select list.id from shopping_lists%'")).rows[0].n;
      if(waiters===2){waited=true;break;}await new Promise(resolve=>setTimeout(resolve,20));
    }assert.equal(waited,true,"both transactions must reach the parent lock barrier");
    assert.deepEqual((await pool.query("select revision from shopping_list_items where shopping_list_id=$1",[listId])).rows.map(x=>x.revision),[revision,revision]);
    }finally{await blocker.query("commit");blocker.release();}
    await Promise.all(pending);assert.equal((await executor.execute(context,commands[0]!)).replayed,true);
  }
  await race(1,["bought","bought"]);
  assert.deepEqual((await pool.query("select state,revision from shopping_lists where id=$1",[listId])).rows[0],{state:"completed",revision:3});
  await race(2,["needed","bought"]);
  assert.deepEqual((await pool.query("select state,revision from shopping_lists where id=$1",[listId])).rows[0],{state:"open",revision:5});
  await assert.rejects(()=>run("life.update_shopping_item",{shopping_item_id:items[0]!.id,expected_revision:1,state:"bought"}),/revision changed/);
});

test("F06: equal-byte text originals and deterministic derived representations remain independent",pgOnly,async t=>{
  const {pool,run,context,unitOfWork}=await reviewFixture(t),assets=new AssetService(pool),bytes=Buffer.from('{"hello":"regression"}');
  const originals=[];
  for(const mime of ["text/plain","text/markdown","application/json"]){
    const original=await assets.store(context.subjectId,mime,bytes);originals.push(original);
    assert.deepEqual(await assets.store(context.subjectId,mime,bytes),original);
    const item=await run("library.capture",{title:mime,item_type:"note",tags:[],source:{kind:"import",asset_version_id:original.asset_version_id,captured_on:"2026-09-10"}});
    const queued=await run("library.queue_processing",{item_id:item.actual_values.library_item_id,source_asset_version_id:original.asset_version_id,kind:"text_extract",requested_processor:"builtin-text-v1"});
    assert.deepEqual(await processPendingLibrary(pool),[{job_id:queued.actual_values.library_processing_job_id,state:"completed"}]);
    const job=(await pool.query("select derived_asset_version_id from library_processing_jobs where id=$1",[queued.actual_values.library_processing_job_id])).rows[0];
    assert.notEqual(job.derived_asset_version_id,original.asset_version_id);
    const repeat=await assets.store(context.subjectId,"text/plain",bytes,{sourceVersionId:original.asset_version_id,processor:"builtin-text-v1",kind:"text_extract"});assert.equal(repeat.asset_version_id,job.derived_asset_version_id);
    const read=(await pool.query("select b.bytes,a.media_type,v.sha256 from asset_versions v join assets a on a.id=v.asset_id join asset_blobs b on b.asset_version_id=v.id where v.id=$1",[original.asset_version_id])).rows[0];
    assert.deepEqual(read.bytes,bytes);assert.equal(read.media_type,mime);assert.equal(read.sha256,createHash("sha256").update(bytes).digest("hex"));
    assert.deepEqual(await processPendingLibrary(pool),[]);
  }
  assert.equal(new Set(originals.map(x=>x.asset_id)).size,3);
  const legacyHash=createHash("sha256").update(`${context.subjectId}:${originals[0]!.sha256}`).digest("hex").slice(0,24);assert.equal(originals[0]!.asset_id,`asset_${legacyHash}`);
  assert.equal((await pool.query("select count(*)::int n from assets")).rows[0].n,6);
  await unitOfWork.ensurePrincipal("subject_asset_other");
  const other=await assets.store("subject_asset_other","text/plain",bytes);assert.notEqual(other.asset_version_id,originals[0]!.asset_version_id);
  await assert.rejects(()=>run("library.capture",{title:"无权引用",item_type:"note",tags:[],source:{kind:"import",asset_version_id:other.asset_version_id,captured_on:"2026-09-10"}}),/not authorized/);
});
