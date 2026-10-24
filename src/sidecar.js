export function createSidecarClient(options = {}) {
  const base = options.baseUrl ?? process.env.SIDECAR_BASE_URL ?? 'http://127.0.0.1:8001';
  const parsed = new URL(base);
  if (parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(parsed.hostname)) {
    throw new Error('The sidecar URL must use local HTTP.');
  }
  const fetcher = options.fetcher ?? fetch;

  async function post(path, body) {
    let response;
    try {
      response = await fetcher(new URL(path, parsed).toString(), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(path === '/fetch' ? 120000 : 35000)
      });
    } catch {
      throw new Error('Sidecar unavailable. Start the Python sidecar, or paste sources manually.');
    }
    let data;
    try { data = await response.json(); }
    catch { throw new Error('Sidecar returned an invalid response.'); }
    if (!response.ok) {
      const detail = typeof data?.detail === 'string' ? data.detail : `HTTP ${response.status}`;
      throw new Error(`Sidecar error: ${detail}`);
    }
    if (!Array.isArray(data)) throw new Error('Sidecar returned an invalid result list.');
    return data;
  }

  return {
    search: (query, maxResults = 6) => post('/search', { query, max_results: maxResults }),
    fetchPages: urls => post('/fetch', { urls })
  };
}
