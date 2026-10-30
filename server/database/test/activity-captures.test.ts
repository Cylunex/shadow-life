import assert from "node:assert/strict";
import test from "node:test";
import { pgOnly,reviewFixture } from "./review-fixture.js";
const item={source_id:"usage_one",kind:"app_usage",started_at:"2026-10-29T23:30:00Z",ended_at:"2026-10-30T00:30:00Z",time_zone:"UTC",title:"Browser",app_package:"example.browser"};
test("activity ingestion is atomic, source-idempotent, isolated and unions clipped usage intervals",pgOnly,async t=>{
 const f=await reviewFixture(t);const batch={device_id:"device_test",items:[item]};
 const command=f.command("life.ingest_activity",batch);const first=await f.executor.execute(f.context,command);
 assert.equal(first.actual_values.inserted,1);assert.equal((await f.executor.execute(f.context,command)).replayed,true);
 assert.equal((await f.run("life.ingest_activity",batch)).actual_values.duplicates,1);
 await f.run("life.ingest_activity",{device_id:"device_test",items:[{...item,source_id:"usage_two",started_at:"2026-10-30T00:00:00Z",ended_at:"2026-10-30T01:00:00Z"}]});
 const input={date:"2026-10-30",time_zone:"UTC",limit:1};
 const page=await f.queries.activities(f.context,input);assert.equal(page.usage_seconds,3600);assert.equal(page.total,2);assert.ok(page.next_before_id);
 const next=await f.queries.activities(f.context,{...input,before_id:page.next_before_id});assert.notEqual(next.items[0]!.id,page.items[0]!.id);assert.equal(next.next_before_id,null);
 await assert.rejects(()=>f.run("life.ingest_activity",{device_id:"device_test",items:[{...item,source_id:"a_new"},{...item,title:"Changed"}]}),/来源标识/);
 assert.equal((await f.queries.activities(f.context,input)).total,2);
 assert.equal((await f.queries.activities({...f.context,subjectId:"subject_other"},input)).total,0);
 await assert.rejects(()=>f.queries.activities({...f.context,effects:new Set()},input),/library.item.read/);
 await assert.rejects(()=>f.run("life.ingest_activity",batch,{...f.context,effects:new Set()}),/library.item.write/);
 assert.equal((await f.queries.activities(f.context,{...input,date:"2026-10-29"})).usage_seconds,1800);
 await f.run("life.ingest_activity",{device_id:"device_test",items:[{source_id:"screen_point",kind:"screen_text",started_at:"2026-10-30T00:00:00Z",ended_at:"2026-10-30T00:00:00Z",time_zone:"UTC",title:"Order",text:"Synthetic order"}]});
 const withPoint=await f.queries.activities(f.context,{...input,limit:100});assert.equal(withPoint.total,3);assert.equal(withPoint.usage_seconds,3600);

});
