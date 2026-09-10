import { readFile, writeFile } from "node:fs/promises";
import { auditMapping, mappingReviewSchema, mappingSkeleton, validateSnapshot } from "./snapshot.js";

const [command,snapshotPath,secondPath,thirdPath]=process.argv.slice(2);if(!command||!snapshotPath)throw new Error("usage: mapping-cli <skeleton|audit> <snapshot.json> <review-or-output.json> [report.json|mapper-version]");const snapshot=validateSnapshot(JSON.parse(await readFile(snapshotPath,"utf8")));
if(command==="skeleton"){if(!secondPath)throw new Error("skeleton needs an output path");const review=mappingSkeleton(snapshot,thirdPath??"mapper-unassigned");await writeFile(secondPath,JSON.stringify(review,null,2)+"\n",{mode:0o600});console.log(JSON.stringify({protocol:review.protocol,snapshot_id:review.snapshot_id,tables:review.tables.length,output:secondPath,ready:false}));}
else if(command==="audit"){if(!secondPath)throw new Error("audit needs a review path");const review=mappingReviewSchema.parse(JSON.parse(await readFile(secondPath,"utf8"))),report=auditMapping(snapshot,review);if(thirdPath)await writeFile(thirdPath,JSON.stringify(report,null,2)+"\n",{mode:0o600});else console.log(JSON.stringify(report,null,2));if(!report.ready)process.exitCode=2;}
else throw new Error(`unknown mapping command: ${command}`);
