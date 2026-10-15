import { spawnSync } from 'node:child_process';
import { withOfflinePostgres } from './offline-postgres.mjs';
if(!process.argv.includes('--allow-model')||(!process.env.SHADOW_EVAL_MODEL_CONFIG_FILE&&(!process.env.SHADOW_EVAL_MODEL||!process.env.SHADOW_EVAL_RUNTIME_URL))){
  console.error('Opt-in requires --allow-model and either SHADOW_EVAL_MODEL_CONFIG_FILE or SHADOW_EVAL_MODEL with SHADOW_EVAL_RUNTIME_URL. No model was called.');
  process.exit(78);
}
await withOfflinePostgres(async url=>{
  const result=spawnSync(process.execPath,['--import','tsx','--test','scripts/fixtures/agent-context-model.test.ts'],{stdio:'inherit',env:{...process.env,TEST_DATABASE_URL:url,SHADOW_EVAL_MODEL_OPT_IN:'1'}});
  process.exitCode=result.status??1;
});
