#!/usr/bin/env node
import { loadConfig, readJson, rootsHome, RootsError } from '../src/config.mjs';
import { cleanEnvironment, mcpVariable } from '../src/credentials.mjs';
import { validateRegistry } from '../src/mcp.mjs';
import { runProcess } from '../src/process.mjs';

try {
  const home = rootsHome(), id = process.argv[2];
  if (!process.env.ROOTS_MCP_REGISTRY) throw new RootsError('MCP launch snapshot is missing; restart through roots run.');
  const registry = validateRegistry(readJson(process.env.ROOTS_MCP_REGISTRY)), server = registry.servers[id];
  if (!server || server.type !== 'stdio' || (server.profiles && !server.profiles.includes(process.env.ROOTS_PROFILE))) throw new RootsError('MCP server is not available in this profile.');
  const env = cleanEnvironment(process.env, loadConfig(home), registry);
  for (const [name] of Object.entries(server.env || {})) {
    const value = process.env[mcpVariable(id, name)];
    if (value === undefined) throw new RootsError('MCP launch credential is missing; restart through roots run.');
    env[name] = value;
  }
  if (/\.(cmd|bat)$/i.test(server.command)) throw new RootsError('Use a native executable or node with a script argument for Windows MCP servers.');
  process.exitCode = await runProcess(server.command, server.args || [], { env });
} catch (error) {
  console.error(error instanceof RootsError ? `roots-mcp: ${error.message}` : 'roots-mcp: launch failed; details omitted.');
  process.exitCode = 1;
}
