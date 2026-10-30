import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const TOOLS = ['claude', 'codex', 'opencode'];
export const identifier = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
export const variable = /^[A-Za-z_][A-Za-z0-9_]*$/;
export class RootsError extends Error {}
export const digest = value => createHash('sha256').update(value).digest('hex').slice(0, 16);
export const jsonText = value => `${JSON.stringify(value, null, 2)}\n`;
export function rootsHome(env = process.env) {
  return resolve(env.ROOTS_HOME || join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'roots'));
}
export function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try { return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')); }
  catch { throw new RootsError(`Invalid JSON in ${path}; values omitted from diagnostics.`); }
}
export function assertOwnedPath(root, path) {
  const base = resolve(root), target = resolve(path);
  if (!containsPath(base, target)) throw new RootsError('Refusing a file operation outside the selected Roots home.');
  let current = base;
  for (const segment of relative(base, target).split(sep).filter(Boolean)) {
    current = join(current, segment);
    let entry;
    try { entry = lstatSync(current); } catch (error) { if (error.code === 'ENOENT') break; throw error; }
    if (entry.isSymbolicLink()) throw new RootsError('Refusing a redirected Roots runtime/configuration path.');
    if (existsSync(base) && !containsPath(realpathSync.native(base), realpathSync.native(current))) throw new RootsError('Roots path escapes its selected home.');
  }
}
export function writeAtomic(path, text, { root } = {}) {
  if (root) assertOwnedPath(root, path);
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, text, { mode: 0o600, flag: 'wx' });
    renameSync(temporary, path);
  } finally { if (existsSync(temporary)) unlinkSync(temporary); }
}
function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RootsError(`${label} must be an object.`);
}
function keys(value, allowed, label) {
  object(value, label);
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new RootsError(`${label} contains an unsupported field; consult docs/configuration.md.`);
}
export function validateUrl(value, label) {
  let url;
  try { url = new URL(value); } catch { throw new RootsError(`${label} must be an HTTP(S) URL.`); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new RootsError(`${label} must be an HTTP(S) URL without credentials, query or fragment.`);
  }
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new RootsError(`${label} requires HTTPS outside loopback.`);
  }
  return value.replace(/\/+$/, '');
}
export function validateCredential(value, label, { literal = false } = {}) {
  keys(value, ['env', 'op', 'none', ...(literal ? ['value'] : [])], label);
  if (Object.keys(value).length !== 1) throw new RootsError(`${label} must select exactly one credential source.`);
  if ('env' in value && (typeof value.env !== 'string' || !variable.test(value.env))) throw new RootsError(`${label}.env must name an environment variable.`);
  if ('op' in value && (typeof value.op !== 'string' || !/^op:\/\/[^\r\n]+$/.test(value.op))) throw new RootsError(`${label}.op must be a 1Password reference.`);
  if ('none' in value && value.none !== true) throw new RootsError(`${label}.none must be true.`);
  if ('value' in value && typeof value.value !== 'string') throw new RootsError(`${label}.value must be a string.`);
}
export function validateConfig(config) {
  keys(config, ['version', 'defaultTool', 'gateways', 'profiles', 'projects', 'scout'], 'config');
  if (config.version !== 1) throw new RootsError('Unsupported configuration version; expected 1.');
  if (!TOOLS.includes(config.defaultTool)) throw new RootsError('defaultTool must be claude, codex or opencode.');
  object(config.gateways, 'gateways'); object(config.profiles, 'profiles'); object(config.projects, 'projects');
  for (const [id, gateway] of Object.entries(config.gateways)) {
    if (!identifier.test(id)) throw new RootsError('Gateway names must use letters, numbers, hyphens or underscores.');
    keys(gateway, ['openaiBaseUrl', 'anthropicBaseUrl', 'supportsStandaloneWebSearch'], `gateway ${id}`);
    validateUrl(gateway.openaiBaseUrl, `gateway ${id}.openaiBaseUrl`);
    if (Object.hasOwn(gateway, 'anthropicBaseUrl')) validateUrl(gateway.anthropicBaseUrl, `gateway ${id}.anthropicBaseUrl`);
    if ('supportsStandaloneWebSearch' in gateway && typeof gateway.supportsStandaloneWebSearch !== 'boolean') throw new RootsError('supportsStandaloneWebSearch must be boolean.');
  }
  for (const [id, profile] of Object.entries(config.profiles)) {
    if (!identifier.test(id)) throw new RootsError('Profile names must use letters, numbers, hyphens or underscores.');
    keys(profile, ['gateway', 'credential', 'models', 'opencodeSchema'], `profile ${id}`);
    if (!Object.hasOwn(config.gateways, profile.gateway)) throw new RootsError(`Profile ${id} references an unknown gateway.`);
    validateCredential(profile.credential, `profile ${id}.credential`);
    object(profile.models, `profile ${id}.models`);
    for (const [tool, model] of Object.entries(profile.models)) {
      if (!TOOLS.includes(tool) || typeof model !== 'string' || !model.trim() || /[\r\n]/.test(model)) throw new RootsError(`Profile ${id} contains an invalid tool/model mapping.`);
    }
    if ('opencodeSchema' in profile && ![1, 2].includes(profile.opencodeSchema)) throw new RootsError('opencodeSchema must be 1 or 2.');
  }
  for (const [path, profile] of Object.entries(config.projects)) {
    if (!isAbsolute(path) || !Object.hasOwn(config.profiles, profile)) throw new RootsError('Project bindings require absolute paths and known profiles.');
  }
  if (Object.hasOwn(config, 'scout')) {
    keys(config.scout, ['sources', 'profile', 'model'], 'scout');
    if (!Array.isArray(config.scout.sources)) throw new RootsError('scout.sources must be an array.');
    const ids = new Set();
    for (const source of config.scout.sources) {
      keys(source, ['id', 'url'], 'scout source');
      if (!identifier.test(source.id) || ids.has(source.id)) throw new RootsError('Scout source IDs must be valid and unique.');
      ids.add(source.id); validateUrl(source.url, `scout source ${source.id}`);
    }
    if (config.scout.profile && !Object.hasOwn(config.profiles, config.scout.profile)) throw new RootsError('Scout references an unknown profile.');
    if (config.scout.model && (typeof config.scout.model !== 'string' || !config.scout.model.trim() || /[\r\n]/.test(config.scout.model))) throw new RootsError('scout.model must be a model ID.');
  }
  return config;
}
export function loadConfig(home) {
  const config = readJson(join(home, 'config.json'));
  if (!config) throw new RootsError('Roots is not initialized. Run roots init --help.');
  return validateConfig(config);
}
export function canonicalPath(path) {
  const absolute = resolve(path);
  if (!existsSync(absolute) || !statSync(absolute).isDirectory()) throw new RootsError('The project directory does not exist.');
  return realpathSync.native(absolute);
}
export function containsPath(parent, child) {
  const relation = relative(parent, child);
  return relation === '' || (!relation.startsWith(`..${sep}`) && relation !== '..' && !isAbsolute(relation));
}
export function selectContext(home, config, { project = process.cwd(), profile } = {}) {
  const directory = canonicalPath(project);
  let projectRoot = directory;
  if (profile && !Object.hasOwn(config.profiles, profile)) throw new RootsError('Unknown profile; no credential fallback was attempted.');
  if (!profile) {
    const matches = Object.entries(config.projects).filter(([path]) => existsSync(path)).map(([path, id]) => [canonicalPath(path), id])
      .filter(([path]) => containsPath(path, directory)).sort(([a], [b]) => b.length - a.length);
    if (!matches.length) throw new RootsError('Project is unbound. Run roots project bind --profile <name> <path>, or select --profile explicitly.');
    if (matches.some(([path, id]) => path === matches[0][0] && id !== matches[0][1])) throw new RootsError('Ambiguous project binding; resolve duplicate paths before launching.');
    profile = matches[0][1];
    projectRoot = matches[0][0];
  }
  const selected = config.profiles[profile], gateway = config.gateways[selected.gateway];
  const identity = digest(`${projectRoot}\n${profile}\n${JSON.stringify(gateway)}\n${JSON.stringify(selected.credential)}`);
  const runtime = join(home, 'state', 'runtimes', profile, identity);
  return { home, config, project: projectRoot, cwd: directory, profile, selected, gateway, identity, runtime };
}
export function starterConfig({ gateway = 'http://localhost:4000/v1', anthropic, model = 'your-code-model', keyEnv = 'LITELLM_API_KEY', tool = 'codex' } = {}) {
  return validateConfig({ version: 1, defaultTool: tool,
    gateways: { default: { openaiBaseUrl: gateway, ...(anthropic ? { anthropicBaseUrl: anthropic } : {}) } },
    profiles: { default: { gateway: 'default', credential: { env: keyEnv }, models: { [tool]: model } } },
    projects: {}, scout: { sources: [] } });
}
