import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { withOfflinePostgres } from './offline-postgres.mjs';
import { parseTestScope } from './test-full.mjs';

// Validate before creating a disposable database, and forward the same scope to
// the shared runner. Server-only runs never resolve the Web JSX configuration.
const args=process.argv.slice(2);
try{parseTestScope(args);}catch(error){console.error(error.message);process.exit(64);}
await withOfflinePostgres(async url=>{
  const result=spawnSync(process.execPath,[resolve(import.meta.dirname,'test-full.mjs'),...args],{
    cwd:resolve(import.meta.dirname,'..'),stdio:'inherit',env:{...process.env,TEST_DATABASE_URL:url}
  });
  if(result.error)console.error(result.error.message);
  process.exitCode=result.status??1;
});
