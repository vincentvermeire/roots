import { spawnSync } from 'node:child_process';
import { digest, RootsError } from './config.mjs';

const providerVariables = [
  'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_API_BASE', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL',
  'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GEMINI_BASE_URL', 'LITELLM_API_KEY', 'AZURE_OPENAI_API_KEY', 'AZURE_OPENAI_ENDPOINT',
  'AWS_BEARER_TOKEN_BEDROCK', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY',
  'ANTHROPIC_DEFAULT_OPUS_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'ANTHROPIC_MODEL',
  'ANTHROPIC_SMALL_FAST_MODEL', 'ANTHROPIC_CUSTOM_HEADERS', 'CLAUDE_CODE_SUBAGENT_MODEL',
  'CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'OPENCODE_CONFIG', 'OPENCODE_CONFIG_DIR', 'OPENCODE_CONFIG_CONTENT', 'BUN_INSPECT',
  'ROOTS_API_KEY', 'ROOTS_PROFILE', 'ROOTS_PROJECT', 'ROOTS_RUNTIME',
];
export function cleanEnvironment(env, config = { profiles: {} }, registry = { servers: {} }) {
  const output = { ...env };
  const remove = new Set(providerVariables);
  for (const profile of Object.values(config.profiles)) if (profile.credential.env) remove.add(profile.credential.env.toUpperCase());
  for (const server of Object.values(registry.servers)) for (const source of Object.values(server.env || server.headers || {})) if (source.env) remove.add(source.env.toUpperCase());
  for (const key of Object.keys(output)) if (remove.has(key.toUpperCase()) || key.toUpperCase().startsWith('ROOTS_MCP_')) delete output[key];
  return output;
}
export function resolveCredential(source, env = process.env, execute = spawnSync) {
  if (source.none) return undefined;
  if ('value' in source) return source.value;
  if (source.env) {
    const value = env[source.env];
    if (typeof value !== 'string' || !value.trim()) throw new RootsError(`Required environment variable ${source.env} is missing; no alternate key was used.`);
    return value;
  }
  const result = execute('op', ['read', source.op], { encoding: 'utf8', timeout: 60_000, maxBuffer: 1024 * 1024, windowsHide: true });
  if (result.error || result.status !== 0 || !result.stdout?.trim()) throw new RootsError('1Password credential read failed; tool output omitted to protect secrets.');
  return result.stdout.trim();
}
export const mcpVariable = (server, field) => `ROOTS_MCP_${digest(`${server}\n${field}`).toUpperCase()}`;
export function resolveLaunchSecrets(context, registry, env = process.env, execute = spawnSync) {
  const cache = new Map();
  const resolve = source => {
    const id = JSON.stringify(source);
    if (!cache.has(id)) cache.set(id, resolveCredential(source, env, execute));
    return cache.get(id);
  };
  const output = { ROOTS_API_KEY: resolve(context.selected.credential) ?? 'local' };
  for (const [id, server] of Object.entries(registry.servers)) {
    if (server.profiles && !server.profiles.includes(context.profile)) continue;
    for (const [name, source] of Object.entries(server.env || server.headers || {})) output[mcpVariable(id, name)] = resolve(source);
  }
  return output;
}
