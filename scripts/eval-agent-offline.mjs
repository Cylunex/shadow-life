import { spawnSync } from 'node:child_process';
import { withOfflinePostgres } from './offline-postgres.mjs';
const baseline = process.argv.includes('--baseline');
await withOfflinePostgres(async url => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', '--test-concurrency=1', baseline ? 'scripts/fixtures/agent-context-baseline.test.ts' : 'scripts/fixtures/agent-context-offline.test.ts'], { stdio: 'inherit', env: { ...process.env, TEST_DATABASE_URL: url } });
  process.exitCode = result.status ?? 1;
});
