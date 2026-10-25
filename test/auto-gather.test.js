import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOrchestrator, renderBrief } from '../src/orchestrator.js';
import { createSnapshotRegistry } from '../src/snapshots.js';
import { createStore } from '../src/store.js';
import { makeServer } from '../src/server.js';
import { offlineRole } from '../src/offline.js';

const sample = JSON.parse(await readFile(new URL('../sample/packet.json', import.meta.url), 'utf8'));

async function withApp(task, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'auto-gather-'));
  const store = createStore(dir);
  const snapshotRegistry = createSnapshotRegistry();
  try {
    return await task({ dir, store, snapshotRegistry, app: createOrchestrator(store, { snapshotRegistry, ...options }) });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function startedRun(app, input) {
  const created = await app.createRun(input);
  assert.equal(created.status, 'packet_review');
  return app.confirmPacket(created.id);
}

function pageFor(url, index, text) {
  const body = text ?? `Automatically gathered evidence number ${index} describes how a small team governs its research assistant.`;
  return {
    url, finalUrl: url, title: `Gathered page ${index}`, text: body,
    fetchedAt: '2026-10-24T00:00:00Z', sha256: createHash('sha256').update(body).digest('hex'),
    ok: true, error: null
  };
}

function fakeSearchClient({ results = 6, pages = null, failAllFetches = false } = {}) {
  const calls = { search: 0, fetch: 0 };
  const searchClient = {
    calls,
    async search() {
      calls.search += 1;
      return Array.from({ length: results }, (_, index) => ({
        title: `Result ${index + 1}`,
        url: `https://example.org/page-${index + 1}`,
        snippet: 'A candidate result'
      }));
    },
    async fetchPages(urls) {
      calls.fetch += 1;
      return urls.map((url, index) => {
        if (failAllFetches) return { url, finalUrl: url, title: '', text: '', fetchedAt: null, sha256: null, ok: false, error: 'timed out' };
        if (pages) return pages[index] ?? pageFor(url, index + 1);
        return pageFor(url, index + 1);
      });
    }
  };
  return searchClient;
}

async function liveRoleRunner(role, mode, payload) {
  if (role === 'planner') return { subquestions: ['Why?'], evidenceNeeds: [], approach: 'Inspect evidence', searchQueries: ['governance review'] };
  return offlineRole(role, payload);
}

test('TC-1 pasted sources reach the review pause and draft after confirm', async () => {
  await withApp(async ({ app }) => {
    const created = await app.createRun({ ...sample });
    assert.equal(created.status, 'packet_review');
    assert.equal(created.sources.length, 3);
    assert.ok(created.sources.every(source => source.suppliedBy === 'user'));
    const run = await app.confirmPacket(created.id);
    assert.equal(run.status, 'pending_approval');
    assert.ok(run.events.some(item => item.stage === 'PLAN'));
  }, { searchClient: fakeSearchClient({ results: 0 }), roleRunner: liveRoleRunner });
});

test('TC-2 zero user sources still gathers automatically via the sidecar', async () => {
  const sidecar = fakeSearchClient({ results: 6 });
  await withApp(async ({ app }) => {
    const created = await app.createRun({ question: 'How should a team govern AI?', sources: [] });
    assert.equal(created.status, 'packet_review');
    assert.ok(created.events.some(item => item.stage === 'GATHER'));
    assert.ok(created.sources.length > 0);
    assert.equal(sidecar.calls.search > 0, true);
    assert.equal(sidecar.calls.fetch, 1);
  }, { searchClient: sidecar, roleRunner: liveRoleRunner });
});

test('TC-3 live run with zero sources gathers deduped snapshots up to the 6-source cap and completes', async () => {
  const sidecar = fakeSearchClient({ results: 6 });
  await withApp(async ({ app }) => {
    const run = await startedRun(app, { question: 'How should a team govern AI?', sources: [] });
    assert.equal(run.status, 'pending_approval');
    assert.equal(run.autoGathered, true);
    assert.equal(run.sources.length, 6);
    assert.deepEqual(run.sources.map(source => source.id), ['S1', 'S2', 'S3', 'S4', 'S5', 'S6']);
    assert.equal(new Set(run.sources.map(source => source.url)).size, 6);
    assert.ok(run.sources.every(source => source.origin === 'fetched' && source.sha256));
    assert.ok(run.events.some(item => item.stage === 'GATHER'));
    assert.equal(sidecar.calls.fetch, 1);
  }, { searchClient: sidecar, roleRunner: liveRoleRunner });
});

test('TC-4 every fetch failing errors visibly; mixed results keep successes and log failures', async () => {
  const allFail = fakeSearchClient({ failAllFetches: true });
  await withApp(async ({ app }) => {
    const run = await app.createRun({ question: 'How should a team govern AI?', sources: [] });
    assert.equal(run.status, 'error');
    assert.match(run.error, /failed to fetch|no sources could be gathered/i);
    assert.ok(run.events.some(item => item.stage === 'GATHER' && /Fetch failed/.test(item.message)));
  }, { searchClient: allFail, roleRunner: liveRoleRunner });

  const mixedSidecar = {
    calls: { fetch: 0 },
    search: async () => Array.from({ length: 5 }, (_, index) => ({ title: `R${index}`, url: `https://example.org/mixed-${index}`, snippet: '' })),
    fetchPages: async urls => urls.map((url, index) => index < 2
      ? { url, finalUrl: url, title: '', text: '', fetchedAt: null, sha256: null, ok: false, error: 'HTTP 500' }
      : pageFor(url, index + 1))
  };
  await withApp(async ({ app }) => {
    const run = await startedRun(app, { question: 'How should a team govern AI?', sources: [] });
    assert.equal(run.status, 'pending_approval');
    assert.equal(run.sources.length, 3);
    assert.ok(run.events.some(item => /Fetch failed/.test(item.message)));
    assert.ok(run.events.some(item => item.stage === 'GATHER' && /Gathered 3 snapshots/.test(item.message)));
  }, { searchClient: mixedSidecar, roleRunner: liveRoleRunner });
});

test('TC-5 more than six pasted sources are still rejected', async () => {
  const sources = Array.from({ length: 7 }, (_, index) => ({
    title: `Source ${index + 1}`, url: `https://example.org/s${index + 1}`,
    excerpt: 'This excerpt is long enough to be a plausible research source for the brief.'
  }));
  await withApp(async ({ app }) => {
    await assert.rejects(app.createRun({ question: 'Too many sources?', sources }), /0–6 sources/);
  });
});

test('TC-6 renderBrief notes auto-gathered sources were not human-selected', async () => {
  const sidecar = fakeSearchClient({ results: 5 });
  await withApp(async ({ app }) => {
    const run = await startedRun(app, { question: 'How should a team govern AI?', sources: [] });
    const approved = await app.approveRun(run.id, 'Course reviewer');
    const brief = renderBrief(approved);
    assert.match(brief, /gathered automatically/i);
    assert.match(brief, /not selected by a human/i);
    assert.match(brief, /\(auto-gathered\)/);
  }, { searchClient: sidecar, roleRunner: liveRoleRunner });
});

test('TC-8 over-long planner queries are capped at 500 characters before search', async () => {
  const received = [];
  const sidecar = {
    async search(query) {
      received.push(query);
      return Array.from({ length: 6 }, (_, index) => ({
        title: `Result ${index + 1}`, url: `https://example.org/long-${index + 1}`, snippet: ''
      }));
    },
    async fetchPages(urls) {
      return urls.map((url, index) => pageFor(url, index + 1));
    }
  };
  const longRunner = async (role, mode, payload) => {
    if (role === 'planner') return { subquestions: ['Why?'], evidenceNeeds: [], approach: 'Inspect evidence', searchQueries: ['q'.repeat(620)] };
    return offlineRole(role, payload);
  };
  await withApp(async ({ app }) => {
    const run = await startedRun(app, { question: 'Is tomato purely a fruit?', sources: [] });
    assert.equal(run.status, 'pending_approval');
    assert.equal(received.length, 1);
    assert.equal(received[0].length, 500);
    assert.equal(run.sources.length, 6);
  }, { searchClient: sidecar, roleRunner: longRunner });
});

test('TC-9 candidate URLs are capped to the remaining packet budget before fetch', async () => {
  const fetchedUrls = [];
  const sidecar = {
    async search() {
      return Array.from({ length: 6 }, (_, index) => ({
        title: `Result ${index + 1}`, url: `https://example.org/wide-${index + 1}`, snippet: ''
      }));
    },
    async fetchPages(urls) {
      fetchedUrls.push(...urls);
      return urls.map((url, index) => pageFor(url, index + 1));
    }
  };
  const twoQueryRunner = async (role, mode, payload) => {
    if (role === 'planner') return { subquestions: ['Why?'], evidenceNeeds: [], approach: 'Inspect evidence', searchQueries: ['first query', 'second query'] };
    return offlineRole(role, payload);
  };
  await withApp(async ({ app }) => {
    const run = await startedRun(app, { question: 'Is tomato purely a fruit?', sources: [] });
    assert.equal(run.status, 'pending_approval');
    assert.equal(fetchedUrls.length, 6);
    assert.equal(new Set(fetchedUrls).size, 6);
    assert.equal(run.sources.length, 6);
  }, { searchClient: sidecar, roleRunner: twoQueryRunner });
});

test('TC-7 sample endpoint still returns the sample packet', async () => {
  const server = makeServer({
    orchestrator: createOrchestrator(createStore(await mkdtemp(join(tmpdir(), 'auto-gather-sample-')))),
    snapshotRegistry: createSnapshotRegistry()
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  try {
    const sampleResponse = await fetch(`${base}/api/sample`);
    assert.equal(sampleResponse.status, 200);
    assert.deepEqual(await sampleResponse.json(), sample);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
