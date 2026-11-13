import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createServer} from "node:http";
import {screenshotVisionModels,screenshotVisionProcessor} from "../src/vision-processor.js";
import {pgOnly,reviewFixture} from "./review-fixture.js";
import {AssetService} from "../src/asset-service.js";
import {processPendingLibrary} from "../src/library-worker.js";

const candidate={title:"合成订单",document_date:null,category:null,summary:"仅原件中的订单材料",content:"商户：合成食堂\n商品说明：打卤面\n实付金额：20.60\n支付时间：2026-11-08 12:05:00",locators:[{page:1,quote:"合计20.60元"}]};
async function configFile(t:any,value:unknown){const dir=await mkdtemp(join(tmpdir(),"life-vision-test-"));t.after(()=>rm(dir,{recursive:true,force:true}));const file=join(dir,"config.json");await writeFile(file,JSON.stringify(value),{mode:0o600});return file;}
async function mockVision(t:any){const models:string[]=[];const server=createServer(async(req,res)=>{let body="";for await(const part of req)body+=part;const input=JSON.parse(body);models.push(input.model);assert.equal(input.protocol,"shadow.library.vision.request");assert.ok(input.pages[0].data_base64);res.setHeader("content-type","application/json");res.end(JSON.stringify({protocol:"shadow.library.vision.response",processor_version:"mock-v1",candidate}));});await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));t.after(()=>new Promise<void>(resolve=>server.close(()=>resolve())));const address=server.address();assert.ok(address&&typeof address!=="string");return{url:`http://127.0.0.1:${address.port}/vision`,models};}

test("screenshot model choices reject local OCR and unknown model ids",async t=>{
 const file=await configFile(t,{kind:"tesseract",binary:process.execPath});const env={SHADOW_LIBRARY_PROCESSOR_CONFIG_FILE:file};
 assert.deepEqual(screenshotVisionModels(env),[]);assert.equal(screenshotVisionProcessor("default",env).available,false);
 await assert.rejects(()=>screenshotVisionProcessor("default",env).process(Buffer.from("image"),"image/png"),/不会回退到本地 OCR/);
 const remote=await configFile(t,{kind:"http",url:"http://127.0.0.1:1/vision",models:[{id:"fast",name:"快速模型",model:"synthetic-fast"}]});
 assert.deepEqual(screenshotVisionModels({SHADOW_LIBRARY_PROCESSOR_CONFIG_FILE:remote}),[{id:"default",name:"默认视觉模型"},{id:"fast",name:"快速模型"}]);
 assert.equal(screenshotVisionProcessor("unknown",{SHADOW_LIBRARY_PROCESSOR_CONFIG_FILE:remote}).available,false);
});
test("selected remote model receives the original image and retains model provenance",async t=>{
 const mock=await mockVision(t);const file=await configFile(t,{kind:"http",url:mock.url,model:"synthetic-default",models:[{id:"detail",name:"精细模型",model:"synthetic-detail"}]});const env={SHADOW_LIBRARY_PROCESSOR_CONFIG_FILE:file};
 const result=await screenshotVisionProcessor("detail",env).process(Buffer.from("original-image"),"image/png");
 assert.deepEqual(mock.models,["synthetic-detail"]);assert.equal(result.processorVersion,"synthetic-detail@mock-v1");assert.deepEqual(result.candidate,candidate);
});
test("screenshot routes keep Losna, save-only and selected LLM jobs independent",pgOnly,async t=>{
 const mock=await mockVision(t);const file=await configFile(t,{kind:"http",url:mock.url,models:[{id:"detail",name:"精细模型",model:"synthetic-detail"}]});
 const previous=process.env.SHADOW_LIBRARY_PROCESSOR_CONFIG_FILE;process.env.SHADOW_LIBRARY_PROCESSOR_CONFIG_FILE=file;t.after(()=>{if(previous===undefined)delete process.env.SHADOW_LIBRARY_PROCESSOR_CONFIG_FILE;else process.env.SHADOW_LIBRARY_PROCESSOR_CONFIG_FILE=previous;});
 const f=await reviewFixture(t);const asset=await new AssetService(f.pool).store(f.context.subjectId,"image/png",Buffer.from("synthetic-image"));
 const base={asset_version_id:asset.asset_version_id,title:"合成长截图",captured_at:"2026-11-09T01:00:00Z",time_zone:"UTC"};
 let llmItem="";
 for(const recognition of ["losna","save","llm"] as const){
  const receipt=await f.run("life.capture_screenshot",{...base,recognition,...(recognition==="llm"?{vision_model_id:"detail"}:{batch_id:"share_synthetic_batch"})});
  const id=String(receipt.actual_values.library_item_id);
  if(recognition==="llm")llmItem=id;
  const tags=(await f.pool.query("select r.tags from library_items i join library_revisions r on r.item_id=i.id and r.revision=i.current_revision where i.id=$1",[id])).rows[0].tags as string[];
  assert.equal(tags.includes("losna:process"),recognition==="losna");assert.equal(tags.includes("losna:batch:share_synthetic_batch"),recognition==="losna");
  const jobs=(await f.pool.query("select requested_processor from library_processing_jobs where item_id=$1",[id])).rows;
  assert.equal(jobs.length,recognition==="llm"?1:0);if(recognition==="llm")assert.equal(jobs[0].requested_processor,"llm-vision-v1:detail");
 }
 assert.equal((await processPendingLibrary(f.pool)).filter(r=>r.state==="completed").length,1);assert.deepEqual(mock.models,["synthetic-detail"]);
 const observed=(await f.queries.libraryItem(f.context,llmItem)).payment_observation!;
 assert.equal(observed.product,"打卤面");assert.equal(observed.merchant,"合成食堂");assert.equal(observed.paid_amount,"20.60");
 assert.equal(observed.payment_time,"2026-11-08 12:05:00");assert.equal(Date.parse(observed.captured_at!),Date.parse(base.captured_at));
 assert.equal(observed.asset_version_id,asset.asset_version_id);assert.ok(observed.processing_job_id);
 assert.equal((await f.pool.query("select count(*)::int n from money_entries where subject_id=$1",[f.context.subjectId])).rows[0].n,0);
});
