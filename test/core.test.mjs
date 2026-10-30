import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { adapterEnvironment, adapterPlan } from '../src/adapters.mjs';
import { canonicalPath, containsPath, jsonText, selectContext, starterConfig, validateConfig, validateUrl, writeAtomic } from '../src/config.mjs';
import { cleanEnvironment, mcpVariable, resolveCredential, resolveLaunchSecrets } from '../src/credentials.mjs';
import { validateRegistry } from '../src/mcp.mjs';
import { discoverModels } from '../src/models.mjs';
import { requestText } from '../src/http.mjs';
import { runScout, scoutStatus } from '../src/scout.mjs';
import { syncContext } from '../src/sync.mjs';

const cli = fileURLToPath(new URL('../bin/roots.mjs', import.meta.url));
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'roots-test-'));
  t.after(() => { assert.ok(containsPath(resolve(tmpdir()), resolve(root))); rmSync(root, { recursive: true, force: true }); });
  const home = join(root, 'home'), alpha = join(root, 'alpha'), beta = join(root, 'beta');
  for (const directory of [home, alpha, beta, join(home, 'skills')]) mkdirSync(directory, { recursive: true });
  const config = starterConfig({ model: 'vendor/any-model' });
  config.profiles.default.credential = { env: 'ALPHA_KEY' };
  config.profiles.beta = { gateway: 'default', credential: { env: 'BETA_KEY' }, models: { codex: 'another-model' } };
  config.projects[canonicalPath(alpha)] = 'default'; config.projects[canonicalPath(beta)] = 'beta';
  writeAtomic(join(home, 'config.json'), jsonText(config));
  writeAtomic(join(home, 'AGENTS.md'), '# Test instructions\n');
  return { root, home, alpha, beta, config, context: selectContext(home, config, { project: alpha }) };
}
function cliEnv(home, extra = {}) {
  const environment = { ROOTS_HOME: home, ...extra };
  for (const name of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'PATHEXT']) if (process.env[name]) environment[name] = process.env[name];
  return environment;
}
function invoke(home, cwd, args, extra) { return spawnSync(process.execPath, [cli, ...args], { cwd, env: cliEnv(home, extra), encoding: 'utf8', timeout: 20_000 }); }
function fileText(directory) {
  return readdirSync(directory, { withFileTypes: true }).filter(entry => !entry.isSymbolicLink()).map(entry =>
    entry.isDirectory() ? fileText(join(directory, entry.name)) : readFileSync(join(directory, entry.name), 'utf8')).join('\n');
}

test('project binding selects each credential without a global fallback', t => {
  const f = fixture(t);
  assert.equal(selectContext(f.home, f.config, { project: f.beta }).profile, 'beta');
  assert.throws(() => selectContext(f.home, f.config, { project: f.root }), /unbound/);
  assert.throws(() => selectContext(f.home, f.config, { project: f.alpha, profile: 'missing' }), /Unknown profile/);
  assert.equal(selectContext(f.home, f.config, { project: f.root, profile: 'beta' }).profile, 'beta');
});
test('a bound project keeps its runtime when launched from a subdirectory', t => {
  const f = fixture(t), child = join(f.alpha, 'src'); mkdirSync(child);
  const selected = selectContext(f.home, f.config, { project: child });
  assert.equal(selected.runtime, f.context.runtime); assert.equal(selected.project, canonicalPath(f.alpha));
  f.config.projects[canonicalPath(child)] = 'beta';
  assert.equal(selectContext(f.home, f.config, { project: child }).profile, 'beta');
});
test('sibling path prefixes do not inherit a binding', t => {
  const f = fixture(t), sibling = `${f.alpha}-unbound`; mkdirSync(sibling);
  assert.throws(() => selectContext(f.home, f.config, { project: sibling }), /unbound/);
});
test('project, profile and gateway changes isolate runtime and cache identities', t => {
  const f = fixture(t), beta = selectContext(f.home, f.config, { project: f.beta });
  assert.notEqual(f.context.runtime, beta.runtime);
  assert.notEqual(f.context.runtime, selectContext(f.home, f.config, { project: f.alpha, profile: 'beta' }).runtime);
  f.config.gateways.default.openaiBaseUrl = 'https://gateway.example.com/v1';
  assert.notEqual(f.context.runtime, selectContext(f.home, f.config, { project: f.alpha }).runtime);
});
test('inline API keys and unknown configuration fields are rejected without echoing values', () => {
  const config = starterConfig(); config.profiles.default.credential = { apiKey: 'dummy-private-value' };
  assert.throws(() => validateConfig(config), error => !error.message.includes('dummy-private-value'));
  assert.throws(() => validateConfig({ ...starterConfig(), privateSetting: true }), /unsupported field/);
});
test('gateway URLs reject userinfo, queries and non-loopback plaintext', () => {
  for (const url of ['https://user:dummy@example.com/v1', 'https://example.com/v1?api_key=dummy', 'http://example.com/v1', 'file:///tmp/model']) assert.throws(() => validateUrl(url, 'gateway'));
  assert.equal(validateUrl('http://localhost:4000/v1/', 'gateway'), 'http://localhost:4000/v1');
});
test('a missing selected key fails even when another provider key exists', () => {
  assert.throws(() => resolveCredential({ env: 'SELECTED_KEY' }, { OPENAI_API_KEY: 'dummy-other' }), /missing/);
});
test('1Password failure output is omitted and repeated references are resolved once', t => {
  const f = fixture(t); f.context.selected.credential = { op: 'op://Example/Project/token' };
  let calls = 0;
  const registry = validateRegistry({ servers: { demo: { type: 'stdio', command: 'node', env: { TOKEN: { op: 'op://Example/Project/token' } } } } });
  const secrets = resolveLaunchSecrets(f.context, registry, {}, () => { calls++; return { status: 0, stdout: 'dummy-secret\n' }; });
  assert.equal(calls, 1); assert.equal(secrets.ROOTS_API_KEY, 'dummy-secret');
  assert.throws(() => resolveCredential({ op: 'op://Example/Project/token' }, {}, () => ({ status: 1, stderr: 'dummy-secret' })), error => !error.message.includes('dummy-secret'));
});
test('launch cleanup removes alternate provider keys, profile keys and original MCP sources', t => {
  const f = fixture(t), registry = { servers: { demo: { env: { TOKEN: { env: 'OTHER_MCP_KEY' } } } } };
  const env = cleanEnvironment({ PATH: 'safe', ANTHROPIC_AUTH_TOKEN: 'dummy', BETA_KEY: 'dummy', ALPHA_KEY: 'dummy', OTHER_MCP_KEY: 'dummy', ROOTS_MCP_OLD: 'dummy', OPENCODE_CONFIG_CONTENT: 'dummy' }, f.config, registry);
  assert.deepEqual(env, { PATH: 'safe' });
});
test('generated configs contain variable references and live search, with no resolved secrets', t => {
  const f = fixture(t);
  f.config.gateways.default.anthropicBaseUrl = 'https://gateway.example.com';
  f.context.selected.models = { codex: 'vendor/code', claude: 'vendor/chat', opencode: 'vendor/code' };
  const registry = validateRegistry({ servers: { local: { type: 'stdio', command: 'node', env: { TOKEN: { env: 'DUMMY_TOKEN' } } }, remote: { type: 'http', url: 'https://example.com/mcp', headers: { Authorization: { env: 'DUMMY_AUTH' } } } } });
  const plans = syncContext(f.context, registry);
  assert.equal(plans.plans.length, 3);
  const text = plans.plans.map(plan => Object.values(plan.files).join('\n')).join('\n');
  assert.match(text, /web_search = "live"/); assert.match(text, /ROOTS_API_KEY/); assert.match(text, /ROOTS_MCP_/);
  assert.ok(!text.includes('op://')); assert.ok(!text.includes('DUMMY_TOKEN'));
});
test('sync is idempotent and leaves native Codex settings untouched', t => {
  const f = fixture(t), registry = { servers: {} };
  const first = syncContext(f.context, registry), base = join(first.plans[0].directory, 'config.toml');
  writeFileSync(base, '[tui]\nanimations = false\n');
  assert.equal(syncContext(f.context, registry).changes.length, 0);
  assert.equal(readFileSync(base, 'utf8'), '[tui]\nanimations = false\n');
});
test('dry-run neither creates runtime files nor reads credentials', t => {
  const f = fixture(t), result = invoke(f.home, f.alpha, ['run', 'codex', '--dry-run']);
  assert.equal(result.status, 0, result.stderr); assert.ok(!existsSync(join(f.home, 'state')));
  assert.ok(!result.stdout.includes('dummy-secret'));
});
test('CLI forwards arguments without a shell and records no credential values', t => {
  const f = fixture(t), fake = join(f.root, 'fake-agent.mjs'), capture = join(f.root, 'capture.json');
  writeFileSync(fake, 'import {writeFileSync} from "node:fs"; writeFileSync(process.env.ROOTS_TEST_CAPTURE, JSON.stringify({args:process.argv.slice(2),key:process.env.ROOTS_API_KEY,other:process.env.BETA_KEY,base:process.env.OPENAI_BASE_URL,home:process.env.CODEX_HOME}));');
  const result = invoke(f.home, f.alpha, ['run', 'codex', '--', 'exec', 'a b', 'literal $(value)', 'x&y'], { ALPHA_KEY: 'dummy-alpha', BETA_KEY: 'dummy-beta', OPENAI_BASE_URL: 'https://wrong.example.com', ROOTS_TOOL_CODEX: fake, ROOTS_TEST_CAPTURE: capture });
  assert.equal(result.status, 0, result.stderr);
  const data = JSON.parse(readFileSync(capture)); assert.equal(data.key, 'dummy-alpha'); assert.equal(data.other, undefined); assert.equal(data.base, undefined);
  assert.deepEqual(data.args.slice(-4), ['exec', 'a b', 'literal $(value)', 'x&y']);
  assert.ok(!fileText(f.home).includes('dummy-alpha')); assert.ok(!fileText(f.home).includes('dummy-beta'));
  const status = invoke(f.home, f.alpha, ['status', '--json']); assert.equal(JSON.parse(status.stdout)[0].status, 'done');
});
test('MCP subprocess receives its own mapped credential and no other server credential', t => {
  const f = fixture(t), server = join(f.root, 'mcp-server.mjs'), capture = join(f.root, 'mcp-capture.json');
  writeFileSync(server, 'import {writeFileSync} from "node:fs"; writeFileSync(process.env.ROOTS_TEST_CAPTURE, JSON.stringify({token:process.env.TOKEN,other:process.env.ROOTS_MCP_OTHER,key:process.env.ROOTS_API_KEY}));');
  const registry = validateRegistry({ servers: { demo: { type: 'stdio', command: process.execPath, args: [server], env: { TOKEN: { env: 'SOURCE_TOKEN' } } } } });
  writeAtomic(join(f.home, 'mcp.json'), jsonText(registry));
  const snapshot = join(f.home, 'snapshot.json'); writeAtomic(snapshot, jsonText(registry));
  writeAtomic(join(f.home, 'mcp.json'), jsonText({ servers: {} }));
  const runner = fileURLToPath(new URL('../bin/roots-mcp.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [runner, 'demo'], { env: cliEnv(f.home, { ROOTS_PROFILE: 'default', ROOTS_MCP_REGISTRY: snapshot, [mcpVariable('demo', 'TOKEN')]: 'dummy-mcp', ROOTS_MCP_OTHER: 'dummy-other', ROOTS_API_KEY: 'dummy-model', ROOTS_TEST_CAPTURE: capture }), encoding: 'utf8', timeout: 20_000 });
  assert.equal(result.status, 0, result.stderr); assert.deepEqual(JSON.parse(readFileSync(capture)), { token: 'dummy-mcp' });
});
test('model discovery uses the selected key and caches only IDs per project', async t => {
  const f = fixture(t);
  const fetcher = async (url, options) => { assert.match(url, /\/v1\/models$/); assert.equal(options.headers.Authorization, 'Bearer dummy-alpha'); return new Response(JSON.stringify({ data: [{ id: 'provider/model' }, { id: 'unfiltered@model' }], private: 'dummy-response-detail' })); };
  const result = await discoverModels(f.context, { fetcher, env: { ALPHA_KEY: 'dummy-alpha' } });
  assert.deepEqual(result.ids, ['provider/model', 'unfiltered@model']);
  const text = readFileSync(join(f.context.runtime, 'models.json'), 'utf8'); assert.ok(!text.includes('dummy-alpha')); assert.ok(!text.includes('dummy-response-detail'));
  assert.ok(!existsSync(join(selectContext(f.home, f.config, { project: f.beta }).runtime, 'models.json')));
});
test('HTTP errors and redirects omit response bodies and credentials', async () => {
  await assert.rejects(requestText('https://example.com', { fetcher: async () => new Response('dummy-secret', { status: 401 }) }), error => error.message.includes('401') && !error.message.includes('dummy-secret'));
  await requestText('https://example.com', { fetcher: async (_url, options) => { assert.equal(options.redirect, 'error'); return new Response('ok'); } });
  await assert.rejects(requestText('https://example.com', { limit: 2, fetcher: async () => new Response('too large') }), /size limit/);
});
test('scout baselines without AI, queues changes and validates cited quotes before clearing', async t => {
  const f = fixture(t); f.config.scout = { sources: [{ id: 'tool', url: 'https://example.com/changelog' }], profile: 'default', model: 'review-model' };
  let content = 'old release', aiCalls = 0;
  const fetcher = async (url, options) => {
    if (url.endsWith('/chat/completions')) { aiCalls++; assert.equal(options.headers.Authorization, 'Bearer dummy-alpha'); return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ proposals: [{ summary: 'Check new support', evidence: 'new support' }] }) } }] })); }
    assert.equal(options.headers.Authorization, undefined); return new Response(content);
  };
  assert.equal((await runScout(f.home, f.config, { fetcher })).pending, 0); assert.equal(aiCalls, 0);
  content = 'release adds new support';
  assert.equal((await runScout(f.home, f.config, { fetcher })).pending, 1); assert.equal(aiCalls, 0);
  const result = await runScout(f.home, f.config, { fetcher, review: true, env: { ALPHA_KEY: 'dummy-alpha' } });
  assert.equal(result.pending, 0); assert.equal(result.proposals.length, 1); assert.equal(aiCalls, 1);
  assert.ok(!readFileSync(result.report, 'utf8').includes('dummy-alpha'));
});
test('scout invalid model evidence and failed source requests keep changed work pending', async t => {
  const f = fixture(t); f.config.scout = { sources: [{ id: 'tool', url: 'https://example.com/changelog' }], profile: 'default', model: 'review-model' };
  await runScout(f.home, f.config, { fetcher: async () => new Response('old') });
  await runScout(f.home, f.config, { fetcher: async () => new Response('new') });
  await assert.rejects(runScout(f.home, f.config, { review: true, env: { ALPHA_KEY: 'dummy' }, fetcher: async url => url.endsWith('/chat/completions') ? new Response(JSON.stringify({ choices: [{ message: { content: '{"proposals":[{"summary":"x","evidence":"invented"}]}' } }] })) : new Response('new') }), /exact-quote/);
  assert.ok(scoutStatus(f.home).sources.tool.pendingFile);
  const result = await runScout(f.home, f.config, { fetcher: async () => new Response('private-detail', { status: 503 }) });
  assert.equal(result.failures.length, 1); assert.ok(scoutStatus(f.home).sources.tool.pendingFile);
});
test('MCP inline secret fields and path traversal names are rejected', () => {
  assert.throws(() => validateRegistry({ servers: { '../escape': { type: 'stdio', command: 'node' } } }));
  assert.throws(() => validateRegistry({ servers: { demo: { type: 'stdio', command: 'node', env: { TOKEN: { value: 'dummy-inline' } } } } }), error => !error.message.includes('dummy-inline'));
});
test('Claude helper aliases keep the selected model and gateway', t => {
  const f = fixture(t); f.context.gateway.anthropicBaseUrl = 'https://gateway.example.com'; f.context.selected.models.claude = 'provider/chat';
  const env = adapterEnvironment(f.context, 'claude', { ROOTS_API_KEY: 'dummy' });
  assert.equal(env.ANTHROPIC_DEFAULT_HAIKU_MODEL, 'provider/chat'); assert.equal(env.ANTHROPIC_BASE_URL, 'https://gateway.example.com');
  assert.throws(() => adapterPlan({ ...f.context, gateway: { openaiBaseUrl: 'http://localhost:4000/v1' } }, 'claude', { servers: {} }), /anthropicBaseUrl/);
});
test('command-specific options and misplaced native arguments fail before any mutation', t => {
  const f = fixture(t), unusedHome = join(f.root, 'unused');
  const init = invoke(unusedHome, f.alpha, ['init', '--dry-run']); assert.equal(init.status, 1); assert.ok(!existsSync(unusedHome));
  const run = invoke(f.home, f.alpha, ['run', 'codex', 'unforwarded-prompt']); assert.equal(run.status, 1); assert.match(run.stderr, /after --/);
});
test('MCP profile filtering does not resolve unavailable server secrets', t => {
  const f = fixture(t), registry = validateRegistry({ servers: { beta: { type: 'stdio', command: 'node', profiles: ['beta'], env: { TOKEN: { env: 'MISSING_BETA_TOKEN' } } } } });
  const secrets = resolveLaunchSecrets(f.context, registry, { ALPHA_KEY: 'dummy-alpha' });
  assert.deepEqual(secrets, { ROOTS_API_KEY: 'dummy-alpha' });
});
test('malformed optional MCP restrictions are rejected instead of widening access', () => {
  for (const field of [{ profiles: false }, { profiles: null }, { args: false }, { env: null }]) {
    assert.throws(() => validateRegistry({ servers: { demo: { type: 'stdio', command: 'node', ...field } } }));
  }
  assert.throws(() => validateRegistry({ servers: { demo: { type: 'http', url: 'https://example.com/mcp', headers: false } } }));
});
test('redirected runtime directories are rejected without writing outside the Roots home', t => {
  const f = fixture(t), outside = join(f.root, 'outside'); mkdirSync(outside); mkdirSync(f.context.runtime, { recursive: true });
  symlinkSync(outside, join(f.context.runtime, 'codex'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => syncContext(f.context, { servers: {} }), /redirected/);
  assert.deepEqual(readdirSync(outside), []);
});
test('atomic write cleans its temporary file when replacement fails', t => {
  const f = fixture(t), target = join(f.home, 'existing-directory'); mkdirSync(target);
  assert.throws(() => writeAtomic(target, 'dummy-data'));
  assert.deepEqual(readdirSync(f.home).sort(), ['AGENTS.md', 'config.json', 'existing-directory', 'skills']);
});
test('first successful scout fetch after failure is still a no-AI baseline', async t => {
  const f = fixture(t); f.config.scout = { sources: [{ id: 'tool', url: 'https://example.com/changelog' }], profile: 'default', model: 'review-model' };
  await runScout(f.home, f.config, { fetcher: async () => new Response('failed', { status: 503 }) });
  const result = await runScout(f.home, f.config, { review: true, fetcher: async url => { assert.ok(!url.endsWith('/chat/completions')); return new Response('all past releases'); } });
  assert.equal(result.pending, 0); assert.equal(result.changed.length, 0);
});
test('a changed scout URL gets a fresh successful baseline after a failed attempt', async t => {
  const f = fixture(t); f.config.scout = { sources: [{ id: 'tool', url: 'https://example.com/old' }] };
  await runScout(f.home, f.config, { fetcher: async () => new Response('old baseline') });
  f.config.scout.sources[0].url = 'https://example.com/new';
  await runScout(f.home, f.config, { fetcher: async () => new Response('failed', { status: 503 }) });
  assert.equal(scoutStatus(f.home).sources.tool.url, 'https://example.com/old');
  const result = await runScout(f.home, f.config, { fetcher: async () => new Response('different source history') });
  assert.equal(result.pending, 0); assert.equal(result.changed.length, 0);
});
test('malformed scout state releases the acquired lock', async t => {
  const f = fixture(t); f.config.scout = { sources: [{ id: 'tool', url: 'https://example.com/changelog' }] };
  writeAtomic(join(f.home, 'state', 'scout.json'), '{broken');
  await assert.rejects(runScout(f.home, f.config, { fetcher: async () => new Response('unused') }), /Invalid JSON/);
  assert.ok(!existsSync(join(f.home, 'scout.lock')));
});
test('modified scout snapshots are rejected before AI receives their contents', async t => {
  const f = fixture(t); f.config.scout = { sources: [{ id: 'tool', url: 'https://example.com/changelog' }], profile: 'default', model: 'review-model' };
  await runScout(f.home, f.config, { fetcher: async () => new Response('old') });
  await runScout(f.home, f.config, { fetcher: async () => new Response('new') });
  const snapshot = scoutStatus(f.home).sources.tool.pendingFile; writeFileSync(snapshot, 'unintended local content');
  await assert.rejects(runScout(f.home, f.config, { review: true, env: { ALPHA_KEY: 'dummy' }, fetcher: async url => { assert.ok(!url.endsWith('/chat/completions')); return new Response('new'); } }), /changed after fetch/);
});
