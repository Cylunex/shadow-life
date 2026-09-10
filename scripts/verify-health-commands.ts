import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {universalCommandEnvelopeSchema,ingestHealthBatchInputSchema} from "../packages/contracts/src/index.js";

// Read bytes emitted by the production Kotlin builder, never a JavaScript reconstruction.
const {fixtures}=JSON.parse(readFileSync(process.argv[2]!,"utf8"));
assert.deepEqual(fixtures.map((fixture:{case:string})=>fixture.case),["changes","bootstrap","expired_rescan","empty_complete_scan"]);
for(const fixture of fixtures){
  const command=universalCommandEnvelopeSchema.parse(fixture.command);
  const input=ingestHealthBatchInputSchema.parse(command.input);
  assert.equal(command.capability,"health.ingest_batch");
  assert.equal(input.rescan!==undefined,fixture.case!=="changes");
  assert.equal(input.previous_cursor===null,fixture.case==="bootstrap");
  assert.equal(input.records.length,fixture.case==="empty_complete_scan"?0:1);
  if(input.rescan)assert.equal(input.rescan.complete,true);
}
console.log("Health Connect: all 4 production JVM envelopes pass the public command and ingestion contracts");
