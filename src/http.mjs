import { RootsError } from './config.mjs';

export async function requestText(url, { key, body, fetcher = fetch, limit = 4 * 1024 * 1024, headers = {} } = {}) {
  let response;
  try {
    response = await fetcher(url, { method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(30_000),
      headers: { ...headers, ...(key ? { Authorization: `Bearer ${key}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
  } catch { throw new RootsError('HTTP request failed or timed out; request details omitted.'); }
  if (response.status === 304) return { status: 304, text: '', etag: response.headers.get('etag') };
  if (!response.ok) throw new RootsError(`HTTP request returned status ${response.status}; response body omitted.`);
  let size = 0;
  const chunks = [];
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) throw new RootsError('HTTP response exceeded the configured size limit.');
    chunks.push(chunk);
  }
  return { status: response.status, text: Buffer.concat(chunks).toString('utf8'), etag: response.headers.get('etag') };
}
export async function requestJson(url, options) {
  const response = await requestText(url, options);
  try { return JSON.parse(response.text); } catch { throw new RootsError('HTTP response was not valid JSON; body omitted.'); }
}
