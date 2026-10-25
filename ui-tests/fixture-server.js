import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeServer } from '../src/server.js';
import { createOrchestrator } from '../src/orchestrator.js';
import { createStore } from '../src/store.js';
import { createSnapshotRegistry } from '../src/snapshots.js';
import { offlineRole } from '../src/offline.js';

// Controlled replacements for external services. Production still uses live-only roles and search.
const snapshots = createSnapshotRegistry();
const store = createStore(process.env.DATA_DIR ?? join(tmpdir(), 'sip-ui-playwright-runs'));
const page = (url, index) => {
  const text = `Gathered source ${index} describes evidence and human review for a research brief.`;
  return {
    url, finalUrl: url, title: `Gathered source ${index}`, text,
    fetchedAt: '2026-10-24T00:00:00.000Z',
    sha256: createHash('sha256').update(text).digest('hex'), ok: true, error: null
  };
};
const searchClient = {
  async search(query) {
    if (query.includes('[NO RESULTS]')) return [];
    return Array.from({ length: 6 }, (_, i) => ({ title: `Candidate ${i + 1}`, url: `https://example.org/gathered-${i + 1}`, snippet: 'Controlled result' }));
  },
  async fetchPages(urls) {
    return urls.map((url, i) => url.includes('fail')
      ? { url, finalUrl: url, ok: false, error: 'Controlled extraction failure' }
      : page(url, i + 1));
  }
};
const roleRunner = async (role, mode, payload) => {
  if (mode !== 'live') throw new Error('Live mode required.');
  if (role === 'planner') return { ...offlineRole(role, payload), searchQueries: [payload.question] };
  if (role === 'researcher' && payload.question.includes('[FAIL MODEL]')) throw new Error('Controlled live model failure.');
  if (role === 'reviewer') return { ...offlineRole(role, payload), note: 'Controlled reviewer checks lexical support only; a human must assess meaning.' };
  return offlineRole(role, payload);
};
const app = createOrchestrator(store, { snapshotRegistry: snapshots, searchClient, roleRunner });
makeServer({ orchestrator: app, snapshotRegistry: snapshots }).listen(3100, '127.0.0.1');
