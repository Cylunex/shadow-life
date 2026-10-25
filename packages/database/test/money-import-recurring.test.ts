import assert from "node:assert/strict";
import test from "node:test";
import { reviewFixture,pgOnly } from "./review-fixture.js";
import { sha256Fingerprinter } from "@shadow/kernel";
import { migrate } from "../src/index.js";

const time_zone="Asia/Shanghai";
const row=(id:string,extra:Record<string,unknown>={})=>({date:"2026-10-10",type:"expense",amount:"12.30",merchant:"合成商家",transaction_id:id,...extra});
const statement=(rows:unknown[],extra:Record<string,unknown>={})=>({format:"json",source_name:"合成周期账单.json",content:JSON.stringify(rows),time_zone,...extra});
const decision=(id:string)=>({candidate_id:id,expected_revision:1,decision:"confirm",reason:"核对合成账单"});

test("overlapping pending imports recheck identity at confirmation and serialize concurrent writes",pgOnly,async t=>{
  const f=await reviewFixture(t);
  const first=await f.run("money.stage_import",statement([row("repeat-001")]));
  const second=await f.run("money.stage_import",statement([row("repeat-001",{note:"重新导出"})]));
  const a=await f.queries.moneyImportReview(f.context,String(first.actual_values.batch_id));
  const b=await f.queries.moneyImportReview(f.context,String(second.actual_values.batch_id));
  assert.equal(b.candidates[0]!.duplicate_of_candidate_id,a.candidates[0]!.id);
  assert.ok(b.candidates[0]!.warnings.includes("duplicate_pending_external_id"));
  const results=await Promise.allSettled([f.run("money.resolve_import_candidate",decision(a.candidates[0]!.id)),f.run("money.resolve_import_candidate",decision(b.candidates[0]!.id))]);
  assert.equal(results.filter(value=>value.status==='fulfilled').length,1);
  assert.equal(results.filter(value=>value.status==='rejected').length,1);
  assert.equal((await f.pool.query("select count(*)::int n from money_entries")).rows[0].n,1);
  const pending=results[0]!.status==='rejected'?a:b;
  const refreshed=await f.queries.moneyImportReview(f.context,pending.batch.id);
  assert.ok(refreshed.candidates[0]!.duplicate_of_record_id);
  assert.ok(refreshed.candidates[0]!.warnings.includes("duplicate_external_id"));
  assert.equal((await f.queries.moneyImportMonth(f.context,{period:"2026-10"})).totals.duplicates,1);
});

test("file identity includes account and timezone while source facts survive manual correction",pgOnly,async t=>{
  const f=await reviewFixture(t),input=statement([row("same-001")]);
  const a=await f.run("money.stage_import",input),again=await f.run("money.stage_import",{...input,source_name:"改名.json"});
  assert.equal(again.actual_values.batch_id,a.actual_values.batch_id);
  const otherAccount=await f.run("money.stage_import",{...input,source_account:"second"});
  const otherZone=await f.run("money.stage_import",{...input,time_zone:"UTC"});
  assert.notEqual(otherAccount.actual_values.batch_id,a.actual_values.batch_id);
  assert.notEqual(otherZone.actual_values.batch_id,a.actual_values.batch_id);
  const zoneReview=await f.queries.moneyImportReview(f.context,String(otherZone.actual_values.batch_id));
  await f.run("money.resolve_import_candidate",{...decision(zoneReview.candidates[0]!.id),decision:"ignore"});
  const review=await f.queries.moneyImportReview(f.context,String(a.actual_values.batch_id));
  await f.run("money.resolve_import_candidate",{...decision(review.candidates[0]!.id),corrections:{amount:"12.40",category:"人工分类"}});
  const retry=await f.run("money.stage_import",statement([row("same-001",{note:"补导"})]));
  const retryReview=await f.queries.moneyImportReview(f.context,String(retry.actual_values.batch_id));
  assert.ok(retryReview.candidates[0]!.duplicate_of_record_id);
  assert.equal(retryReview.candidates[0]!.issues.includes("external_id_payload_changed"),false);
  assert.equal((await f.queries.moneyImportReview(f.context,review.batch.id)).candidates[0]!.source_proposed?.amount,"12.30");
  const separate=await f.queries.moneyImportReview(f.context,String(otherAccount.actual_values.batch_id));
  await f.run("money.resolve_import_candidate",decision(separate.candidates[0]!.id));
  assert.equal((await f.pool.query("select count(*)::int n from money_entries")).rows[0].n,2);
});

test("changed source identities stay explicit and unkeyed identical purchases remain separate",pgOnly,async t=>{
  const f=await reviewFixture(t);
  const a=await f.run("money.stage_import",statement([row("changed-001")]));
  const b=await f.run("money.stage_import",statement([row("changed-001",{amount:"99.00"})]));
  const review=await f.queries.moneyImportReview(f.context,String(b.actual_values.batch_id));
  assert.equal(review.candidates[0]!.status,"invalid");
  assert.ok(review.candidates[0]!.issues.includes("external_id_payload_changed"));
  await assert.rejects(()=>f.run("money.resolve_import_candidate",decision(review.candidates[0]!.id)),/changed source facts/u);
  const first=await f.queries.moneyImportReview(f.context,String(a.actual_values.batch_id));
  await f.run("money.resolve_import_candidate",{...decision(first.candidates[0]!.id),decision:"ignore"});
  assert.equal((await f.queries.moneyImportMonth(f.context,{period:"2026-10"})).totals.duplicates,0);
  assert.equal((await f.queries.moneyImportReview(f.context,review.batch.id)).candidates[0]!.duplicate_of_candidate_id,null);
  await f.run("money.resolve_import_candidate",decision(review.candidates[0]!.id));
  const unkeyed=await f.run("money.stage_import",statement([row("",{note:"相同价格第一笔"}),row("",{note:"相同价格第二笔"})]));
  const noIds=await f.queries.moneyImportReview(f.context,String(unkeyed.actual_values.batch_id));
  await Promise.all(noIds.candidates.map(candidate=>f.run("money.resolve_import_candidate",decision(candidate.id))));
  assert.equal((await f.queries.moneyImportReview(f.context,noIds.batch.id)).batch.status,"completed");
  assert.equal((await f.pool.query("select count(*)::int n from money_entries")).rows[0].n,3);
});

test("platform namespaces do not collide and uncompleted orders cannot bypass source issues",pgOnly,async t=>{
  const f=await reviewFixture(t);
  const tao={订单号:"shared-id",订单提交时间:"2026-10-10 12:00:00",订单状态:"交易成功",商品名称:"合成商品",实付金额:"12.30",店铺名称:"合成商家"};
  const mei={交易单号:"shared-id",交易创建时间:"2026-10-10 12:00:00",交易成功时间:"2026-10-10 12:01:00",交易类型:"支付",订单标题:"合成订单",实付金额:"12.30"};
  for(const input of [statement([tao]),statement([mei])]){
    const receipt=await f.run("money.stage_import",input),review=await f.queries.moneyImportReview(f.context,String(receipt.actual_values.batch_id));
    assert.equal(review.candidates[0]!.duplicate_of_record_id,null);
    await f.run("money.resolve_import_candidate",decision(review.candidates[0]!.id));
  }
  const pending=await f.run("money.stage_import",statement([{...tao,订单号:"closed-order",订单状态:"交易关闭"}]));
  const review=await f.queries.moneyImportReview(f.context,String(pending.actual_values.batch_id));
  await assert.rejects(()=>f.run("money.resolve_import_candidate",{...decision(review.candidates[0]!.id),corrections:{amount:"12.30",entry_type:"expense"}}),/not completed/u);
  assert.equal((await f.pool.query("select count(*)::int n from money_entries")).rows[0].n,2);
  assert.equal((await f.pool.query("select count(*)::int n from meals")).rows[0].n,0);
});

test("a changed income direction cannot bypass a source expense identity while refunds remain distinct",pgOnly,async t=>{
  const f=await reviewFixture(t);
  const staged=await f.run("money.stage_import",statement([row("direction-001")]));
  const review=await f.queries.moneyImportReview(f.context,String(staged.actual_values.batch_id));
  const expense=await f.run("money.resolve_import_candidate",decision(review.candidates[0]!.id));
  const changed=await f.run("money.stage_import",statement([row("direction-001",{type:"income"})]));
  const changedReview=await f.queries.moneyImportReview(f.context,String(changed.actual_values.batch_id));
  assert.ok(changedReview.candidates[0]!.issues.includes("external_id_payload_changed"));
  assert.equal(changedReview.candidates[0]!.duplicate_of_record_id,expense.actual_values.record_id);
  await assert.rejects(()=>f.run("money.resolve_import_candidate",decision(changedReview.candidates[0]!.id)),/already links/u);
  const refund=await f.run("money.stage_import",statement([row("direction-001",{type:"refund",amount:"2.30"})]));
  const refundReview=await f.queries.moneyImportReview(f.context,String(refund.actual_values.batch_id));
  assert.equal(refundReview.candidates[0]!.duplicate_of_record_id,null);
  await f.run("money.resolve_import_candidate",{...decision(refundReview.candidates[0]!.id),original_entry_id:expense.actual_values.money_entry_id});
  assert.equal((await f.pool.query("select count(*)::int n from money_entries")).rows[0].n,2);
});

test("monthly totals cover batches beyond the 100-row display limit",pgOnly,async t=>{
  const f=await reviewFixture(t);
  await f.pool.query(`insert into money_import_batches(id,subject_id,source_name,format,content_hash,original_content,time_zone)
    select 'batch_fixture_'||n,$1,'合成批次','json','hash_'||n,'[]','Asia/Shanghai' from generate_series(1,101) n`,[f.context.subjectId]);
  await f.pool.query(`insert into money_import_candidates(id,batch_id,subject_id,position,raw,proposed,issues,warnings,applied_rule_ids,status)
    select 'candidate_fixture_'||n,'batch_fixture_'||n,$1,0,'{}',jsonb_build_object('occurred_on','2026-10-10'),'[]','[]','[]','pending' from generate_series(1,101) n`,[f.context.subjectId]);
  const month=await f.queries.moneyImportMonth(f.context,{period:"2026-10"});
  assert.equal(month.batches.length,100);assert.equal(month.total_batches,101);assert.equal(month.truncated,true);
  assert.equal(month.totals.unconfirmed,101);assert.equal(month.totals.uncategorized,101);
});

test("legacy archive source and relationship maps prevent reimport of migrated orders",pgOnly,async t=>{
  const f=await reviewFixture(t);
  const old=await f.run("money.record_entry",{entry_type:"expense",amount:"12.30",currency:"CNY",occurred_on:"2026-10-10",time_zone});
  const secondOld=await f.run("money.record_entry",{entry_type:"expense",amount:"25.00",currency:"CNY",occurred_on:"2026-10-10",time_zone});
  const raw={platform:"taobao",rows:[{订单号:"legacy-order-001",订单提交时间:"2026-10-10 12:00:00",订单状态:"交易成功",商品名称:"合成商品",实付金额:"12.30"}]};
  const secondRaw={platform:"taobao",rows:[{...raw.rows[0]!,订单号:"legacy-order-002",实付金额:"25.00"}]};
  await f.pool.query(`insert into migration_batches(id,bundle_hash,source_instance,source_snapshot,target_schema_version,mapper_version,owner_map_hash,mode,stage) values('migration_fixture','fixture','legacy_fixture','snapshot_fixture','0048','fixture','fixture','apply','completed')`);
  await f.pool.query(`insert into legacy_object_maps(id,batch_id,source_instance,source_table,source_pk,source_pk_hash,source_owner,target_type,target_id) values('map_fixture','migration_fixture','legacy_fixture','ledger_records','{"id":"old-record"}','fixture','configured-migration-owner-key','money_entry',$1)`,[old.actual_values.money_entry_id]);
  await f.pool.query(`insert into legacy_object_maps(id,batch_id,source_instance,source_table,source_pk,source_pk_hash,source_owner,target_type,target_id) values('map_fixture_second','migration_fixture','legacy_fixture','ledger_records','{"id":"old-record-second"}','fixture-second','configured-migration-owner-key','money_entry',$1)`,[secondOld.actual_values.money_entry_id]);
  for(const [table,rows]of [["capture_sources",[{id:"old-source",owner_id:"old-owner",raw_payload:raw},{id:"old-source-second",owner_id:"old-owner",raw_payload:secondRaw}]],["ledger_record_sources",[{source_id:"old-source",record_id:"old-record"},{source_id:"old-source-second",record_id:"old-record-second"}]]]as const){
    await f.pool.query(`insert into legacy_archives(id,subject_id,source_instance,source_table,source_snapshot,chunk_no,chunk_count,row_count,content,content_hash) values($1,$2,'legacy_fixture',$3,'snapshot_fixture',1,1,2,$4,repeat('0',64))`,[`archive_${table}`,f.context.subjectId,table,{rows}]);
  }
  const staged=await f.run("money.stage_import",statement([...raw.rows,...secondRaw.rows,{...raw.rows[0]!,订单号:"new-order-003"}])),review=await f.queries.moneyImportReview(f.context,String(staged.actual_values.batch_id));
  assert.equal(review.candidates[0]!.duplicate_of_record_id,old.actual_values.record_id);
  assert.equal(review.candidates[1]!.duplicate_of_record_id,secondOld.actual_values.record_id);
  assert.equal(review.candidates[2]!.duplicate_of_record_id,null);
  assert.ok(review.candidates[0]!.warnings.includes("duplicate_legacy_external_id"));
  assert.ok(review.candidates[1]!.warnings.includes("duplicate_legacy_external_id"));
  await assert.rejects(()=>f.run("money.resolve_import_candidate",decision(review.candidates[0]!.id)),/already links/u);
  await assert.rejects(()=>f.run("money.resolve_import_candidate",decision(review.candidates[1]!.id)),/already links/u);
  await f.run("money.resolve_import_candidate",decision(review.candidates[2]!.id));
  assert.equal((await f.pool.query("select count(*)::int n from money_entries")).rows[0].n,3);
});

test("upgrade recovers platform identities from old Life raw headers without reimporting confirmed facts",pgOnly,async t=>{
  const f=await reviewFixture(t);
  const old=await f.run("money.record_entry",{entry_type:"expense",amount:"12.30",currency:"CNY",occurred_on:"2026-10-10",time_zone});
  await f.pool.query(`alter table money_import_candidates drop column platform,drop column source_account,drop column identity_kind,drop column source_proposed,drop column duplicate_of_candidate_id;
    alter table money_import_batches drop column platform,drop column source_account,drop column parser_version;
    drop index money_import_batches_subject_created_idx;
    delete from schema_migrations where name='0048_money_import_identity.sql'`);
  const raw={交易单号:"life-old-001",交易创建时间:"2026-10-10 12:00:00",交易成功时间:"2026-10-10 12:01:00",交易类型:"支付",订单标题:"合成旧账单",实付金额:"12.30"};
  const content=JSON.stringify([raw]),hash=sha256Fingerprinter.fingerprint({format:"json",content});
  await f.pool.query(`insert into money_import_batches(id,subject_id,source_name,format,content_hash,original_content,time_zone,status) values('batch_old_life',$1,'旧导入.json','json',$2,$3,'Asia/Shanghai','completed')`,[f.context.subjectId,hash,content]);
  await f.pool.query(`insert into money_import_candidates(id,batch_id,subject_id,position,external_id,raw,proposed,issues,warnings,status,linked_record_id) values('candidate_old_life','batch_old_life',$1,0,'life-old-001',$2,$3,'[]','[]','confirmed',$4)`,[f.context.subjectId,raw,{entry_type:"expense",amount:"12.30",currency:"CNY",occurred_on:"2026-10-10",time_zone},old.actual_values.record_id]);
  const unsettled={...raw,交易单号:"life-old-unsettled",交易成功时间:""};
  await f.pool.query(`insert into money_import_batches(id,subject_id,source_name,format,content_hash,original_content,time_zone) values('batch_old_pending',$1,'旧待处理.json','json','old-pending','[]','Asia/Shanghai')`,[f.context.subjectId]);
  await f.pool.query(`insert into money_import_candidates(id,batch_id,subject_id,position,external_id,raw,proposed,issues,warnings,status) values('candidate_old_pending','batch_old_pending',$1,0,'life-old-unsettled',$2,$3,'[]','[]','pending')`,[f.context.subjectId,unsettled,{entry_type:"expense",amount:"12.30",currency:"CNY",occurred_on:"2026-10-10",time_zone}]);
  await migrate(f.pool);
  await assert.rejects(()=>f.run("money.resolve_import_candidate",{...decision("candidate_old_pending"),corrections:{amount:"12.30",entry_type:"expense"}}),/not completed/u);
  const exact=await f.run("money.stage_import",statement([raw]));
  assert.equal(exact.actual_values.batch_id,"batch_old_life");assert.equal(exact.actual_values.duplicate_source,true);
  const overlap=await f.run("money.stage_import",statement([{...raw,备注:"重导增加备注"}]));
  const review=await f.queries.moneyImportReview(f.context,String(overlap.actual_values.batch_id));
  assert.equal(review.candidates[0]!.platform,"meituan");
  assert.equal(review.candidates[0]!.duplicate_of_record_id,old.actual_values.record_id);
  await assert.rejects(()=>f.run("money.resolve_import_candidate",decision(review.candidates[0]!.id)),/already links/u);
  assert.equal((await f.pool.query("select count(*)::int n from money_entries")).rows[0].n,1);
});
