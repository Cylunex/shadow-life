import assert from "node:assert/strict";
import test from "node:test";
import { sha256Fingerprinter } from "@shadow/kernel";
import { migrate } from "../src/index.js";
import { pgOnly, reviewFixture } from "./review-fixture.js";

test("upgrade retains external identity when a historical import was corrected from income to refund",pgOnly,async t=>{
  const f=await reviewFixture(t),time_zone="Asia/Shanghai";
  const original=await f.run("money.record_entry",{entry_type:"expense",amount:"10.00",currency:"CNY",occurred_on:"2026-10-10",time_zone});
  const refund=await f.run("money.record_refund",{original_entry_id:original.actual_values.money_entry_id,amount:"5.00",currency:"CNY",occurred_on:"2026-10-11",time_zone});

  // Recreate the pre-0048 table shape. The original source said income, but the
  // user correctly identified the payment as a refund before upgrading Life.
  await f.pool.query(`alter table money_import_candidates drop column platform,drop column source_account,drop column identity_kind,drop column source_proposed,drop column duplicate_of_candidate_id;
    alter table money_import_batches drop column platform,drop column source_account,drop column parser_version;
    drop index money_import_batches_subject_created_idx;
    delete from schema_migrations where name='0048_money_import_identity.sql'`);
  const raw={date:"2026-10-11",type:"income",amount:"5.00",id:"legacy-corrected-refund"};
  const content=JSON.stringify([raw]),contentHash=sha256Fingerprinter.fingerprint({format:"json",content});
  const corrected={entry_type:"refund",amount:"5.00",currency:"CNY",occurred_on:"2026-10-11",time_zone};
  await f.pool.query(`insert into money_import_batches(id,subject_id,source_name,format,content_hash,original_content,time_zone,status)
    values('batch_corrected_legacy',$1,'旧已确认账单.json','json',$2,$3,$4,'completed')`,[f.context.subjectId,contentHash,content,time_zone]);
  await f.pool.query(`insert into money_import_candidates(id,batch_id,subject_id,position,external_id,raw,proposed,issues,warnings,status,linked_record_id)
    values('candidate_corrected_legacy','batch_corrected_legacy',$1,0,$2,$3,$4,'[]','[]','confirmed',$5)`,[f.context.subjectId,raw.id,raw,corrected,refund.actual_values.record_id]);
  await migrate(f.pool);

  const migrated=await f.pool.query("select identity_kind,raw,proposed,linked_record_id from money_import_candidates where id='candidate_corrected_legacy'");
  assert.equal(migrated.rows[0].identity_kind,null,"a mutable historical proposal cannot establish an immutable source event kind");
  assert.deepEqual(migrated.rows[0].raw,raw);
  assert.deepEqual(migrated.rows[0].proposed,corrected);
  assert.equal(migrated.rows[0].linked_record_id,refund.actual_values.record_id);

  const repeated=await f.run("money.stage_import",{format:"json",source_name:"重导账单.json",content:JSON.stringify([{...raw,note:"导出增加备注"}]),time_zone});
  const review=await f.queries.moneyImportReview(f.context,String(repeated.actual_values.batch_id));
  assert.equal(review.candidates[0]!.identity_kind,"income");
  assert.equal(review.candidates[0]!.duplicate_of_record_id,refund.actual_values.record_id);
  await assert.rejects(()=>f.run("money.resolve_import_candidate",{candidate_id:review.candidates[0]!.id,expected_revision:1,decision:"confirm",reason:"重复账单不得再次入账"}),/already links/u);
  assert.deepEqual((await f.pool.query("select entry_type,amount::text from money_entries order by entry_type")).rows,[
    {entry_type:"expense",amount:"10.000000"},{entry_type:"refund",amount:"5.000000"}
  ]);
});
