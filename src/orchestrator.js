import { randomUUID } from 'node:crypto';
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

export function renderBrief(run) {
  if (run.status !== 'approved') throw new Error('Final output requires human approval.');
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
  lines.push('- Supplied source excerpts and metadata were not independently authenticated.', '', '## Supplied sources', '');
  for (const source of run.sources) {
    const provenance = source.origin === 'fetched' ? `; fetched ${source.fetchedAt}; SHA-256 ${source.sha256}` : '; user-pasted excerpt';
    lines.push(`- [${source.id}] ${source.title.replace(/[\[\]]/g, '')} — ${source.url}${provenance}`);
  }
  return lines.join('\n');
}

export function createOrchestrator(store, options = {}) {
  const roleRunner = options.roleRunner ?? ((role, mode, payload) => runRole(role, mode, payload, options));

  async function pipeline(run, feedback = '') {
    try {
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
      approval: null, error: null, events: []
    };
    event(run, 'INPUT', `Run created in ${run.mode} mode.`);
    await store.save(run);
    return withLock(run.id, () => pipeline(run));
  }

  async function getRun(id) {
    const run = await store.get(id);
    if (!run) throw new Error('Run not found.');
    return run;
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
      await store.save(run);
      return pipeline(run, feedback);
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

  return { createRun, getRun, reviseRun, approveRun };
}
