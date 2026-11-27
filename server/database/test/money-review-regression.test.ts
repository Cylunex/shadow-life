import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { migrate } from "../src/index.js";
import { spawnSync } from "node:child_process";
import { mkdtemp,readFile,writeFile,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve,join } from "node:path";
import { reviewFixture,pgOnly } from "./review-fixture.js";
import { trackPoolShutdown } from "./pool-teardown.js";

test("F04: generic correction preserves FX, allocation and source-scale invariants",pgOnly,async t=>{
  const {run,queries,context,pool,executor,command}=await reviewFixture(t);
  const entry=await run("money.record_foreign_entry",{entry_type:"expense",amount:"100.00",currency:"USD",source_scale:2,occurred_on:"2026-09-10",time_zone:"Asia/Shanghai",conversion:{base_amount:"700.00",base_currency:"CNY",rate:"7",quoted_at:"2026-09-10T00:00:00Z",source_kind:"manual"},allocations:[{participant_label:"Alice",original_amount:"80.00"}]});
  const id=String(entry.actual_values.money_entry_id),recordId=entry.actual_values.record_id;
  const correction={record_id:recordId,expected_revision:1,amount:"100.00",currency:"USD",occurred_on:"2026-09-10",time_zone:"Asia/Shanghai",reason:"修正测试"};
  for(const change of [{amount:"50.123456",currency:"EUR"},{amount:"99.00"},{currency:"EUR"}])await assert.rejects(()=>run("money.correct_entry",{...correction,...change}),/linked FX and allocations/);
  const note=command("money.correct_entry",{...correction,note:"保留外币备注"});await executor.execute(context,note);assert.equal((await executor.execute(context,note)).replayed,true);
  const actual=(await queries.foreignEntries(context)) as {items:Array<{amount:string;base_amount:string;source_scale:number;allocations:Array<{id:string;state:string}>}>};
  assert.equal(actual.items[0]?.amount,"100.000000");assert.equal(actual.items[0]?.base_amount,"700.000000");assert.equal(actual.items[0]?.source_scale,2);
  const allocationId=actual.items[0]!.allocations[0]!.id;
  await run("money.update_shared_allocation",{allocation_id:allocationId,expected_revision:1,state:"settled",settled_on:"2026-09-10"});
  await assert.rejects(()=>run("money.void_entry",{record_id:recordId,expected_revision:2,reason:"待处理结算"}),/settled allocations/);
  await run("money.update_shared_allocation",{allocation_id:allocationId,expected_revision:2,state:"unsettled"});
  await run("money.void_entry",{record_id:recordId,expected_revision:2,reason:"撤销未结算"});
  await assert.rejects(()=>run("money.update_shared_allocation",{allocation_id:allocationId,expected_revision:4,state:"settled",settled_on:"2026-09-10"}),/not confirmed/);
  assert.equal((await pool.query("select state from shared_expense_allocations where id=$1",[allocationId])).rows[0].state,"waived");
  assert.equal(((await queries.foreignEntries(context)) as {items:unknown[]}).items.length,0);
  const history=(await pool.query("select snapshot from consumption_record_revisions where record_id=$1 order by revision",[recordId])).rows;
  assert.equal(history[0].snapshot.money_entry.amount,"100.000000");assert.equal(history[1].snapshot.allocations[0].original_amount,"80.000000");assert.equal(history[1].snapshot.fx.rate,"7.000000000000");
  const plain=await run("money.record_entry",{entry_type:"expense",amount:"100.00",currency:"CNY",occurred_on:"2026-09-10",time_zone:"Asia/Shanghai"});
  await run("money.correct_entry",{...correction,record_id:plain.actual_values.record_id,amount:"50.123456",currency:"EUR"});
  assert.equal((await pool.query("select source_scale from money_entries where id=$1",[plain.actual_values.money_entry_id])).rows[0].source_scale,6);
  await assert.rejects(()=>run("money.correct_entry",{...correction,record_id:plain.actual_values.record_id,expected_revision:2,amount:"-1"}));
  assert.ok(id);
});

test("F10: migration CLI update/delete/replay preserves every exact historical decimal",pgOnly,async t=>{
  const {pool,connectionString}=await reviewFixture(t),root=resolve(import.meta.dirname,"../../.."),dir=await mkdtemp(join(tmpdir(),"life-decimal-test-"));t.after(()=>rm(dir,{recursive:true,force:true}));
  let bundle=JSON.parse(await readFile(resolve(root,"server/importers/legacy/fixtures/migration-bundle.json"),"utf8"));
  bundle.target_schema_version=(await pool.query("select left(max(name),4) version from schema_migrations")).rows[0].version;
  bundle.owners={"legacy-owner":"subject_decimal_regression"};
  const money=bundle.objects[0],meal=bundle.objects[1];
  money.targets[0].data.amount="9007199254740993.123456";money.targets[0].data.source_scale=6;money.payload.amount=money.targets[0].data.amount;
  meal.targets[0].data.items[0].unit="g";
  const nutrientFields=["quantity","amount_g","energy_kcal","protein_g","fat_g","carb_g","fiber_g","sodium_mg","consumed_fraction"];
  for(const field of nutrientFields)meal.targets[0].data.items[0][field]=field==="consumed_fraction"?"0.123400":"9007199254740993.123456";
  const originalBundle=structuredClone(bundle);
  async function invoke(mode:string,databaseUrl=connectionString){const file=join(dir,"bundle.json");await writeFile(file,JSON.stringify(bundle));const result=spawnSync(process.execPath,["--import","tsx","server/importers/legacy/src/cli.ts",mode,file],{cwd:root,env:{...process.env,DATABASE_URL:databaseUrl,SHADOW_MIGRATION_DRILL:"isolated-empty-database"},encoding:"utf8"});assert.equal(result.status,0,result.stdout+result.stderr);return JSON.parse(result.stdout);}
  assert.equal((await invoke("apply")).applied,2);assert.equal((await invoke("apply")).replayed,2);
  money.source.revision="2";meal.source.revision="2";
  money.targets[0].data.amount="9007199254740994.123400";money.payload.amount=money.targets[0].data.amount;meal.targets[0].data.items[0].name="已修正合成样例";
  assert.equal((await invoke("final-delta")).applied,2);assert.equal((await invoke("final-delta")).replayed,2);
  const moneySnapshot=(await pool.query("select snapshot from consumption_record_revisions where record_id='record_import_fixture' and revision=1")).rows[0].snapshot;
  assert.equal(moneySnapshot.money_entry.amount,"9007199254740993.123456");assert.equal(typeof moneySnapshot.money_entry.source_scale,"number");
  const mealSnapshot=(await pool.query("select snapshot from meal_revisions where meal_id='meal_import_fixture' and revision=1")).rows[0].snapshot;
  for(const field of nutrientFields)assert.equal(mealSnapshot.items[0][field],field==="consumed_fraction"?"0.123400":"9007199254740993.123456");
  assert.equal((await invoke("reconcile")).complete,true);
  money.source.revision="3";meal.source.revision="3";money.change_kind="delete";meal.change_kind="delete";
  assert.equal((await invoke("final-delta")).applied,2);assert.equal((await invoke("final-delta")).replayed,2);
  assert.equal((await pool.query("select snapshot->'money_entry'->>'amount' amount from consumption_record_revisions where record_id='record_import_fixture' and revision=2")).rows[0].amount,"9007199254740994.123400");
  assert.equal((await pool.query("select count(*)::int n from meal_revisions where meal_id='meal_import_fixture'")).rows[0].n,2);
  assert.equal((await invoke("reconcile")).complete,true);
  const restoreName=`restore_${randomUUID().replaceAll("-","")}`;await pool.query(`create database "${restoreName}"`);
  const restoreUrl=new URL(connectionString);restoreUrl.pathname=`/${restoreName}`;const restore=new Pool({connectionString:restoreUrl.toString()});
  const closeRestore=trackPoolShutdown(restore);
  t.after(async()=>{await closeRestore();const cleanup=new Pool({connectionString:process.env.TEST_DATABASE_URL});try{await cleanup.query(`drop database "${restoreName}"`);}finally{await cleanup.end();}});
  await migrate(restore);
  // Build the restore bundle from exact prior snapshots rather than rounded current values.
  bundle=originalBundle;bundle.objects[0].targets[0].data.amount=moneySnapshot.money_entry.amount;
  for(const field of nutrientFields)bundle.objects[1].targets[0].data.items[0][field]=mealSnapshot.items[0][field];
  assert.equal((await invoke("restore-drill",restoreUrl.toString())).ready,true);
  assert.equal((await restore.query("select amount::text amount from money_entries where id='money_import_fixture'")).rows[0].amount,"9007199254740993.123456");
  assert.equal((await restore.query("select consumed_fraction::text value from intake_items where id='intake_import_fixture'")).rows[0].value,"0.123400");
});

test("foreign expenses and refunds keep original currency before and after actual settlement",pgOnly,async t=>{
  const {run,queries,context,executor,command}=await reviewFixture(t);
  const origin={occurred_on:"2026-11-22",time_zone:"Asia/Shanghai"};
  const entry=await run("money.record_foreign_entry",{
    ...origin,entry_type:"expense",amount:"12.3250",currency:"USD",source_scale:4,counterparty:"示例商户",
    source:{kind:"import",external_id:"synthetic-original",captured_on:origin.occurred_on,original_text:"合成外币交易"}
  });
  const expenseId=String(entry.actual_values.money_entry_id);
  assert.equal(entry.actual_values.fx_snapshot_id,undefined);
  const otherDay=await run("money.record_foreign_entry",{...origin,occurred_on:"2026-11-21",entry_type:"expense",amount:"12.3250",currency:"USD",source_scale:4});
  const refund=await run("money.record_refund",{...origin,original_entry_id:expenseId,currency:"USD",amount:"2.123456"});
  const refundId=String(refund.actual_values.money_entry_id);
  await assert.rejects(()=>run("money.record_refund",{...origin,original_entry_id:expenseId,currency:"EUR",amount:"1.00"}),/matching confirmed expense/);
  await assert.rejects(()=>run("money.record_refund",{...origin,original_entry_id:expenseId,currency:"USD",amount:"11.00"}),/exceeds/);
  const first=await queries.listDomain(context,"money",{on:origin.occurred_on,currency:"USD",limit:1});
  assert.ok(first.next_cursor);
  const second=await queries.listDomain(context,"money",{on:origin.occurred_on,currency:"USD",limit:1,cursor:first.next_cursor});
  assert.deepEqual(new Set([...first.items,...second.items].map(row=>row.id)),new Set([expenseId,refundId]));
  assert.equal(second.next_cursor,null);
  const read=(settlement_state:"pending"|"settled")=>queries.foreignEntries(context,{settlement_state});
  const pending=await read("pending");
  assert.equal(pending.items.length,3);
  assert.equal(pending.items.find(row=>row.id===expenseId)?.base_amount,null);
  const actual={money_entry_id:expenseId,expected_revision:1,amount:"88.19",settled_on:"2026-11-26"};
  await assert.rejects(()=>run("money.settle_foreign_entry",{...actual,settled_on:"2026-11-21"}),/cannot precede/);
  await assert.rejects(()=>run("money.settle_foreign_entry",{...actual,expected_revision:2}),/revision changed/);
  const settle=command("money.settle_foreign_entry",actual);
  const concurrent=await Promise.allSettled([executor.execute(context,settle),run("money.settle_foreign_entry",actual)]);
  assert.equal(concurrent.filter(result=>result.status==="fulfilled").length,1);
  if(concurrent[0]?.status==="fulfilled")assert.equal((await executor.execute(context,settle)).replayed,true);
  await run("money.settle_foreign_entry",{...actual,money_entry_id:refundId,amount:"15.13"});
  const settled=await read("settled");
  assert.equal(settled.items.find(row=>row.id===expenseId)?.settlement?.amount,"88.19");
  assert.equal(settled.items.find(row=>row.id===expenseId)?.amount,"12.325000");
  assert.equal(settled.items.find(row=>row.id===expenseId)?.source_scale,4);
  assert.equal(settled.items.find(row=>row.id===refundId)?.settlement?.amount,"15.13");
  assert.equal(settled.items.find(row=>row.id===refundId)?.amount,"2.123456");
  assert.deepEqual((await read("pending")).items.map(row=>row.id),[otherDay.actual_values.money_entry_id]);
  const summary=await queries.summarizeMoney(context,{period:"2026-11"});
  assert.ok(summary.totals.every(row=>row.currency==="USD"));
});

test("monthly money is ordered by transaction day and time across backfills and cursor pages",pgOnly,async t=>{
  const {run,queries,context}=await reviewFixture(t);
  const period="2026-11";
  const record=async(occurred_on:string,occurred_at?:string)=>String((await run("money.record_foreign_entry",{
    entry_type:"expense",amount:"12.00",currency:"USD",source_scale:2,time_zone:"Asia/Shanghai",
    occurred_on,...(occurred_at?{occurred_at}:{})
  })).actual_values.money_entry_id);
  const earlier=await record("2026-11-27","2026-11-26T23:00:00Z");
  const latest=await record("2026-11-27","2026-11-27T02:00:00Z");
  const timeless=await record("2026-11-27");
  const backfill=await record("2026-11-04");
  const first=await queries.listDomain(context,"money",{period,currency:"USD",limit:2});
  assert.deepEqual(first.items.map(row=>row.id),[latest,earlier]);
  assert.ok(first.next_cursor);
  await record("2026-11-28","2026-11-28T01:00:00Z");
  const second=await queries.listDomain(context,"money",{period,currency:"USD",limit:2,cursor:first.next_cursor});
  assert.deepEqual(second.items.map(row=>row.id),[timeless,backfill]);
  assert.equal(second.next_cursor,null);

  const byCreation=await queries.listDomain(context,"money",{currency:"USD",limit:2});
  assert.equal(byCreation.items[1]?.id,backfill);
  assert.ok(byCreation.next_cursor);
  const legacy=JSON.parse(Buffer.from(byCreation.next_cursor,"base64url").toString("utf8"));
  legacy.filter=JSON.stringify([period,"USD",null,null]);
  const oldCursor=Buffer.from(JSON.stringify(legacy)).toString("base64url");
  const legacyPage=await queries.listDomain(context,"money",{period,currency:"USD",limit:3,cursor:oldCursor});
  assert.deepEqual(legacyPage.items.map(row=>row.id),[timeless,latest,earlier]);
});
