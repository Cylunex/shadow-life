import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';

// Always create a disposable local cluster; never inherit a supplied production/test DSN.
export async function withOfflinePostgres(work) {
  const directory = mkdtempSync(join(tmpdir(), 'life-offline-'));
  const data = join(directory, 'data');
  const binary = process.env.SHADOW_TEST_PG_BIN;
  const run = (name, args) => {
    const result = spawnSync(binary ? join(binary, name) : name, args, { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`${name} failed: ${result.stderr || result.error || result.stdout}`);
  };
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  let started = false;
  try {
    run('initdb', ['-D', data, '-A', 'trust', '-U', 'offline', '--encoding=UTF8', '--no-locale']);
    run('pg_ctl', ['-D', data, '-l', join(directory, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port} -k ${directory}`, '-w', 'start']);
    started = true;
    return await work(`postgresql://offline@127.0.0.1:${port}/postgres`);
  } finally {
    if (started) run('pg_ctl', ['-D', data, '-m', 'immediate', '-w', 'stop']);
    rmSync(directory, { recursive: true, force: true });
  }
}
