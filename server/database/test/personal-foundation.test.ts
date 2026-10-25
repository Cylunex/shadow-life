import assert from 'node:assert/strict';
import test from 'node:test';
import { foundationQueries } from '@shadow/contracts';
import { reviewFixture, pgOnly, mealInput } from './review-fixture.js';

const intention={key:'dinner-time',scope:'planning',kind:'constraint',category:'time_budget',statement:'晚饭准备最多半小时',minutes:30,assertion:'explicit',valid_from:'2026-10-14',valid_to_exclusive:'2026-10-17'};
test('personal intent revisions, scope, validity and complete planning workspace',pgOnly,async t=>{
  const {run,queries,context}=await reviewFixture(t);
  const saved=await run('agent.set_intention',intention);
  const read=(name:keyof typeof foundationQueries,input:unknown)=>queries.foundation(context,name,input);
  const intentionRef={kind:'agent_intention',id:saved.actual_values.id,revision:1};
  assert.equal((await read('agent.objects',{object_refs:[intentionRef],scenario:'planning',depth:0}) as any).nodes[0].data.minutes,30);
  await assert.rejects(()=>read('agent.objects',{object_refs:[intentionRef],scenario:'travel',depth:0}),/unavailable/);
  assert.equal((await read('agent.intentions',{scenario:'planning',on:'2026-10-14'}) as any).items[0].minutes,30);
  assert.equal((await read('agent.intentions',{scenario:'planning',on:'2026-10-17'}) as any).items.length,0);
  assert.equal((await read('agent.intentions',{scenario:'travel',on:'2026-10-14'}) as any).items.length,0);
  await run('agent.set_intention',{...intention,id:saved.actual_values.id,expected_revision:1,minutes:20,reason:'用户明确调整'});
  await assert.rejects(()=>run('agent.set_intention',{...intention,id:saved.actual_values.id,expected_revision:1,reason:'过时更正'}),/revision/);
  await run('life.save_project',{title:'准备晚饭',goal:'三天按时做饭',state:'active'});
  await run('life.set_food_stock',{name:'鸡蛋',quantity:'4',unit:'枚'});
  const workspace=await read('agent.workspace',{scenario:'planning',from_on:'2026-10-14',to_on_exclusive:'2026-10-17'} as any) as any;
  assert.equal(workspace.intentions[0].minutes,20);
  assert(workspace.sections.find((section:any)=>section.kind==='plans_and_resources').data.some((node:any)=>node.ref.kind==='life_project'));
  assert(workspace.sections.find((section:any)=>section.kind==='meal_planning').data.stock_lots.some((lot:any)=>lot.name==='鸡蛋'));
  assert.equal(workspace.truncation.result_bytes,Buffer.byteLength(JSON.stringify(workspace),'utf8'));
  const history=await read('agent.export',{section:'history',on:'2026-10-14'}) as any;
  assert.equal(history.items[0].snapshot.minutes,30);
});

test('source relations and evidence are owner, permission and revision checked',pgOnly,async t=>{
  const {run,queries,context,unitOfWork}=await reviewFixture(t);
  const meal=await run('life.record_meal',{...mealInput,source:{kind:'text',captured_on:'2026-10-14',original_text:'合成午餐来源'}}),ref={kind:'meal',id:String(meal.actual_values.meal_id),revision:1};
  const exportedSources=await queries.foundation(context,'agent.export',{section:'sources',on:'2026-10-14'}) as any;
  assert.equal(exportedSources.items.length,1);
  assert.equal(exportedSources.items[0].original_text,'合成午餐来源');
  assert.equal(exportedSources.original_assets_included,false);
  const original=await queries.foundation(context,'agent.objects',{object_refs:[ref],scenario:'daily',depth:1}) as any;
  assert(original.nodes.some((node:any)=>node.ref.kind==='source'&&node.data.original_text==='合成午餐来源'));
  assert(original.edges.some((edge:any)=>edge.relation==='original'));
  assert.equal((await queries.foundation({...context,effects:new Set(['agent.run','library.asset.read'])},'agent.export',{section:'sources',on:'2026-10-14'}) as any).items.length,0);
  await run('agent.save_learning',{key:'lunch-note',scope:'daily',kind:'observation',statement:'已记录这顿午饭',object_refs:[ref],environment:'offline',workflow_revision:'test',outcome:'observed',limitations:'仅一条合成记录'});
  assert.equal((await queries.foundation(context,'agent.learning',{on:'2026-10-14'}) as any).items.length,1);
  const restricted={...context,effects:new Set(['agent.run'])};
  assert.equal((await queries.foundation(restricted,'agent.learning',{on:'2026-10-14'}) as any).items.length,0);
  await assert.rejects(()=>queries.foundation(restricted,'agent.objects',{object_refs:[ref]}),/unavailable/);
  const other={...context,subjectId:'subject_other',actorId:'subject_other'};await unitOfWork.ensurePrincipal(other.subjectId);
  await assert.rejects(()=>queries.foundation(other,'agent.objects',{object_refs:[ref]}),/unavailable/);
  await run('life.correct_meal',{meal_id:ref.id,expected_revision:1,occurred_on:mealInput.occurred_on,time_zone:mealInput.time_zone,meal_type:'dinner',reason:'更正午餐'});
  assert.equal((await queries.foundation(context,'agent.learning',{on:'2026-10-14'}) as any).items.length,0);
});

test('cross-runtime checkpoints claim once, replay receipts and recover after release',pgOnly,async t=>{
  const {run,command,executor,queries,context,pool}=await reviewFixture(t);
  const input={task_key:'dinners',scope:'planning',title:'安排晚饭',state:'running',current_step:'选择餐单',next_step:'核对食材',claim_seconds:60};
  const envelope=command('agent.save_task',input),saved=await executor.execute(context,envelope);
  assert.equal((await executor.execute(context,envelope)).replayed,true);
  const ownRead=await queries.foundation(context,'agent.tasks',{}) as any;
  assert.equal(ownRead.items[0].lease.token,saved.actual_values.lease_token);
  const other={...context,clientId:'another-runtime'};
  const otherRead=await queries.foundation(other,'agent.tasks',{}) as any;
  assert.equal(otherRead.items[0].lease.active,true);
  assert.equal(otherRead.items[0].lease.token,null);
  await assert.rejects(()=>run('agent.save_task',{...input,id:saved.actual_values.id,expected_revision:1,reason:'另一运行时接手'},other),/claimed/);
  await run('agent.save_task',{...input,id:saved.actual_values.id,expected_revision:1,lease_token:saved.actual_values.lease_token,state:'waiting',claim_seconds:undefined,reason:'等待材料'});
  await run('agent.save_task',{...input,id:saved.actual_values.id,expected_revision:2,reason:'接手检查点'},other);
  const tasks=await queries.foundation(other,'agent.tasks',{}) as any;assert.equal(tasks.items[0].next_step,'核对食材');assert.equal(tasks.items[0].provenance.client_id,'another-runtime');
  const attribution=await pool.query('select client_id from operations where execution_id=$1',[saved.execution_id]);assert.equal(attribution.rows[0].client_id,context.clientId);
});

test('task takeover evaluates lease expiry after a row lock wait',pgOnly,async t=>{
  const {run,pool,context}=await reviewFixture(t);
  const input={task_key:'locked-task',scope:'planning',title:'锁等待恢复',state:'running',claim_seconds:15};
  const saved=await run('agent.save_task',input);
  await pool.query("update agent_tasks set lease_expires_at=clock_timestamp()+interval '200 milliseconds' where id=$1",[saved.actual_values.id]);
  const blocker=await pool.connect();
  try{
    await blocker.query('begin');await blocker.query('select id from agent_tasks where id=$1 for update',[saved.actual_values.id]);
    const takeover=run('agent.save_task',{...input,id:saved.actual_values.id,expected_revision:1,reason:'租约在锁等待期间过期'},{...context,clientId:'client_takeover'});
    await new Promise(resolve=>setTimeout(resolve,350));await blocker.query('commit');
    const receipt=await takeover;assert.equal(receipt.actual_values.revision,2);assert.notEqual(receipt.actual_values.lease_token,saved.actual_values.lease_token);
  }finally{await blocker.query('rollback');blocker.release();}
});

test('durable changes consumers advance independently and filter revoked data',pgOnly,async t=>{
  const {run,queries,context}=await reviewFixture(t);
  await run('agent.set_subscription',{consumer:'hermes',scope:'daily'});
  await run('agent.set_subscription',{consumer:'openclaw',scope:'daily'});
  await run('life.record_meal',mealInput);
  const a=await queries.foundation(context,'agent.changes',{consumer:'hermes',scenario:'daily'}) as any;
  assert(a.items.some((item:any)=>item.refs.some((ref:any)=>ref.kind==='meal')));
  await run('agent.ack_changes',{consumer:'hermes',expected_cursor:'0',cursor:a.cursor});
  assert.equal((await queries.foundation(context,'agent.changes',{consumer:'hermes',scenario:'daily'}) as any).acknowledged_cursor,a.cursor);
  assert.equal((await queries.foundation(context,'agent.changes',{consumer:'openclaw',scenario:'daily'}) as any).acknowledged_cursor,'0');
  const restricted={...context,effects:new Set(['agent.run'])};
  assert(!(await queries.foundation(restricted,'agent.changes',{consumer:'openclaw',scenario:'daily'}) as any).items.some((item:any)=>item.refs.some((ref:any)=>ref.kind==='meal')));
  await assert.rejects(()=>run('agent.ack_changes',{consumer:'hermes',expected_cursor:'0',cursor:a.cursor}),/cursor changed/);
});

test('copy restoration preserves history and validates evidence before any commit',pgOnly,async t=>{
  const {run,queries,context}=await reviewFixture(t);
  await run('agent.set_intention',intention);
  const exported=await queries.foundation(context,'agent.export',{section:'intentions',on:'2026-10-14'}) as any;
  await run('agent.restore',{section:'intentions',copy_key:'restored',entries:exported.items});
  assert.equal((await queries.foundation(context,'agent.intentions',{on:'2026-10-14'}) as any).items.length,2);
  await assert.rejects(()=>run('agent.restore',{section:'intentions',copy_key:'restored',entries:exported.items}),/Key already exists/);
  await assert.rejects(()=>run('agent.restore',{section:'tasks',copy_key:'invalid',entries:[{task_key:'step',title:'不可恢复的任务',scope:'global',object_refs:[{kind:'meal',id:'meal_unavailable',revision:1}]}]}),/unavailable/);
  assert.equal((await queries.foundation(context,'agent.tasks',{}) as any).items.length,0);
});

test('relations are explicit and protected endpoints are not exposed',pgOnly,async t=>{
  const {run,queries,context}=await reviewFixture(t);
  const meal=await run('life.record_meal',{...mealInput,payment:{amount:'12.00',currency:'CNY',occurred_on:mealInput.occurred_on,time_zone:mealInput.time_zone}});
  const ref={kind:'meal',id:meal.actual_values.meal_id,revision:1};
  const graph=await queries.foundation(context,'agent.objects',{object_refs:[ref],depth:2}) as any;
  assert(graph.edges.some((edge:any)=>edge.relation==='payment'));
  const noMoney={...context,effects:new Set(['agent.run','life.meal.read'])};
  const safe=await queries.foundation(noMoney,'agent.objects',{object_refs:[ref],depth:2}) as any;
  assert(!safe.nodes.some((node:any)=>node.ref.kind==='money_entry'));assert.equal(safe.edges.length,0);
});

test('changes signal invalidation and deferred publication preserves commit order',pgOnly,async t=>{
  const {run,queries,context,pool}=await reviewFixture(t);
  await run('agent.set_subscription',{consumer:'watch',scope:'daily'});
  const meal=await run('life.record_meal',mealInput);
  await run('life.correct_meal',{meal_id:meal.actual_values.meal_id,expected_revision:1,occurred_on:mealInput.occurred_on,time_zone:mealInput.time_zone,meal_type:'dinner',reason:'更正'});
  const changes=await queries.foundation(context,'agent.changes',{consumer:'watch'}) as any;
  assert(changes.items.some((item:any)=>item.invalidated_refs.some((ref:any)=>ref.kind==='meal'&&ref.revision===1)));
  const a=await pool.connect(),b=await pool.connect();
  try {
  await a.query('begin');await b.query('begin');
  await a.query("insert into meals(id,subject_id,occurred_on,time_zone,meal_type,state) values('meal_late_commit',$1,'2026-10-14','Asia/Shanghai','lunch','active')",[context.subjectId]);
  await b.query("insert into meals(id,subject_id,occurred_on,time_zone,meal_type,state) values('meal_early_commit',$1,'2026-10-14','Asia/Shanghai','lunch','active')",[context.subjectId]);
  await b.query('commit');
  const first=await queries.foundation(context,'agent.changes',{consumer:'watch'}) as any;
  await a.query('commit');
  const second=await queries.foundation(context,'agent.changes',{consumer:'watch',after:first.cursor}) as any;
  assert(second.items.some((item:any)=>item.refs.some((ref:any)=>ref.id==='meal_late_commit')));
  } finally {a.release();b.release();}
});

test('query replay invalidates changed intentions and byte budgets keep valid JSON',pgOnly,async t=>{
  const {run,queries,context}=await reviewFixture(t);
  const saved=await run('agent.set_intention',intention);
  const input={scenario:'planning',from_on:'2026-10-14',to_on_exclusive:'2026-10-17',byte_budget:4096};
  const result=await queries.foundation(context,'agent.workspace',input) as any;
  assert(Buffer.byteLength(JSON.stringify(result),'utf8')<=4096);
  assert.equal(await queries.revalidateFoundation(context,'agent.workspace',input,result),true);
  await run('agent.set_intention',{...intention,id:saved.actual_values.id,expected_revision:1,minutes:15,reason:'新的明确偏好'});
  assert.equal(await queries.revalidateFoundation(context,'agent.workspace',input,result),false);
  await run('agent.set_intention',{...intention,key:'large-intention',scope:'health',statement:'明'.repeat(2000)});
  await assert.rejects(queries.foundation(context,'agent.intentions',{scenario:'health',on:'2026-10-14',limit:1,byte_budget:4096}),/single item exceeds/u);
  const expanded=await queries.foundation(context,'agent.intentions',{scenario:'health',on:'2026-10-14',limit:1,byte_budget:64000}) as any;
  assert.equal(expanded.items[0].key,'large-intention');
  assert.equal(expanded.next_offset,null);
  assert.equal(foundationQueries['agent.changes'].input.safeParse({consumer:'test',after:'malformed'}).success,false);
});
