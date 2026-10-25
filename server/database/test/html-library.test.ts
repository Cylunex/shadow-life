import assert from "node:assert/strict";
import test from "node:test";
import { AssetService,processPendingLibrary } from "../src/index.js";
import { pgOnly,reviewFixture } from "./review-fixture.js";

const html=Buffer.from('<!doctype html><meta charset="utf-8"><title>网页标题</title><article><h1>网页标题</h1><p>中文完整关键词与 EnglishArchive。</p><script>fetch("https://example.invalid/beacon")</script></article>');
async function capture(f:Awaited<ReturnType<typeof reviewFixture>>,bytes=html){
  const asset=await new AssetService(f.pool).store(f.context.subjectId,"text/html",bytes);
  const command=f.command("library.capture",{title:"合成网页标题",item_type:"document",url:"https://example.com/unreachable",source:{kind:"import",captured_on:"2026-10-15",asset_version_id:asset.asset_version_id}});
  const receipt=await f.executor.execute(f.context,command),itemId=String(receipt.actual_values.library_item_id);
  const queue=f.command("library.queue_processing",{item_id:itemId,source_asset_version_id:asset.asset_version_id,kind:"text_extract",requested_processor:"builtin-html-v1"});
  const queued=await f.executor.execute(f.context,queue);
  return{asset,itemId,command,queue,jobId:String(queued.actual_values.library_processing_job_id)};
}
test("HTML original, current revision, searchable snippets and Agent source remain linked; explicit copies stay separate",pgOnly,async t=>{
  const f=await reviewFixture(t),first=await capture(f);
  assert.equal((await f.executor.execute(f.context,first.command)).actual_values.library_item_id,first.itemId);
  assert.equal((await f.executor.execute(f.context,first.queue)).replayed,true);
  await assert.rejects(()=>f.run("library.queue_processing",first.queue.input),/equivalent/);
  assert.deepEqual(await processPendingLibrary(f.pool),[{job_id:first.jobId,state:"completed"}]);
  const detail=await f.queries.libraryItem(f.context,first.itemId);
  assert.equal(detail.item.current_revision,2);assert.equal(detail.revisions[0]?.source_processing_job_id,first.jobId);
  assert.match(detail.revisions[0]?.text??"",/中文完整关键词/u);assert.equal(detail.revisions[0]?.document_date,null);
  assert.equal(detail.revisions[0]?.url,"https://example.com/unreachable");
  assert.equal(detail.derivations[0]?.source_asset_version_id,first.asset.asset_version_id);
  assert.equal(detail.snippets[0]?.item_revision,2);assert.equal(detail.processing_jobs[0]?.processor_version,"builtin-html-v1");
  assert.deepEqual((await f.pool.query("select bytes from asset_blobs where asset_version_id=$1",[first.asset.asset_version_id])).rows[0].bytes,html);
  for(const query of ["中文完整关键词","EnglishArchive","合成网页标题"]){const found=await f.queries.lifeSearch(f.context,{q:query,types:["library"]});assert.equal(found.items[0]?.id,first.itemId);}
  const context=await f.queries.agentContext(f.context,{query:"中文完整关键词",scenario:"library"});
  assert.equal(context.records[0]?.ref.id,first.itemId);assert.equal(context.records[0]?.ref.revision,2);
  const second=await capture(f);assert.notEqual(second.itemId,first.itemId);assert.equal(second.asset.asset_version_id,first.asset.asset_version_id);
  const alien={...f.context,subjectId:"subject_html_other",actorId:"subject_html_other"};await f.unitOfWork.ensurePrincipal(alien.subjectId);
  await assert.rejects(()=>f.queries.libraryItem(alien,first.itemId),/not found/);
  assert.equal((await f.queries.lifeSearch(alien,{q:"中文完整关键词",types:["library"]})).items.length,0);
  await assert.rejects(()=>f.run("library.capture",{title:"越权",item_type:"document",source:{kind:"import",captured_on:"2026-10-15",asset_version_id:first.asset.asset_version_id}},alien),/subject|asset/i);
});
test("HTML extraction cannot overwrite an intervening correction or index the old original as the current body",pgOnly,async t=>{
  const f=await reviewFixture(t),first=await capture(f);
  await f.run("library.revise",{item_id:first.itemId,expected_revision:1,title:"更正后标题",text:"用户当前正文修正词",tags:[],reason:"合成用户更正"});
  await processPendingLibrary(f.pool);
  const detail=await f.queries.libraryItem(f.context,first.itemId);
  assert.equal(detail.item.current_revision,2);assert.equal(detail.revisions[0]?.text,"用户当前正文修正词");
  assert.equal(detail.snippets[0]?.item_revision,1);assert.equal(detail.processing_jobs[0]?.state,"completed");
  assert.equal((await f.queries.lifeSearch(f.context,{q:"EnglishArchive",types:["library"]})).items.length,0);
  assert.equal((await f.queries.lifeSearch(f.context,{q:"当前正文修正词",types:["library"]})).items[0]?.id,first.itemId);
  await assert.rejects(()=>f.run("library.revise",{item_id:first.itemId,expected_revision:1,title:"迟到更正",text:"旧修订",tags:[],reason:"冲突"}),/revision/);
  const replacement=await new AssetService(f.pool).store(f.context.subjectId,"text/html",Buffer.from('<p>替换</p>'));
  await assert.rejects(()=>f.run("library.queue_processing",{item_id:first.itemId,kind:"text_extract",requested_processor:"builtin-html-v1",source_asset_version_id:replacement.asset_version_id}),/fixed original/);
});
test("HTML failures preserve originals, retry uses the same job and the worker processes subsequent normal tasks",pgOnly,async t=>{
  const f=await reviewFixture(t),bad=await capture(f,Buffer.from('<meta charset="gbk"><p>文字</p>')),good=await capture(f);
  const outcomes=await processPendingLibrary(f.pool);assert.equal(outcomes.find(item=>item.job_id===bad.jobId)?.state,"failed");assert.equal(outcomes.find(item=>item.job_id===good.jobId)?.state,"completed");
  await f.run("library.retry_processing",{job_id:bad.jobId});await processPendingLibrary(f.pool);
  const detail=await f.queries.libraryItem(f.context,bad.itemId);assert.equal(detail.processing_jobs[0]?.attempts,2);assert.match(detail.processing_jobs[0]?.last_error??"",/UTF-8/);
  assert.equal(detail.derivations.length,0);assert.equal(detail.sources[0]?.source.asset_version_id,bad.asset.asset_version_id);
});
