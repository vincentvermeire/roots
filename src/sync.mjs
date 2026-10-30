import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, symlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { adapterPlan } from './adapters.mjs';
import { assertOwnedPath, RootsError, writeAtomic } from './config.mjs';

export function syncContext(context, registry, { tool, dryRun = false } = {}) {
  const instructionsFile = join(context.home, 'AGENTS.md');
  const instructions = existsSync(instructionsFile) ? readFileSync(instructionsFile, 'utf8') : '';
  const plans = (tool ? [tool] : Object.keys(context.selected.models)).map(name => adapterPlan(context, name, registry, instructions));
  const changes = [];
  for (const plan of plans) {
    assertOwnedPath(context.home, plan.directory);
    for (const [name, text] of Object.entries(plan.files)) {
      const path = join(plan.directory, name);
      assertOwnedPath(context.home, path);
      if (existsSync(path) && readFileSync(path, 'utf8') === text) continue;
      changes.push({ tool: plan.tool, path, kind: 'file' });
      if (!dryRun) writeAtomic(path, text, { root: context.home });
    }
    const source = join(context.home, 'skills');
    if (!existsSync(source)) continue;
    let existing;
    try { existing = lstatSync(plan.skills); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (existing) {
      if (!existing.isSymbolicLink() || resolve(dirname(plan.skills), readlinkSync(plan.skills)) !== resolve(source)) throw new RootsError('Refusing to replace a user-owned skills directory; inspect the runtime path.');
      continue;
    }
    changes.push({ tool: plan.tool, path: plan.skills, kind: 'skills link' });
    if (!dryRun) { mkdirSync(plan.directory, { recursive: true }); symlinkSync(resolve(source), plan.skills, process.platform === 'win32' ? 'junction' : 'dir'); }
  }
  return { plans, changes };
}
