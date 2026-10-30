import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path';
import { RootsError } from './config.mjs';

export function executableFor(tool, env = process.env) {
  const override = env[`ROOTS_TOOL_${tool.toUpperCase()}`];
  const win = process.platform === 'win32';
  const hints = tool === 'claude' ? [join(homedir(), '.local', 'bin', win ? 'claude.exe' : 'claude')]
    : tool === 'opencode' && win && env.LOCALAPPDATA ? [join(env.LOCALAPPDATA, 'Programs', 'opencode', 'opencode.exe')] : [];
  const pathKey = Object.keys(env).find(key => key.toUpperCase() === 'PATH');
  const extensions = win ? ['.exe', '.cmd', ''] : [''];
  const candidates = override ? [isAbsolute(override) ? override : resolve(override)]
    : [...hints, ...(env[pathKey] || '').split(delimiter).filter(Boolean).flatMap(folder => extensions.map(ext => join(folder, `${tool}${ext}`)))];
  const path = candidates.find(candidate => existsSync(candidate));
  if (!path) throw new RootsError(`${tool} is not installed or its executable is not on PATH.`);
  if (/\.m?js$/i.test(path)) return { command: process.execPath, prefix: [path] };
  if (/\.(cmd|bat)$/i.test(path)) {
    const entries = { codex: ['@openai', 'codex', 'bin', 'codex.js'], claude: ['@anthropic-ai', 'claude-code', 'cli.js'], opencode: ['opencode-ai', 'bin', 'opencode'] };
    const entry = join(dirname(path), 'node_modules', ...entries[tool]);
    if (existsSync(entry)) return { command: process.execPath, prefix: [entry] };
    throw new RootsError('A Windows batch shim cannot be launched safely. Set ROOTS_TOOL_<TOOL> to a native executable or JavaScript entry point.');
  }
  return { command: path, prefix: [] };
}
export async function runProcess(command, args, { env, cwd, stdio = 'inherit', onStart } = {}) {
  return await new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { env, cwd, stdio, windowsHide: true });
    const forward = signal => { if (!child.killed) child.kill(signal); };
    const interrupt = () => forward('SIGINT'), terminate = () => forward('SIGTERM');
    process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
    const cleanup = () => { process.off('SIGINT', interrupt); process.off('SIGTERM', terminate); };
    child.once('spawn', () => {
      try { onStart?.(child.pid); }
      catch { child.kill(); cleanup(); reject(new RootsError('Could not record agent launch; the child was stopped.')); }
    });
    child.once('error', () => { cleanup(); reject(new RootsError('Agent process could not start; executable details omitted.')); });
    child.once('close', (code, signal) => { cleanup(); resolveRun(code ?? (signal === 'SIGINT' ? 130 : 143)); });
  });
}
