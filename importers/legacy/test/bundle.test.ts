import assert from "node:assert/strict";
import test from "node:test";
import { canonical, findSecretFields, stableMigrationId, validateBundle } from "../src/bundle.js";

const bundle={protocol:"shadow.legacy-bundle",source_snapshot:"snapshot-1",mapper_version:"mapper-1",target_schema_version:"0005",owners:{old:"subject_test"},manifest:{files:[]},objects:[{source:{instance:"ledger",table:"money",pk:{id:1},owner:"old",revision:"1"},payload:{amount:"10.0010"},targets:[{component:"money",type:"money_entry",id:"money_import_0001",role:"primary",data:{entry_type:"expense",amount:"10.0010",currency:"USD",occurred_on:"2025-01-01"}}]}]};
test("canonical identity is independent of object key order",()=>assert.equal(canonical({b:2,a:1}),canonical({a:1,b:2})));
test("stable ids include structured source identity",()=>assert.notEqual(stableMigrationId("x",["a","bc"]),stableMigrationId("x",["ab","c"])));
test("bundle validates owner mapping and historical precision",()=>assert.equal(validateBundle(bundle).objects[0]?.payload.amount,"10.0010"));
test("secret-bearing export is rejected",()=>{assert.deepEqual(findSecretFields({profile:{access_token:"x"}}),["$.profile.access_token"]);assert.throws(()=>validateBundle({...bundle,objects:[{...bundle.objects[0],payload:{password_hash:"x"}}]}),/forbidden secret/);});
