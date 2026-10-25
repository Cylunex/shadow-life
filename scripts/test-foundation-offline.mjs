import { spawnSync } from 'node:child_process';
import { withOfflinePostgres } from './offline-postgres.mjs';
await withOfflinePostgres(async url => {
  const result=spawnSync(process.execPath,['--import','tsx','--test','--test-concurrency=1','server/database/test/personal-foundation.test.ts','scripts/fixtures/personal-foundation-mcp.test.ts'],{stdio:'inherit',env:{...process.env,TEST_DATABASE_URL:url}});
  process.exitCode=result.status??1;
});
