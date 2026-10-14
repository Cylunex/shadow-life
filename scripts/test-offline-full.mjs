import { spawnSync } from 'node:child_process';
import { withOfflinePostgres } from './offline-postgres.mjs';
await withOfflinePostgres(async url=>{
  const result=spawnSync('pnpm',['test:full'],{stdio:'inherit',env:{...process.env,TEST_DATABASE_URL:url}});
  process.exitCode=result.status??1;
});
