import { randomUUID, createHash } from 'node:crypto';
import { checkDraft, normalizeInput } from './guardrails.js';
import { runRole } from './model.js';

const now = () => new Date().toISOString();
const locks = new Map();

async function withLock(id, task) {
  const previous = locks.get(id) ?? Promise.resolve();
  let release;
  const current = new Promise(resolve => { release = resolve; });
  locks.set(id, current);
  await previous;
  try { return await task(); }
  finally {
    release();
    if (locks.get(id) === current) locks.delete(id);
  }
}

function event(run, stage, message, extra = {}) {
  run.events.push({ at: now(), stage, message, ...extra });
  run.updatedAt = now();
}

function verifyFetchedSource(source, index) {
  const hash = createHash('sha256').update(source.excerpt).digest('hex');
  if (hash !== source.sha256 || !Number.isFinite(Date.parse(source.fetchedAt))) {
    throw new Error(`Source ${index + 1}: snapshot text does not match its recorded provenance.`);
  }
  try {
    const original = new URL(source.requestedUrl ?? '');
    if (!['http:', 'https:'].includes(original.protocol)) throw new Error();
  } catch { throw new Error(`Source ${index + 1}: invalid original URL.`); }
}

function verifyPacket(run) {
  if (!run.sources.length) throw new Error('Confirm at least one source before drafting.');
  run.sources.forEach((source, index) => {
    if (source.origin === 'fetched') verifyFetchedSource(source, index);
    else if (!source.excerpt) throw new Error(`Source ${index + 1}: the excerpt text is missing.`);
  });
}

export function renderBrief(run) {
  if (run.status !== 'approved') throw new Error('Final output requires human approval.');
  const autoGathered = run.sources.filter(source => source.suppliedBy === 'agent');
  const lines = [
    `# Research brief: ${run.question}`,
    '',
    `Approved by ${run.approval.reviewer} on ${run.approval.at}.`,
    '',
    '## Summary', '', run.draft.summary, '',
    '## Findings', ''
  ];
  for (const finding of run.draft.findings) lines.push(`- ${finding.claim} [${finding.sourceId}]`);
  lines.push('', '## Limitations', '');
  for (const limitation of run.draft.limitations) lines.push(`- ${limitation}`);
  lines.push('- Supplied source excerpts and metadata were not independently authenticated.', '');
  if (autoGathered.length) {
    lines.push('- Sources were gathered automatically from web search and were not selected by a human.', '');
  }
  lines.push('## Supplied sources', '');
  for (const source of run.sources) {
    const title = source.title.replace(/[\[\]]/g, '');
    if (source.suppliedBy === 'agent') {
      lines.push(`- [${source.id}] ${title} — ${source.url}; fetched ${source.fetchedAt}; SHA-256 ${source.sha256} (auto-gathered)`);
    } else if (source.origin === 'fetched') {
      lines.push(`- [${source.id}] ${title} — ${source.url}; fetched ${source.fetchedAt}; SHA-256 ${source.sha256} (user-supplied)`);
    } else {
      lines.push(`- [${source.id}] ${title} — ${source.url}; user-pasted excerpt (user-supplied)`);
    }
  }
  return lines.join('\n');
}

export function createOrchestrator(store, options = {}) {
  const roleRunner = options.roleRunner ?? ((role, mode, payload) => runRole(role, mode, payload, options));
  const searchClient = options.searchClient ?? null;
  const snapshotRegistry = options.snapshotRegistry ?? null;

  async function gatherSources(run, linkSources = []) {
    if (!searchClient || !snapshotRegistry) {
      throw new Error('Automatic source gathering is unavailable. Check the local search sidecar.');
    }
    const queryPlan = await roleRunner('planner', run.mode, { question: run.question, sources: run.sources, feedback: '', revision: run.revision });
    const queries = (queryPlan.searchQueries ?? [])
      .map(value => String(value).trim().slice(0, 500))
      .filter(Boolean)
      .slice(0, 2);
    if (!queries.length) throw new Error('The planner returned no search queries, so no sources could be gathered.');
    event(run, 'GATHER', `Searching the web: ${queries.join(' · ')}`);
    await store.save(run);
    const linkUrls = new Set(linkSources.map(source => source.url));
    const userUrls = new Set([...run.sources.map(source => source.url), ...linkUrls]);
    const batches = [];
    for (const query of queries) batches.push(await searchClient.search(query, 6));
    const seen = new Set(userUrls);
    const candidates = batches.flat().filter(item => {
      if (!item?.url || seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    });
    if (!candidates.length && !linkSources.length) {
      if (!run.sources.length) throw new Error('Search returned no usable results, so no sources could be gathered.');
      event(run, 'GATHER', 'Search returned no usable results; keeping the user-supplied packet.');
      return;
    }
    const budget = Math.max(0, 6 - run.sources.length - linkSources.length);
    const candidateUrls = candidates.map(item => item.url).slice(0, budget);
    const toFetch = [...linkSources.map(source => source.url), ...candidateUrls];
    if (!toFetch.length) {
      event(run, 'GATHER', 'The packet already holds the maximum number of sources; keeping the user-supplied packet.');
      await store.save(run);
      return;
    }
    event(run, 'GATHER', `Fetching ${linkSources.length ? `${linkSources.length} user link${linkSources.length === 1 ? '' : 's'} and ` : ''}the top ${candidateUrls.length} candidate pages.`);
    await store.save(run);
    const pages = await searchClient.fetchPages(toFetch);
    const pageByUrl = new Map(pages.map(page => [page.url, page]));
    for (const page of pages) {
      if (page.ok) continue;
      if (linkUrls.has(page.url)) event(run, 'PACKET', `User link failed to fetch: ${page.url}: ${page.error}`);
      else event(run, 'GATHER', `Fetch failed: ${page.url}: ${page.error}`);
    }
    for (const source of linkSources) {
      const page = pageByUrl.get(source.url);
      if (!page?.ok) continue;
      const snapshot = snapshotRegistry.register(page);
      run.sources.push({
        id: `S${run.sources.length + 1}`, title: source.title === source.url ? snapshot.title : source.title,
        url: snapshot.url, excerpt: snapshot.excerpt, origin: 'fetched', suppliedBy: 'user',
        requestedUrl: snapshot.requestedUrl, fetchedAt: snapshot.fetchedAt, sha256: snapshot.sha256
      });
      event(run, 'PACKET', `Fetched user link: ${snapshot.url}`);
    }
    const fetched = pages.filter(page => page.ok && !linkUrls.has(page.url));
    if (!fetched.length && !run.sources.length) {
      throw new Error('Every candidate page failed to fetch, so no sources could be gathered.');
    }
    if (!fetched.length) {
      event(run, 'GATHER', 'No new candidates were fetched; keeping the user-supplied packet.');
      await store.save(run);
      return;
    }
    const remaining = Math.max(0, 6 - run.sources.length);
    const snapshots = fetched.slice(0, remaining).map(page => snapshotRegistry.register(page));
    for (const snapshot of snapshots) {
      run.sources.push({
        id: `S${run.sources.length + 1}`, title: snapshot.title, url: snapshot.url, excerpt: snapshot.excerpt,
        origin: 'fetched', suppliedBy: 'agent', requestedUrl: snapshot.requestedUrl, fetchedAt: snapshot.fetchedAt, sha256: snapshot.sha256
      });
    }
    run.autoGathered = true;
    event(run, 'GATHER', `Gathered ${snapshots.length} snapshot${snapshots.length === 1 ? '' : 's'} automatically; not human-selected.`);
    await store.save(run);
  }

  async function buildPacket(run) {
    run.status = 'gathering';
    run.sources.forEach(source => { source.suppliedBy ??= 'user'; });
    const linkSources = run.sources.filter(source => source.origin === 'link');
    run.sources = run.sources.filter(source => source.origin !== 'link');
    if (!searchClient || !snapshotRegistry) {
      if (linkSources.length || !run.sources.length) {
        throw new Error('Automatic source gathering is unavailable. Check the local search sidecar.');
      }
    } else {
      await gatherSources(run, linkSources);
    }
    run.sources.forEach((source, index) => { source.suppliedBy ??= 'user'; source.id = `S${index + 1}`; });
    run.status = 'packet_review';
    event(run, 'PACKET', `Packet ready for review: ${run.sources.length} source${run.sources.length === 1 ? '' : 's'}. Remove auto-gathered snapshots you do not trust, then confirm to draft.`);
    await store.save(run);
  }

  async function draftStage(run, feedback = '') {
    try {
      if (!run.sources.length) {
        throw new Error('At least one source is required. Keep a gathered snapshot or supply your own before drafting.');
      }
      run.status = 'planning';
      event(run, 'PLAN', 'Planner started.', { role: 'planner', skill: 'skills/planner/SKILL.md' });
      await store.save(run);
      run.plan = await roleRunner('planner', run.mode, { question: run.question, sources: run.sources, feedback, revision: run.revision });
      event(run, 'ORCHESTRATE', 'Planner completed; Researcher selected.');
      run.status = 'executing';
      await store.save(run);
      run.draft = await roleRunner('researcher', run.mode, { question: run.question, sources: run.sources, plan: run.plan, feedback, revision: run.revision });
      event(run, 'EXECUTE', 'Researcher produced a pending draft.', { role: 'researcher', skill: 'skills/researcher/SKILL.md' });
      run.status = 'checking';
      await store.save(run);
      const deterministic = checkDraft(run.draft, run.sources);
      const reviewer = await roleRunner('reviewer', run.mode, { question: run.question, sources: run.sources, draft: run.draft, deterministic, revision: run.revision });
      const reviewerIssues = Array.isArray(reviewer?.issues) ? reviewer.issues : [{ type: 'invalid_review', message: 'Reviewer returned no valid issue list.' }];
      run.review = {
        passed: deterministic.passed && reviewer?.passed === true && reviewerIssues.length === 0,
        issues: [...deterministic.issues, ...reviewerIssues],
        note: String(reviewer?.note ?? ''),
        deterministicPassed: deterministic.passed,
        reviewerPassed: reviewer?.passed === true
      };
      run.status = run.review.passed ? 'pending_approval' : 'check_failed';
      event(run, 'CHECK', run.review.passed ? 'Checks passed; human approval required.' : 'Checks failed; release blocked.', { role: 'reviewer', skill: 'skills/reviewer/SKILL.md', passed: run.review.passed });
      await store.save(run);
    } catch (error) {
      run.status = 'error';
      run.error = error instanceof Error ? error.message : 'Unknown workflow error.';
      event(run, 'ERROR', run.error);
      await store.save(run);
    }
    return run;
  }

  async function createRun(input) {
    const normalized = normalizeInput(input);
    const run = {
      id: randomUUID(), ...normalized, revision: 0, status: 'created',
      createdAt: now(), updatedAt: now(), plan: null, draft: null, review: null,
      approval: null, error: null, events: [], autoGathered: false, confirmedPacket: false
    };
    event(run, 'INPUT', 'Run created; gathering the source packet.');
    await store.save(run);
    return withLock(run.id, async () => {
      try {
        await buildPacket(run);
      } catch (error) {
        run.status = 'error';
        run.error = error instanceof Error ? error.message : 'Unknown workflow error.';
        event(run, 'ERROR', run.error);
        await store.save(run);
      }
      return run;
    });
  }

  async function getRun(id) {
    const run = await store.get(id);
    if (!run) throw new Error('Run not found.');
    return run;
  }

  async function removeSource(id, sourceId) {
    return withLock(id, async () => {
      const run = await getRun(id);
      if (run.status !== 'packet_review') throw new Error('Sources can only be removed during packet review.');
      const source = run.sources.find(item => item.id === sourceId);
      if (!source) throw new Error('Source not found in the packet.');
      if (source.suppliedBy !== 'agent') {
        throw new Error('Only auto-gathered snapshots can be removed; user-supplied sources are fixed at creation.');
      }
      run.sources = run.sources.filter(item => item.id !== sourceId);
      event(run, 'PACKET', `Removed auto-gathered snapshot ${sourceId} (${source.url}) from the packet.`);
      await store.save(run);
      return run;
    });
  }

  async function confirmPacket(id) {
    return withLock(id, async () => {
      const run = await getRun(id);
      if (run.status !== 'packet_review') throw new Error('This run is not waiting for packet review.');
      try {
        verifyPacket(run);
      } catch (error) {
        run.status = 'error';
        run.error = error instanceof Error ? error.message : 'Unknown workflow error.';
        event(run, 'ERROR', run.error);
        await store.save(run);
        throw error;
      }
      run.confirmedPacket = true;
      event(run, 'PACKET', `Packet confirmed with ${run.sources.length} source${run.sources.length === 1 ? '' : 's'}; drafting starts.`);
      await store.save(run);
      return draftStage(run);
    });
  }

  async function reviseRun(id, reviewer, feedback) {
    return withLock(id, async () => {
      const run = await getRun(id);
      if (!['pending_approval', 'check_failed', 'error'].includes(run.status)) throw new Error('This run cannot be revised now.');
      reviewer = String(reviewer ?? '').trim();
      feedback = String(feedback ?? '').trim();
      if (!reviewer || reviewer.length > 80) throw new Error('Enter a reviewer name (1–80 characters).');
      if (!feedback || feedback.length > 1000) throw new Error('Enter revision feedback (1–1000 characters).');
      event(run, 'HUMAN APPROVAL', 'Human rejected the pending draft and requested revision.', { reviewer, feedback });
      run.revision += 1;
      run.approval = null;
      run.review = null;
      run.error = null;
      event(run, 'GATHER', 'Revising with the confirmed packet; no new search is performed.');
      await store.save(run);
      return draftStage(run, feedback);
    });
  }

  async function approveRun(id, reviewer) {
    return withLock(id, async () => {
      const run = await getRun(id);
      if (run.status !== 'pending_approval' || run.review?.passed !== true) throw new Error('Approval is blocked until checks pass.');
      reviewer = String(reviewer ?? '').trim();
      if (!reviewer || reviewer.length > 80) throw new Error('Enter a reviewer name (1–80 characters).');
      run.approval = { reviewer, at: now() };
      run.status = 'approved';
      event(run, 'HUMAN APPROVAL', 'Human approved the reviewed draft.', { reviewer });
      event(run, 'OUTPUT', 'Final brief released.');
      await store.save(run);
      return run;
    });
  }

  return { createRun, getRun, removeSource, confirmPacket, reviseRun, approveRun };
}
