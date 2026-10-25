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
  const dir = await mkdtemp(join(tmpdir(), 'aggregate-review-'));
  const store = createStore(dir);
  const snapshotRegistry = createSnapshotRegistry();
  try {
    return await task({ dir, store, snapshotRegistry, app: createOrchestrator(store, { snapshotRegistry, ...options }) });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function pageFor(url, index, text) {
  const body = text ?? `Automatically gathered evidence number ${index} describes how a small team governs its research assistant.`;
  return {
    url, finalUrl: url, title: `Gathered page ${index}`, text: body,
    fetchedAt: '2026-10-24T00:00:00Z', sha256: createHash('sha256').update(body).digest('hex'),
    ok: true, error: null
  };
}

function fakeSearchClient({ results = 6, pages = null, failAllFetches = false, failUrls = [] } = {}) {
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
        if (failUrls.includes(url)) return { url, finalUrl: url, title: '', text: '', fetchedAt: null, sha256: null, ok: false, error: 'HTTP 500' };
        if (pages) return pages[index] ?? pageFor(url, index + 1);
        return pageFor(url, index + 1);
      });
    }
  };
  return searchClient;
}

function recordingRoleRunner(calls) {
  return async (role, mode, payload) => {
    calls.push({ role, mode });
    if (role === 'planner') return { subquestions: ['Why?'], evidenceNeeds: [], approach: 'Inspect evidence', searchQueries: ['governance review'] };
    return offlineRole(role, payload);
  };
}

function excerptSource(index) {
  return {
    title: `Pasted source ${index}`,
    url: `https://example.org/pasted-${index}`,
    excerpt: `Pasted evidence number ${index}: a small team governs its research assistant with recorded approvals.`
  };
}

function linkSource(url) {
  return { title: `User link ${url}`, url };
}

test('TC-1 modeless run is live: roles called live, packet_review pause, then pending_approval after confirm', async () => {
  const sidecar = fakeSearchClient({ results: 3 });
  const roleCalls = [];
  await withApp(async ({ app }) => {
    const run = await app.createRun({ question: 'How should a team govern AI?', sources: [] });
    assert.equal(run.mode, 'live');
    assert.equal(run.status, 'packet_review');
    assert.equal(run.draft, null);
    assert.ok(run.events.some(item => item.stage === 'GATHER'));
    const before = roleCalls.length;
    const confirmed = await app.confirmPacket(run.id, 'Course reviewer');
    assert.equal(confirmed.status, 'pending_approval');
    assert.ok(confirmed.draft);
    assert.equal(sidecar.calls.search > 0, true);
    assert.ok(roleCalls.slice(before).some(item => item.role === 'planner'));
    assert.ok(roleCalls.slice(before).some(item => item.role === 'researcher'));
    assert.ok(roleCalls.slice(before).some(item => item.role === 'reviewer'));
  }, { searchClient: sidecar, roleRunner: recordingRoleRunner(roleCalls) });
  assert.ok(roleCalls.length > 0);
  assert.ok(roleCalls.every(item => item.mode === 'live'));
});

test('TC-2 mode offline is rejected with Live mode required', async () => {
  await withApp(async ({ app }) => {
    await assert.rejects(
      app.createRun({ question: 'How should a team govern AI?', sources: [], mode: 'offline' }),
      /Live mode required/i
    );
  });
});

test('TC-3 bare user link becomes a fetched snapshot marked user-supplied at packet_review', async () => {
  const sidecar = fakeSearchClient({ results: 0 });
  await withApp(async ({ app }) => {
    const run = await app.createRun({
      question: 'How should a team govern AI?',
      sources: [excerptSource(1), linkSource('https://example.org/user-link')]
    });
    assert.equal(run.status, 'packet_review');
    const link = run.sources.find(source => source.url === 'https://example.org/user-link');
    assert.ok(link);
    assert.equal(link.origin, 'fetched');
    assert.equal(link.suppliedBy, 'user');
    assert.ok(link.sha256);
    assert.ok(link.fetchedAt);
    const pasted = run.sources.find(source => source.title === 'Pasted source 1');
    assert.equal(pasted.suppliedBy, 'user');
    assert.equal(pasted.origin, 'pasted');
    assert.equal(sidecar.calls.fetch >= 1, true);
  }, { searchClient: sidecar, roleRunner: recordingRoleRunner([]) });
});
test('TC-4 gather dedupes against user URLs and caps packet at 6 total', async () => {
  const userUrls = ['https://example.org/page-1', 'https://example.org/page-2', 'https://example.org/user-a', 'https://example.org/user-b'];
  const sidecar = fakeSearchClient({ results: 6 });
  await withApp(async ({ app }) => {
    const run = await app.createRun({
      question: 'How should a team govern AI?',
      sources: userUrls.map(url => linkSource(url))
    });
    assert.equal(run.status, 'packet_review');
    const gathered = run.sources.filter(source => source.suppliedBy === 'agent');
    assert.equal(gathered.length, 2);
    assert.ok(gathered.every(source => source.origin === 'fetched' && source.fetchedAt && source.sha256));
    assert.equal(run.sources.length, 6);
    assert.equal(new Set(run.sources.map(source => source.url)).size, 6);
    assert.equal(sidecar.calls.fetch, 1);
    const gatheredUrls = new Set(run.sources.filter(source => source.suppliedBy === 'agent').map(source => source.url));
    for (const url of ['https://example.org/page-1', 'https://example.org/page-2']) {
      assert.equal(gatheredUrls.has(url), false, `user URL ${url} must not be re-fetched as an agent candidate`);
    }
  }, { searchClient: sidecar, roleRunner: recordingRoleRunner([]) });
});

test('TC-5 removeSource deletes a gathered snapshot with an event; user-supplied removal is rejected', async () => {
  const sidecar = fakeSearchClient({ results: 2 });
  await withApp(async ({ app }) => {
    const run = await app.createRun({ question: 'How should a team govern AI?', sources: [excerptSource(1)] });
    assert.equal(run.status, 'packet_review');
    const userSource = run.sources.find(source => source.suppliedBy === 'user');
    const gatheredId = run.sources.find(source => source.suppliedBy === 'agent').id;
    const removed = await app.removeSource(run.id, gatheredId);
    assert.ok(!removed.sources.some(source => source.id === gatheredId));
    assert.ok(removed.events.some(item => item.stage === 'PACKET' && item.message.includes(gatheredId)));
    await assert.rejects(
      app.removeSource(run.id, userSource.id),
      /cannot|user-supplied|only/i
    );
  }, { searchClient: sidecar, roleRunner: recordingRoleRunner([]) });
});

test('TC-6 empty packet after removals ends in a visible error; confirm with sources drafts normally', async () => {
  const sidecar = fakeSearchClient({ results: 1 });
  await withApp(async ({ app }) => {
    const run = await app.createRun({ question: 'How should a team govern AI?', sources: [] });
    for (const source of [...run.sources]) await app.removeSource(run.id, source.id);
    await assert.rejects(app.confirmPacket(run.id, 'Course reviewer'), /at least one source/i);
    assert.equal((await app.getRun(run.id)).status, 'error');
  }, { searchClient: sidecar, roleRunner: recordingRoleRunner([]) });

  await withApp(async ({ app }) => {
    const run = await app.createRun({ question: 'How should a team govern AI?', sources: [] });
    const confirmed = await app.confirmPacket(run.id, 'Course reviewer');
    assert.equal(confirmed.status, 'pending_approval');
  }, { searchClient: sidecar, roleRunner: recordingRoleRunner([]) });
});

test('TC-7 sidecar unreachable or all-failing gather ends the run in error with a named reason', async () => {
  const unreachable = {
    search: async () => { throw new Error('Sidecar unavailable. Start the Python sidecar.'); },
    fetchPages: async () => { throw new Error('Sidecar unavailable. Start the Python sidecar.'); }
  };
  await withApp(async ({ app }) => {
    const run = await app.createRun({ question: 'How should a team govern AI?', sources: [] });
    assert.equal(run.status, 'error');
    assert.match(run.error, /Sidecar unavailable/i);
    assert.equal(run.sources.length, 0);
  }, { searchClient: unreachable, roleRunner: recordingRoleRunner([]) });

  const allFail = fakeSearchClient({ failAllFetches: true });
  await withApp(async ({ app }) => {
    const run = await app.createRun({ question: 'How should a team govern AI?', sources: [] });
    assert.equal(run.status, 'error');
    assert.match(run.error, /failed to fetch|no sources could be gathered/i);
  }, { searchClient: allFail, roleRunner: recordingRoleRunner([]) });
});

test('TC-8 confirm drafts from persisted snapshot text without the registry', async () => {
  const sidecar = fakeSearchClient({ results: 2 });
  await withApp(async ({ app }) => {
    const run = await app.createRun({ question: 'How should a team govern AI?', sources: [] });
    assert.equal(run.status, 'packet_review');
    const confirmed = await app.confirmPacket(run.id, 'Course reviewer');
    assert.equal(confirmed.status, 'pending_approval');
    assert.ok(confirmed.review.passed);
  }, { searchClient: sidecar, roleRunner: recordingRoleRunner([]) });
});

test('TC-9 revision reuses the confirmed packet: no new search, no re-gather, no second review pause', async () => {
  const sidecar = fakeSearchClient({ results: 3 });
  await withApp(async ({ app }) => {
    const run = await app.createRun({ question: 'How should a team govern AI?', sources: [] });
    assert.equal(run.status, 'packet_review');
    const firstDraft = await app.confirmPacket(run.id, 'Course reviewer');
    assert.equal(firstDraft.status, 'pending_approval');
    const sourceIds = firstDraft.sources.map(source => source.id);
    const searchesBefore = sidecar.calls.search;
    const fetchesBefore = sidecar.calls.fetch;
    const revised = await app.reviseRun(run.id, 'Course reviewer', 'Make the limitations clearer.');
    assert.equal(revised.status, 'pending_approval');
    assert.deepEqual(revised.sources.map(source => source.id), sourceIds);
    assert.equal(sidecar.calls.search, searchesBefore);
    assert.equal(sidecar.calls.fetch, fetchesBefore);
    assert.ok(!revised.events.some(item => item.stage === 'PACKET' && /review/i.test(item.message) && item.at > firstDraft.events.at(-1).at));
  }, { searchClient: sidecar, roleRunner: recordingRoleRunner([]) });
});

test('TC-10 exported brief labels agent and user provenance separately', async () => {
  const sidecar = fakeSearchClient({ results: 2 });
  await withApp(async ({ app }) => {
    const run = await app.createRun({
      question: 'How should a team govern AI?',
      sources: [excerptSource(1), linkSource('https://example.org/user-link')]
    });
    const approved = await app.approveRun((await app.confirmPacket(run.id, 'Course reviewer')).id, 'Course reviewer');
    const brief = renderBrief(approved);
    assert.match(brief, /not selected by a human/i);
    assert.match(brief, /\(auto-gathered\)/);
    assert.match(brief, /user-supplied/);
  }, { searchClient: sidecar, roleRunner: recordingRoleRunner([]) });
});

test('TC-11 sample packet loads as user-supplied sources and agent still gathers', async () => {
  const server = makeServer({
    orchestrator: createOrchestrator(
      createStore(await mkdtemp(join(tmpdir(), 'aggregate-review-sample-'))),
      { searchClient: fakeSearchClient({ results: 2 }), roleRunner: recordingRoleRunner([]), snapshotRegistry: createSnapshotRegistry() }
    ),
    snapshotRegistry: createSnapshotRegistry()
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  try {
    const sampleResponse = await fetch(`${base}/api/sample`);
    assert.equal(sampleResponse.status, 200);
    const packet = await sampleResponse.json();
    const createResponse = await fetch(`${base}/api/runs`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: packet.question, sources: packet.sources })
    });
    assert.equal(createResponse.status, 201);
    const run = await createResponse.json();
    assert.equal(run.status, 'packet_review');
    assert.equal(run.sources.length, sample.sources.length + 2);
    assert.ok(run.sources.slice(0, sample.sources.length).every(source => source.suppliedBy === 'user'));
    assert.ok(run.sources.slice(sample.sources.length).every(source => source.suppliedBy === 'agent'));
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('TC-12 removed search and fetch routes return 404', async () => {
  const server = makeServer({
    orchestrator: createOrchestrator(createStore(await mkdtemp(join(tmpdir(), 'aggregate-review-routes-')))),
    sidecarClient: { search: async () => [], fetchPages: async () => [] },
    snapshotRegistry: createSnapshotRegistry()
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  try {
    for (const path of ['/api/search', '/api/fetch']) {
      const response = await fetch(`${base}${path}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: 'x', urls: ['https://example.org'] })
      });
      assert.equal(response.status, 404, `${path} must be gone`);
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('TC-13 failed user bare link is visible, contributes no source; all-lost packet errors', async () => {
  const sidecar = fakeSearchClient({ results: 2, failUrls: ['https://example.org/user-broken'] });
  await withApp(async ({ app }) => {
    const run = await app.createRun({
      question: 'How should a team govern AI?',
      sources: [excerptSource(1), linkSource('https://example.org/user-broken')]
    });
    assert.equal(run.status, 'packet_review');
    assert.ok(!run.sources.some(source => source.url === 'https://example.org/user-broken'));
    assert.ok(run.events.some(item => item.stage === 'PACKET' && /failed/i.test(item.message) && item.message.includes('user-broken')));
    assert.equal(run.sources.length, 3);
  }, { searchClient: sidecar, roleRunner: recordingRoleRunner([]) });

  const noResults = fakeSearchClient({ results: 0, failUrls: ['https://example.org/user-broken'] });
  await withApp(async ({ app }) => {
    const run = await app.createRun({
      question: 'How should a team govern AI?',
      sources: [linkSource('https://example.org/user-broken')]
    });
    assert.equal(run.status, 'error');
    assert.match(run.error, /at least one source|no sources could be gathered/i);
  }, { searchClient: noResults, roleRunner: recordingRoleRunner([]) });
});

test('TC-14 more than six user sources are rejected', async () => {
  const sources = Array.from({ length: 7 }, (_, index) => excerptSource(index + 1));
  await withApp(async ({ app }) => {
    await assert.rejects(app.createRun({ question: 'Too many sources?', sources }), /0–6 sources/);
  });
});

test('TC-15 fetched source with mismatching SHA-256 is rejected at creation', async () => {
  const excerpt = 'A fetched snapshot whose stored hash does not match its text must be rejected outright.';
  await withApp(async ({ app }) => {
    await assert.rejects(
      app.createRun({
        question: 'How should a team govern AI?',
        sources: [{
          title: 'Tampered snapshot', url: 'https://example.org/tampered', excerpt,
          origin: 'fetched', requestedUrl: 'https://example.org/tampered',
          fetchedAt: '2026-10-24T00:00:00Z', sha256: '0'.repeat(64)
        }]
      }),
      /invalid fetched snapshot metadata/
    );
  });
});
