import { join } from 'node:path';
import { identifier, readJson, RootsError, validateCredential, validateUrl, variable } from './config.mjs';

const sensitive = /token|secret|password|api_?key|authorization|credential/i;
export function validateRegistry(registry) {
  if (!registry || typeof registry !== 'object' || Array.isArray(registry) || Object.keys(registry).some(k => k !== 'servers') || !registry.servers || typeof registry.servers !== 'object' || Array.isArray(registry.servers)) throw new RootsError('MCP registry must contain a servers object.');
  for (const [id, server] of Object.entries(registry.servers)) {
    if (!identifier.test(id) || !server || typeof server !== 'object' || Array.isArray(server)) throw new RootsError('Invalid MCP server.');
    const allowed = server.type === 'stdio' ? ['type', 'command', 'args', 'env', 'profiles'] : ['type', 'url', 'headers', 'profiles'];
    if (Object.keys(server).some(k => !allowed.includes(k))) throw new RootsError(`MCP server ${id} contains an unsupported field.`);
    if (server.type === 'stdio') {
      if (typeof server.command !== 'string' || !server.command || /[\r\n]/.test(server.command)) throw new RootsError(`MCP server ${id} requires an executable.`);
      if (Object.hasOwn(server, 'args') && (!Array.isArray(server.args) || server.args.some(a => typeof a !== 'string'))) throw new RootsError(`MCP server ${id} args must be strings.`);
    } else if (server.type === 'http') validateUrl(server.url, `MCP server ${id}.url`);
    else throw new RootsError('MCP type must be stdio or http.');
    if (Object.hasOwn(server, 'profiles') && (!Array.isArray(server.profiles) || server.profiles.some(p => typeof p !== 'string' || !identifier.test(p)))) throw new RootsError(`MCP server ${id} profiles must be profile names.`);
    const sources = server.type === 'stdio' ? server.env : server.headers;
    const sourceField = server.type === 'stdio' ? 'env' : 'headers';
    if (Object.hasOwn(server, sourceField) && (!sources || typeof sources !== 'object' || Array.isArray(sources))) throw new RootsError(`MCP server ${id} credential mappings must be objects.`);
    for (const [name, source] of Object.entries(sources || {})) {
      if (!variable.test(name) && server.type === 'stdio') throw new RootsError('MCP environment names must be valid variables.');
      if (server.type === 'http' && !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) throw new RootsError('Invalid MCP header name.');
      validateCredential(source, `MCP server ${id} credential`, { literal: !sensitive.test(name) });
      if (source.none) throw new RootsError('Omit an unused MCP environment/header mapping instead of using none.');
    }
  }
  return registry;
}
export const loadRegistry = home => validateRegistry(readJson(join(home, 'mcp.json'), { servers: {} }));
export const serversFor = (registry, profile) => Object.fromEntries(Object.entries(registry.servers).filter(([, server]) => !server.profiles || server.profiles.includes(profile)));
