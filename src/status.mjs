import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readJson } from './config.mjs';

export function sessionStatus(home) {
  const directory = join(home, 'state', 'runs');
  if (!existsSync(directory)) return [];
  return readdirSync(directory).filter(name => name.endsWith('.json')).map(name => readJson(join(directory, name)))
    .filter(Boolean).map(run => {
      if (run.status !== 'running') return run;
      let alive = false;
      try { process.kill(run.pid, 0); alive = true; } catch (error) { alive = error.code === 'EPERM'; }
      return { ...run, status: alive ? 'running' : 'interrupted' };
    }).sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 30);
}
