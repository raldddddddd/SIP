import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from './store.js';
import { createOrchestrator, renderBrief } from './orchestrator.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const store = createStore(process.env.DATA_DIR ?? join(root, '.data', 'runs'));
const app = createOrchestrator(store);
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

export function makeServer() {
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
      if (req.method === 'POST' && pathname === '/api/runs') {
        const run = await app.createRun(await readBody(req));
        return send(res, run.status === 'error' ? 502 : 201, run);
      }
      const match = pathname.match(/^\/api\/runs\/([a-f0-9-]{36})(?:\/(approve|revise|export))?$/);
      if (match) {
        const [, id, action] = match;
        if (req.method === 'GET' && !action) return send(res, 200, await app.getRun(id));
        if (req.method === 'POST' && action === 'approve') {
          const { reviewer } = await readBody(req);
          return send(res, 200, await app.approveRun(id, reviewer));
        }
        if (req.method === 'POST' && action === 'revise') {
          const { reviewer, feedback } = await readBody(req);
          const run = await app.reviseRun(id, reviewer, feedback);
          return send(res, run.status === 'error' ? 502 : 200, run);
        }
        if (req.method === 'GET' && action === 'export') {
          const brief = renderBrief(await app.getRun(id));
          res.setHeader('content-disposition', `attachment; filename="research-brief-${id}.md"`);
          return send(res, 200, brief, 'text/markdown; charset=utf-8');
        }
      }
      return send(res, 404, { error: 'Not found.' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected error.';
      const status = message === 'Run not found.' ? 404 : /requires human approval|Approval is blocked|cannot be revised/.test(message) ? 409 : 400;
      return send(res, status, { error: message });
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  makeServer().listen(port, host, () => {
    process.stdout.write(`Governed Research Brief Assistant: http://${host}:${port}\n`);
  });
}
