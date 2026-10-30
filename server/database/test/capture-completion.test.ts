import assert from 'node:assert/strict';
import test from 'node:test';
import { pgOnly,reviewFixture } from './review-fixture.js';
import { AssetService } from '../src/asset-service.js';
import { processPendingRecordings } from '../src/recording-worker.js';
const range={date:'2026-10-30',time_zone:'UTC',period:'day'};
const item=(id:string,start='01:00',end='02:00')=>({source_id:id,kind:'app_usage',title:'合成阅读应用',app_package:'example.reader',app_category:'news',started_at:`2026-10-30T${start}:00Z`,ended_at:`2026-10-30T${end}:00Z`,time_zone:'UTC'});
const capture=(f:any,items:any[])=>f.run('life.ingest_activity',{device_id:'device_completion',items});
test('activity classification, project unions and explicit goals share permissions and personal intentions',pgOnly,async t=>{
 const f=await reviewFixture(t);const project=await f.run('life.save_project',{title:'合成读书项目',goal:'阅读',state:'active'});const projectId=String(project.actual_values.project_id);const captured=await capture(f,[item('usage_completion_a'),item('usage_completion_b','01:30','02:30')]);
 let insight:any=await f.queries.captureCompletion(f.context,'life.capture_insights',range);assert.equal(insight.app_usage_seconds,5400);assert.equal(insight.groups[0].behavior,'reading');
 const id=captured.resources[0]!.id;await f.run('life.classify_activity',{id,expected_revision:1,behavior:'learning',life_domain:'growth',project_id:projectId,remember_app:true});
 await f.run('life.set_capture_goal',{title:'每天至少学习一小时',behavior:'learning',life_domain:null,project_id:projectId,period:'day',direction:'at_least',minutes:60});
 insight=await f.queries.captureCompletion(f.context,'life.capture_insights',range);assert.equal(insight.projects[0].seconds,3600);assert.equal(insight.goals[0].observed_seconds,3600);assert.equal((await f.pool.query("select count(*)::int n from agent_intentions where data->>'kind'='goal'")).rows[0].n,1);
 await f.run('life.reclassify_activities',{ids:[id]});assert.equal((await f.queries.activitySource(f.context,{id})).classification_origin,'user');
 await capture(f,[item('usage_completion_c','03:00','04:00')]);const c=(await f.pool.query("select id from activity_captures where source_id='usage_completion_c'")).rows[0];assert.equal((await f.queries.activitySource(f.context,{id:c.id})).behavior,'learning');
 const limited:any=await f.queries.captureCompletion({...f.context,effects:new Set(['library.item.read'])},'life.capture_insights',range);assert.deepEqual(limited.projects,[]);assert.deepEqual(limited.goals,[]);
 await assert.rejects(()=>f.run('life.classify_activity',{id,expected_revision:2,behavior:'reading',life_domain:'growth',project_id:projectId,remember_app:false},{...f.context,effects:new Set(['library.item.write'])}));
});
test('capture search, common day/search and export are source-scoped and exclude deleted material',pgOnly,async t=>{
 const f=await reviewFixture(t);const c=await capture(f,[{...item('screen_completion_a'),kind:'screen_text',ended_at:'2026-10-30T01:00:00Z',text:'合成可检索材料'}]);
 const query={from_on:'2026-10-30',to_on_exclusive:'2026-10-31',time_zone:'UTC',q:'可检索',limit:10};const result:any=await f.queries.captureCompletion(f.context,'life.capture_search',query);assert.equal(result.items.length,1);
 assert.ok((await f.queries.lifeSearch(f.context,{q:'可检索',types:['library']})).items.some(r=>r.kind==='activity_capture'));assert.ok((await f.queries.lifeDay(f.context,{date:'2026-10-30',time_zone:'UTC'})).items.some(r=>r.kind==='activity_capture'));
 const exported:any=await f.queries.captureCompletion(f.context,'life.capture_export',{from_on:query.from_on,to_on_exclusive:query.to_on_exclusive,time_zone:'UTC'});assert.equal(exported.items[0].sha256.length,64);
 const invisible:any=await f.queries.captureCompletion({...f.context,subjectId:'other_owner'},'life.capture_search',query);assert.equal(invisible.items.length,0);
 await f.run('life.delete_activity',{id:c.resources[0].id});assert.equal((await f.queries.captureCompletion(f.context,'life.capture_search',query) as any).items.length,0);
});
test('restore retains source metadata and classifications but never automatically creates money',pgOnly,async t=>{
 const f=await reviewFixture(t);await f.run('life.set_order_capture',{app_package:'example.reader',platform:'taobao',source_account:'default',enabled:true,auto_accounting:true});
 const raw={...item('original_screen_a'),kind:'screen_text',ended_at:'2026-10-30T01:00:00Z',text:'订单号：RESTORE-ONE\n实付金额：￥12.00\n付款时间：2026-10-30 09:00\n支付成功'};
 const input={archive_id:'archive_synthetic_001',items:[raw],classifications:[{source_id:raw.source_id,behavior:'shopping',life_domain:'life',project_id:null,protected:true}]};await f.run('life.restore_activities',input);await f.run('life.restore_activities',input);
 assert.equal((await f.pool.query('select count(*)::int n from money_entries')).rows[0].n,0);assert.equal((await f.pool.query('select count(*)::int n from activity_captures')).rows[0].n,1);const id=(await f.pool.query('select id from activity_captures')).rows[0].id;const source=await f.queries.activitySource(f.context,{id});assert.equal(source.protected,true);assert.equal(source.classification_origin,'restored');await f.run('life.protect_capture',{id,kind:'activity',protected:false});await f.run('life.restore_activities',input);assert.equal((await f.queries.activitySource(f.context,{id})).protected,false);
});
test('retention is opt-in, protects pinned sources and removes only completed unreferenced audio bytes',pgOnly,async t=>{
 const f=await reviewFixture(t);const rows=await capture(f,[{...item('old_screen_a'),kind:'screen_text',ended_at:'2026-10-30T01:00:00Z',text:'临时页面'},{...item('old_screen_b'),kind:'screen_text',ended_at:'2026-10-30T01:00:00Z',text:'保留页面'}]);await f.pool.query("update activity_captures set started_at=now()-interval '10 days',ended_at=now()-interval '10 days'");
 await f.run('life.protect_capture',{id:rows.resources[1].id,kind:'activity',protected:true});await f.run('life.cleanup_captures',{limit:50});assert.equal((await f.pool.query('select count(*)::int n from activity_captures where deleted_at is null')).rows[0].n,2);
 await f.run('life.set_capture_policy',{expected_revision:1,process_recordings:true,process_screenshots:true,daily_audio_minutes:120,daily_screenshots:50,screen_keep_days:7,audio_keep_days:7});await f.run('life.cleanup_captures',{limit:50});assert.equal((await f.pool.query('select count(*)::int n from activity_captures where deleted_at is null')).rows[0].n,1);
 const asset=await new AssetService(f.pool).store(f.context.subjectId,'audio/wav',Buffer.from('synthetic retained audio'));await f.run('life.restore_recording',{segment_id:'audio_retention_one',session_id:'recording_retention_one',segment_index:0,title:'合成音频',started_at:'2026-10-30T03:00:00Z',ended_at:'2026-10-30T03:01:00Z',time_zone:'UTC',asset_version_id:asset.asset_version_id,spans:[{start_ms:0,end_ms:1000,text:'转写仍保留'}]});await f.pool.query("update capture_recording_segments set processed_at=now()-interval '10 days'");await f.run('life.cleanup_captures',{limit:50});assert.equal((await f.pool.query('select count(*)::int n from asset_blobs where asset_version_id=$1',[asset.asset_version_id])).rows[0].n,0);const workspace=await f.queries.captureWorkspace(f.context,{date:'2026-10-30',time_zone:'UTC'});assert.equal(workspace.recordings[0]!.audio_available,false);assert.equal(workspace.recordings[0]!.spans[0]!.text,'转写仍保留');
});
test('paused processing and daily quotas leave audio queued without calling the processor',pgOnly,async t=>{
 const f=await reviewFixture(t);const asset=await new AssetService(f.pool).store(f.context.subjectId,'audio/wav',Buffer.from('synthetic paused audio'));await f.run('life.register_recording',{segment_id:'audio_paused_001',session_id:'recording_paused_001',segment_index:0,title:'合成音频',started_at:'2026-10-30T03:00:00Z',ended_at:'2026-10-30T03:01:00Z',time_zone:'UTC',asset_version_id:asset.asset_version_id});let calls=0;const processor={available:true,async process(){calls++;return{processor_version:'stub',spans:[]};}};
 await f.run('life.set_capture_policy',{expected_revision:0,process_recordings:false});assert.equal((await processPendingRecordings(f.pool,2,processor)).length,0);assert.equal(calls,0);
 await f.run('life.set_capture_policy',{expected_revision:1,process_recordings:true,daily_audio_minutes:0});assert.equal((await processPendingRecordings(f.pool,2,processor)).length,0);assert.equal(calls,0);
 await f.run('life.set_capture_policy',{expected_revision:2,process_recordings:true,daily_audio_minutes:1});assert.equal((await processPendingRecordings(f.pool,2,processor))[0]!.state,'completed');assert.equal(calls,1);
});
test('Agent source references are visible only with source authority and become stale on correction/deletion',pgOnly,async t=>{
 const f=await reviewFixture(t);const c=await capture(f,[item('context_activity_one')]);const id=c.resources[0].id;const data:any=await f.queries.foundation(f.context,'agent.objects',{object_refs:[{kind:'activity_capture',id,revision:1}],depth:0});assert.ok(JSON.stringify(data).includes('合成阅读应用'));
 await f.run('life.classify_activity',{id,expected_revision:1,behavior:'learning',life_domain:'growth',project_id:null,remember_app:false});await f.run('life.delete_activity',{id});assert.equal((await f.pool.query('select revision from activity_captures where id=$1',[id])).rows[0].revision,3);
});
