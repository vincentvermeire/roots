import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { basename, join, resolve } from 'node:path';
import { adapterArguments, adapterEnvironment } from './adapters.mjs';
import { assertOwnedPath, canonicalPath, identifier, jsonText, loadConfig, readJson, RootsError, rootsHome, selectContext, starterConfig, TOOLS, validateConfig, writeAtomic } from './config.mjs';
import { cleanEnvironment, resolveLaunchSecrets } from './credentials.mjs';
import { loadRegistry, serversFor, validateRegistry } from './mcp.mjs';
import { discoverModels } from './models.mjs';
import { executableFor, runProcess } from './process.mjs';
import { runScout, scoutStatus } from './scout.mjs';
import { sessionStatus } from './status.mjs';
import { syncContext } from './sync.mjs';

const HELP = {
  main: `Roots: one configuration source and project-scoped gateway access for coding agents.
Usage: roots <command> [options]

Commands:
  init                 Create a configuration home without changing native agent settings
  gateway add|list     Configure OpenAI-compatible and optional Anthropic endpoints
  profile add|list     Configure a gateway, model and credential reference
  project bind|list    Bind an existing project directory to a named profile
  run [tool]           Sync and launch claude, codex or opencode
  sync                 Generate the selected project's isolated agent configuration
  mcp add|remove|list  Manage MCP servers and credential references
  skills add|remove|list  Import or list local Agent Skills
  models list|check    Discover models using the selected project credential
  doctor               Check tool availability and configuration; --online checks models
  status               Show sessions launched by Roots
  scout run|status     Check configured changelogs; AI review is opt-in
  help [command]       Show detailed help

Common options: --home <path>, --profile <name>, --project <path>, --json
Run roots help init to get started. Node.js 22 or later is required.`,
  init: `roots init [--home <path>] [--gateway <OpenAI API base URL>] [--anthropic-url <Messages API base URL>]
           [--model <gateway model ID>] [--key-env <variable>] [--tool codex|claude|opencode]
Defaults: ~/.config/roots, http://localhost:4000/v1, LITELLM_API_KEY, codex.
The generated model is a placeholder unless --model is supplied. No project is bound automatically.
Configuration stores credential references; this command never asks for or stores an API key.`,
  gateway: `roots gateway list
roots gateway add <name> --openai-url <URL> [--anthropic-url <URL>]
URLs are exact API bases. HTTPS is required outside loopback. Configure native search capability
only after verifying it in config.json; protocol compatibility is gateway-specific.`,
  profile: `roots profile list
roots profile add <name> --gateway <name> --model <ID> [--tool codex|claude|opencode]
    [--key-env <variable> | --op-ref <op://reference> | --no-auth] [--opencode-schema 1|2]
Use a separate profile and credential source for each billing project. Existing profiles are not overwritten.`,
  project: `roots project list
roots project bind <directory> --profile <name>
Bindings live in your Roots home, not in the project's repository. The closest bound parent wins.
An unbound project fails unless --profile is supplied explicitly.`,
  run: `roots run [claude|codex|opencode] [--profile <name>] [--project <directory>] [--dry-run] [-- <agent arguments>]
Launches with a project/profile-specific configuration home and in-memory credentials.
Arguments after -- go directly to the agent. --dry-run resolves no secrets and starts no processes.
Native agent overrides are user-controlled; Roots is a launcher, not a network security boundary.`,
  sync: `roots sync [--profile <name>] [--project <directory>] [--tool <name>] [--dry-run] [--json]
Writes only changed generated files in the selected project's runtime. Resolves no credentials.
Codex base config.toml and Claude base settings.json remain agent/user-owned.`,
  mcp: `roots mcp list
roots mcp add <name> --file <server.json>
roots mcp remove <name>
Server format: {"type":"stdio","command":"node","args":["/path/server.mjs"],"env":{"TOKEN":{"env":"MCP_TOKEN"}}}
HTTP servers use {"type":"http","url":"https://example.com/mcp","headers":{"Authorization":{"env":"MCP_AUTHORIZATION"}}}.
Credential values remain in the environment/1Password. Optional profiles limit a server's availability.`,
  skills: `roots skills list
roots skills add <local skill directory>
roots skills remove <name>
Local imports require SKILL.md and reject symlinks. Roots does not download or execute installers.`,
  models: `roots models list|check [--profile <name>] [--project <directory>] [--json]
GET <openaiBaseUrl>/models with the selected credential. No provider/model-name filtering.
Caches IDs and timestamps per project/profile/gateway, never credentials or full response bodies.`,
  doctor: `roots doctor [--profile <name>] [--project <directory>] [--online] [--json]
Checks configuration, installed tool versions, generated-file drift and scout state.
--online also verifies model discovery using the selected credential. No changes are made.`,
  status: `roots status [--json]
Shows up to 30 recent sessions launched through this Roots home. Interrupted wrappers are detected
using process presence. Agent-internal subagents and sessions started elsewhere are outside this view.`,
  scout: `roots scout run [--review] [--json]
roots scout status [--json]
Configure scout.sources in config.json. The first successful fetch is a baseline; later changes queue.
--review uses the explicitly configured scout.profile/model and validates exact evidence quotes.
Reports go to ROOTS_HOME/reports. No agent configuration is applied. See docs/scout.md for scheduling.`,
};
const valueFlags = new Set(['home', 'profile', 'project', 'gateway', 'anthropic-url', 'openai-url', 'model', 'key-env', 'tool', 'op-ref', 'opencode-schema', 'file']);
const boolFlags = new Set(['help', 'json', 'dry-run', 'online', 'review', 'no-auth', 'version']);
const commandOptions = {
  init: ['gateway', 'anthropic-url', 'model', 'key-env', 'tool'],
  gateway: ['openai-url', 'anthropic-url'],
  profile: ['gateway', 'model', 'tool', 'key-env', 'op-ref', 'no-auth', 'opencode-schema'],
  project: ['profile'], run: ['profile', 'project', 'dry-run'], sync: ['profile', 'project', 'tool', 'dry-run'],
  mcp: ['file'], skills: [], models: ['profile', 'project'], doctor: ['profile', 'project', 'online'],
  status: [], scout: ['review'],
};
export function parseArguments(args) {
  const positions = [], options = {}, separator = args.indexOf('--');
  const own = separator < 0 ? args : args.slice(0, separator), forwarded = separator < 0 ? [] : args.slice(separator + 1);
  for (let i = 0; i < own.length; i++) {
    const arg = own[i];
    if (arg === '-h') { options.help = true; continue; }
    if (arg === '-v') { options.version = true; continue; }
    if (!arg.startsWith('--')) { positions.push(arg); continue; }
    const flag = arg.slice(2);
    if (Object.hasOwn(options, flag)) throw new RootsError('An option was supplied more than once.');
    if (boolFlags.has(flag)) options[flag] = true;
    else if (valueFlags.has(flag)) {
      if (!own[i + 1] || own[i + 1].startsWith('--')) throw new RootsError('An option is missing its value.');
      options[flag] = own[++i];
    } else throw new RootsError('Unknown Roots option. Native agent arguments belong after --; see roots help.');
  }
  return { positions, options, forwarded };
}
const contextFor = (home, config, options) => selectContext(home, config, { project: options.project, profile: options.profile });
function output(value, options, lines) { console.log(options.json ? jsonText(value).trimEnd() : (lines || jsonText(value).trimEnd())); }
function saveConfig(home, config) { writeAtomic(join(home, 'config.json'), jsonText(validateConfig(config)), { root: home }); }
function checkSkillTree(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new RootsError('Skill imports cannot contain symlinks.');
    if (entry.isDirectory()) checkSkillTree(path);
    else if (!entry.isFile()) throw new RootsError('Skill imports must contain regular files and directories.');
  }
}
async function dispatch({ positions: [command = 'help', sub, ...rest], options, forwarded }) {
  if (options.version) { console.log('0.1.0'); return 0; }
  if (options.help || command === 'help') { console.log(HELP[command === 'help' ? sub || 'main' : command] || HELP.main); return 0; }
  if (!Object.hasOwn(HELP, command) || command === 'main') throw new RootsError('Unknown Roots command; run roots help.');
  if (Object.keys(options).some(key => !['home', 'json'].includes(key) && !commandOptions[command]?.includes(key))) throw new RootsError('This option does not apply to the selected command; see roots help.');
  const positionalLimit = ['init', 'sync', 'doctor', 'status'].includes(command) ? 0
    : ['run', 'models', 'scout'].includes(command) || sub === 'list' ? 1 : 2;
  if ([sub, ...rest].filter(value => value !== undefined).length > positionalLimit) throw new RootsError('Unexpected positional argument; native agent arguments belong after --.');
  if (forwarded.length && command !== 'run') throw new RootsError('Only roots run accepts forwarded agent arguments.');
  const home = options.home ? resolve(options.home) : rootsHome();
  if (command === 'init') {
    if (existsSync(join(home, 'config.json'))) throw new RootsError('Roots configuration already exists; no files were overwritten.');
    const config = starterConfig({ gateway: options.gateway, anthropic: options['anthropic-url'], model: options.model, keyEnv: options['key-env'], tool: options.tool });
    saveConfig(home, config);
    if (!existsSync(join(home, 'AGENTS.md'))) writeAtomic(join(home, 'AGENTS.md'), '# Shared agent instructions\n\nAdd your own cross-project instructions here. Project rules stay in each repository.\n', { root: home });
    if (!existsSync(join(home, 'mcp.json'))) writeAtomic(join(home, 'mcp.json'), jsonText({ servers: {} }), { root: home });
    mkdirSync(join(home, 'skills'), { recursive: true });
    output({ home, initialized: true }, options, `Initialized ${home}. Set a gateway model ID, then bind a project with roots project bind.`); return 0;
  }
  const config = loadConfig(home);
  if (command === 'gateway') {
    if (sub === 'list') { output(Object.keys(config.gateways), options); return 0; }
    const name = rest[0];
    if (sub !== 'add' || !identifier.test(name || '') || !options['openai-url'] || Object.hasOwn(config.gateways, name)) throw new RootsError('Use roots gateway add with a new valid name and --openai-url.');
    config.gateways[name] = { openaiBaseUrl: options['openai-url'], ...(options['anthropic-url'] ? { anthropicBaseUrl: options['anthropic-url'] } : {}) };
    saveConfig(home, config); console.log('Gateway added.'); return 0;
  }
  if (command === 'profile') {
    if (sub === 'list') { output(Object.entries(config.profiles).map(([name, p]) => ({ name, gateway: p.gateway, tools: Object.keys(p.models), credentialSource: Object.keys(p.credential)[0] })), options); return 0; }
    const name = rest[0], tool = options.tool || config.defaultTool;
    if (sub !== 'add' || !identifier.test(name || '') || Object.hasOwn(config.profiles, name) || !options.gateway || !options.model) throw new RootsError('Use roots profile add with a new name, --gateway and --model.');
    if ([options['key-env'], options['op-ref'], options['no-auth']].filter(Boolean).length !== 1) throw new RootsError('Select exactly one credential source: --key-env, --op-ref or --no-auth.');
    config.profiles[name] = { gateway: options.gateway, credential: options['key-env'] ? { env: options['key-env'] } : options['op-ref'] ? { op: options['op-ref'] } : { none: true },
      models: { [tool]: options.model }, ...(options['opencode-schema'] ? { opencodeSchema: Number(options['opencode-schema']) } : {}) };
    saveConfig(home, config); console.log('Profile added.'); return 0;
  }
  if (command === 'project') {
    if (sub === 'list') { output(config.projects, options); return 0; }
    if (sub !== 'bind' || !rest[0] || !Object.hasOwn(config.profiles, options.profile)) throw new RootsError('Use roots project bind <directory> --profile <name>.');
    const path = canonicalPath(rest[0]); config.projects[path] = options.profile;
    saveConfig(home, config); output({ project: path, profile: options.profile }, options); return 0;
  }
  if (command === 'status') { output(sessionStatus(home), options); return 0; }
  if (command === 'scout') {
    if (sub === 'status') { output(scoutStatus(home), options); return 0; }
    if (sub !== 'run') throw new RootsError('Use roots scout run or roots scout status.');
    const result = await runScout(home, config, { review: options.review }); output(result, options); return result.failures.length ? 1 : 0;
  }
  if (command === 'mcp') {
    const registry = loadRegistry(home), name = rest[0];
    if (sub === 'list') { output(Object.entries(registry.servers).map(([id, server]) => ({ name: id, type: server.type, profiles: server.profiles || 'all' })), options); return 0; }
    if (!identifier.test(name || '')) throw new RootsError('MCP server name is invalid.');
    if (sub === 'add' && options.file) {
      if (Object.hasOwn(registry.servers, name)) throw new RootsError('MCP server already exists; no entry was overwritten.');
      registry.servers[name] = readJson(resolve(options.file));
    } else if (sub === 'remove' && Object.hasOwn(registry.servers, name)) delete registry.servers[name];
    else throw new RootsError('Use roots mcp add <name> --file <path>, or roots mcp remove <name>.');
    writeAtomic(join(home, 'mcp.json'), jsonText(validateRegistry(registry)), { root: home }); console.log('MCP registry updated; roots run syncs it before launch.'); return 0;
  }
  if (command === 'skills') {
    const directory = join(home, 'skills');
    if (sub === 'list') { output(existsSync(directory) ? readdirSync(directory, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name) : [], options); return 0; }
    if (sub === 'add' && rest[0]) {
      const source = canonicalPath(rest[0]), name = basename(source), target = join(directory, name);
      if (!identifier.test(name) || !existsSync(join(source, 'SKILL.md'))) throw new RootsError('A local skill requires a valid directory name and SKILL.md.');
      if (existsSync(target)) throw new RootsError('Skill already exists; no directory was overwritten.');
      checkSkillTree(source); assertOwnedPath(home, target); mkdirSync(directory, { recursive: true }); cpSync(source, target, { recursive: true, dereference: false, errorOnExist: true });
    } else if (sub === 'remove' && identifier.test(rest[0] || '')) {
      const target = join(directory, rest[0]);
      assertOwnedPath(home, target);
      if (!existsSync(target) || !lstatSync(target).isDirectory() || lstatSync(target).isSymbolicLink()) throw new RootsError('Skill is missing or is not a Roots-owned directory.');
      rmSync(target, { recursive: true });
    } else throw new RootsError('Use roots skills add <local-directory>, remove <name>, or list.');
    console.log('Skills updated.'); return 0;
  }
  const context = contextFor(home, config, options), registry = loadRegistry(home);
  if (command === 'models') {
    if (!['list', 'check'].includes(sub)) throw new RootsError('Use roots models list or check.');
    const result = await discoverModels(context); output(result, options); return 0;
  }
  if (command === 'doctor') {
    const checks = [];
    for (const tool of Object.keys(context.selected.models)) {
      try {
        const executable = executableFor(tool), result = spawnSync(executable.command, [...executable.prefix, '--version'], { encoding: 'utf8', env: cleanEnvironment(process.env, config), timeout: 10_000, windowsHide: true });
        checks.push({ tool, installed: !result.error && result.status === 0, version: (result.stdout || '').match(/\d+\.\d+\.\d+/)?.[0] || 'unknown' });
      } catch { checks.push({ tool, installed: false }); }
    }
    const drift = syncContext(context, registry, { dryRun: true }).changes;
    let models;
    if (options.online) models = await discoverModels(context, { write: false });
    const result = { profile: context.profile, project: context.project, tools: checks, generatedChanges: drift, ...(models ? { modelIds: models.ids } : {}),
      search: context.gateway.supportsStandaloneWebSearch ? 'Capability declared; runtime compatibility must be verified.' : 'Live mode requested; gateway standalone capability is not declared.', scout: scoutStatus(home) };
    output(result, options); return checks.some(check => !check.installed) || drift.length ? 1 : 0;
  }
  if (command === 'sync' || command === 'run') {
    const tool = command === 'run' ? sub || config.defaultTool : options.tool;
    if (tool && !TOOLS.includes(tool)) throw new RootsError('Unsupported agent tool.');
    const result = syncContext(context, registry, { tool, dryRun: options['dry-run'] });
    if (command === 'sync' || options['dry-run']) { output({ profile: context.profile, project: context.project, changes: result.changes, dryRun: !!options['dry-run'] }, options); return 0; }
    const secrets = resolveLaunchSecrets(context, registry), env = { ...cleanEnvironment(process.env, config, registry), ...adapterEnvironment(context, tool, secrets) };
    const executable = executableFor(tool), plan = result.plans[0], id = randomUUID(), recordFile = join(home, 'state', 'runs', `${id}.json`);
    const snapshot = join(home, 'state', 'mcp-snapshots', `${id}.json`);
    writeAtomic(snapshot, jsonText({ servers: serversFor(registry, context.profile) }), { root: home });
    env.ROOTS_MCP_REGISTRY = snapshot;
    const record = { id, tool, profile: context.profile, project: context.project, model: context.selected.models[tool], status: 'starting', startedAt: new Date().toISOString() };
    console.error(`Roots: ${tool}, profile ${context.profile}, model ${record.model}.`);
    try {
      const code = await runProcess(executable.command, [...executable.prefix, ...adapterArguments(plan, forwarded)], { env, cwd: context.cwd,
        onStart: pid => { record.pid = pid; record.status = 'running'; writeAtomic(recordFile, jsonText(record), { root: home }); } });
      record.status = code === 0 ? 'done' : 'failed'; record.exitCode = code;
      return code;
    } catch (error) { record.status = 'failed'; throw error; }
    finally { record.finishedAt = new Date().toISOString(); writeAtomic(recordFile, jsonText(record), { root: home }); }
  }
  throw new RootsError('Unknown command.');
}
export async function main(args) {
  try { process.exitCode = await dispatch(parseArguments(args)); }
  catch (error) {
    console.error(error instanceof RootsError ? `roots: ${error.message}` : 'roots: operation failed; details omitted to protect configuration and credentials.');
    process.exitCode = 1;
  }
}
