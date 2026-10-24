import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from './store.js';
import { createOrchestrator, renderBrief } from './orchestrator.js';
import { createSidecarClient } from './sidecar.js';
import { createSnapshotRegistry } from './snapshots.js';
import { runRole } from './model.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const store = createStore(process.env.DATA_DIR ?? join(root, '.data', 'runs'));
const app = createOrchestrator(store);
const sidecar = createSidecarClient();
const snapshots = createSnapshotRegistry();
const port = Number(process.env.PORT ?? 3000);
const host = '127.0.0.1';

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 100_000) throw new Error('Request is too large.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('Request body must be JSON.'); }
}

const staticFiles = {
  '/': ['public/index.html', 'text/html; charset=utf-8'],
  '/app.js': ['public/app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['public/style.css', 'text/css; charset=utf-8']
};

export function makeServer(options = {}) {
  const workflow = options.orchestrator ?? app;
  const searchSidecar = options.sidecarClient ?? sidecar;
  const snapshotRegistry = options.snapshotRegistry ?? snapshots;
  const planner = options.planner ?? runRole;
  return createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, `http://${host}`).pathname;
      if (req.method === 'GET' && staticFiles[pathname]) {
        const [path, type] = staticFiles[pathname];
        return send(res, 200, await readFile(join(root, path), 'utf8'), type);
      }
      if (req.method === 'GET' && pathname === '/api/sample') {
        return send(res, 200, JSON.parse(await readFile(join(root, 'sample', 'packet.json'), 'utf8')));
      }
      if (req.method === 'POST' && pathname === '/api/search') {
        const { query, mode = 'offline', maxResults = 6 } = await readBody(req);
        if (typeof query !== 'string' || !query.trim() || query.length > 500) throw new Error('Search query must be 1–500 characters.');
        if (!['offline', 'live'].includes(mode)) throw new Error('Choose offline or live mode.');
        if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 10) throw new Error('Choose 1–10 search results.');
        const plan = await planner('planner', mode, { question: query.trim(), sources: [], revision: 0 });
        const queries = (plan.searchQueries ?? []).map(value => String(value).trim()).filter(Boolean).slice(0, 2);
        if (!queries.length) throw new Error('Planner returned no search queries.');
        const batches = [];
        for (const searchQuery of queries) batches.push(await searchSidecar.search(searchQuery, maxResults));
        const seen = new Set();
        const results = batches.flat().filter(item => {
          if (!item?.url || seen.has(item.url)) return false;
          seen.add(item.url); return true;
        }).slice(0, 10);
        return send(res, 200, { plan, queries, results });
      }
      if (req.method === 'POST' && pathname === '/api/fetch') {
        const { urls } = await readBody(req);
        if (!Array.isArray(urls) || urls.length < 1 || urls.length > 8 || urls.some(url => typeof url !== 'string' || url.length > 2048)) {
          throw new Error('Select 1–8 valid result URLs.');
        }
        const pages = await searchSidecar.fetchPages(urls);
        return send(res, 200, pages.map(page => page.ok ? { ...snapshotRegistry.register(page), ok: true, error: null } : page));
      }
      if (req.method === 'POST' && pathname === '/api/runs') {
        const input = await readBody(req);
        input.sources = snapshotRegistry.materialize(input.sources);
        const run = await workflow.createRun(input);
        return send(res, run.status === 'error' ? 502 : 201, run);
      }
      const match = pathname.match(/^\/api\/runs\/([a-f0-9-]{36})(?:\/(approve|revise|export))?$/);
      if (match) {
        const [, id, action] = match;
        if (req.method === 'GET' && !action) return send(res, 200, await workflow.getRun(id));
        if (req.method === 'POST' && action === 'approve') {
          const { reviewer } = await readBody(req);
          return send(res, 200, await workflow.approveRun(id, reviewer));
        }
        if (req.method === 'POST' && action === 'revise') {
          const { reviewer, feedback } = await readBody(req);
          const run = await workflow.reviseRun(id, reviewer, feedback);
          return send(res, run.status === 'error' ? 502 : 200, run);
        }
        if (req.method === 'GET' && action === 'export') {
          const brief = renderBrief(await workflow.getRun(id));
          res.setHeader('content-disposition', `attachment; filename="research-brief-${id}.md"`);
          return send(res, 200, brief, 'text/markdown; charset=utf-8');
        }
      }
      return send(res, 404, { error: 'Not found.' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected error.';
      const status = message === 'Run not found.' ? 404 : /requires human approval|Approval is blocked|cannot be revised|snapshot expired/.test(message) ? 409 : /Sidecar|Search unavailable/.test(message) ? 502 : 400;
      return send(res, status, { error: message });
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  makeServer().listen(port, host, () => {
    process.stdout.write(`Governed Research Brief Assistant: http://${host}:${port}\n`);
  });
}
