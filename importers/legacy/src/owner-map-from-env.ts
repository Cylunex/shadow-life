import { writeFile } from "node:fs/promises";

const [sourceKind,ownerKey,outputPath]=process.argv.slice(2),subject=process.env.SHADOW_PROXY_SUBJECT_ID;
if((sourceKind!=="health"&&sourceKind!=="ledger")||!ownerKey||!outputPath)throw new Error("usage: owner-map-from-env <health|ledger> <owner-key> <output.json>");
if(!subject)throw new Error("SHADOW_PROXY_SUBJECT_ID is required");
await writeFile(outputPath,JSON.stringify({source_kind:sourceKind,owner_key:ownerKey,target_subject_id:subject,ownership_confirmed:true,ownership_confirmation:"用户于 2026-09-13 明确确认旧 Health 与 Ledger 全部生产记录归属当前唯一 Life 账户",mapper_version:"shadow-life-production-v1",target_schema_version:"0035",...(process.env.LEGACY_ASSET_ROOT?{asset_root:process.env.LEGACY_ASSET_ROOT}:{})},null,2)+"\n",{mode:0o600});
