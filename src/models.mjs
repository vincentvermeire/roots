import { join } from 'node:path';
import { jsonText, readJson, RootsError, writeAtomic } from './config.mjs';
import { resolveCredential } from './credentials.mjs';
import { requestJson } from './http.mjs';

export async function discoverModels(context, { fetcher = fetch, env = process.env, write = true } = {}) {
  const key = resolveCredential(context.selected.credential, env);
  const data = await requestJson(`${context.gateway.openaiBaseUrl.replace(/\/+$/, '')}/models`, { key, fetcher });
  if (!Array.isArray(data.data)) throw new RootsError('Model endpoint must return an OpenAI-compatible data array.');
  const ids = [...new Set(data.data.filter(model => typeof model.id === 'string').map(model => model.id))].sort();
  const file = join(context.runtime, 'models.json'), previous = readJson(file, { ids: [] });
  const result = { ids, added: ids.filter(id => !previous.ids.includes(id)), removed: previous.ids.filter(id => !ids.includes(id)), checkedAt: new Date().toISOString() };
  if (write) writeAtomic(file, jsonText({ ids, checkedAt: result.checkedAt }), { root: context.home });
  return result;
}
