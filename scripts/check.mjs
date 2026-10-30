import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateConfig } from '../src/config.mjs';
import { validateRegistry } from '../src/mcp.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (['.git', 'node_modules'].includes(entry.name)) return [];
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}
let failed = false;
for (const path of files(root).filter(path => path.endsWith('.mjs'))) {
  const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8', timeout: 10_000, windowsHide: true });
  if (result.status !== 0) { console.error(result.stderr || 'Syntax check failed.'); failed = true; }
}
validateConfig(JSON.parse(readFileSync(join(root, 'examples', 'config.json'), 'utf8')));
validateRegistry(JSON.parse(readFileSync(join(root, 'examples', 'mcp.json'), 'utf8')));
if (failed) process.exitCode = 1;
else console.log('JavaScript syntax and generic configuration examples passed.');
