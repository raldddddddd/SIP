const $ = id => document.getElementById(id);
let currentRun = null;
let sourceSerial = 0;
let busy = false;
let activeStage = 'prepare';
let refreshTimer = null;
const decisionStatuses = ['pending_approval', 'check_failed', 'error', 'approved'];

function element(tag, text = '', className = '') {
  const node = document.createElement(tag);
  node.textContent = text ?? '';
  if (className) node.className = className;
  return node;
}

function button(text, className = 'button button-secondary') {
  const node = element('button', text, className);
  node.type = 'button';
  return node;
}

function showStage(stage, focus = true) {
  if (stage !== 'prepare' && !currentRun) return;
  if (stage === 'review' && !currentRun.confirmedPacket) return;
  if (stage === 'approval' && (!currentRun.confirmedPacket || !decisionStatuses.includes(currentRun.status))) return;
  activeStage = stage;
  for (const name of ['prepare', 'review', 'approval']) {
    $(`stage-${name}`).hidden = name !== stage;
    const nav = $(`nav-${name}`);
    if (name === stage) nav.setAttribute('aria-current', 'step');
    else nav.removeAttribute('aria-current');
    nav.parentElement.classList.toggle('current', name === stage);
  }
  if (focus) {
    $(stage === 'prepare' && currentRun && !currentRun.confirmedPacket ? 'packet-heading' : `${stage}-heading`).focus({ preventScroll: true });
    $(`stage-${stage}`).scrollIntoView({ block: 'start', behavior: 'auto' });
  }
}

function setBusy(value, message = '') {
  busy = value;
  for (const id of ['run', 'confirm', 'approve', 'revise', 'sample', 'add-source', 'new-run']) $(id).disabled = value;
  $('add-source').disabled = value || sourceCards().length >= 6;
  $('confirm').disabled = value || currentRun?.status !== 'packet_review' || !currentRun?.sources.length;
  $('nav-review').disabled = value || !currentRun?.confirmedPacket;
  $('nav-approval').disabled = value || !currentRun?.confirmedPacket || !decisionStatuses.includes(currentRun.status);
  $('to-approval').disabled = value;
  document.querySelectorAll('.remove-snapshot').forEach(node => { node.disabled = value; });
  if (value && message) $('message').textContent = message;
  if (!value && $('message').textContent === message) $('message').textContent = '';
}

async function request(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'content-type': 'application/json' } });
  const body = await response.json();
  if (!response.ok && !body.id) throw new Error(body.error ?? 'Request failed.');
  return body;
}

function sourceCards() { return [...$('sources').querySelectorAll('.source-card')]; }

function sourceData(card) {
  return {
    title: card.querySelector('.source-title').value.trim(),
    url: card.querySelector('.source-url').value.trim(),
    excerpt: card.querySelector('.source-excerpt').value.trim()
  };
}

function activeSourceCards() {
  return sourceCards().filter(card => {
    const source = sourceData(card);
    return source.title || source.url || source.excerpt;
  });
}

function updateSourceCount() {
  const count = activeSourceCards().length;
  $('source-count').textContent = `${count} / 6 sources`;
  $('add-source').disabled = busy || sourceCards().length >= 6;
  if (!sourceCards().length) $('sources').append(element('p', 'No sources added. The agent can gather up to six.', 'source-empty'));
  else $('sources').querySelector('.source-empty')?.remove();
}

function sourceCard(source = {}) {
  $('sources').querySelector('.source-empty')?.remove();
  const serial = ++sourceSerial;
  const card = document.createElement('details');
  card.className = 'source-card';
  card.open = !source.title;

  const summary = document.createElement('summary');
  const summaryInner = element('span', '', 'source-summary');
  const summaryText = element('span', '', 'source-summary-text');
  const titleText = element('strong', source.title || 'Untitled source');
  const urlText = element('small', source.url || 'Add a public URL');
  summaryText.append(titleText, urlText);
  summaryInner.append(summaryText);
  summary.append(summaryInner, element('span', source.excerpt ? 'Pasted excerpt' : 'Source link', 'source-origin'));
  card.append(summary);

  const fields = element('div', '', 'source-fields');
  function field(labelText, name, value, tag, maxLength) {
    const label = document.createElement('label');
    const id = `source-${serial}-${name}`;
    label.htmlFor = id;
    label.textContent = labelText;
    const control = document.createElement(tag);
    control.id = id;
    control.className = `source-${name}`;
    control.maxLength = maxLength;
    control.value = value ?? '';
    if (tag === 'input' && name === 'url') control.type = 'url';
    if (tag === 'textarea') control.rows = 5;
    control.addEventListener('input', () => {
      control.removeAttribute('aria-invalid');
      titleText.textContent = card.querySelector('.source-title').value.trim() || 'Untitled source';
      urlText.textContent = card.querySelector('.source-url').value.trim() || 'Add a public URL';
      card.querySelector('.source-origin').textContent = card.querySelector('.source-excerpt').value.trim() ? 'Pasted excerpt' : 'Source link';
      card.querySelector('.source-actions button').setAttribute('aria-label', `Remove ${titleText.textContent}`);
      updateSourceCount();
    });
    label.append(control);
    fields.append(label);
  }
  field('Title', 'title', source.title, 'input', 200);
  field('URL', 'url', source.url, 'input', 2048);
  field('Excerpt (optional for links)', 'excerpt', source.excerpt, 'textarea', 5000);
  const actions = element('div', '', 'source-actions');
  const remove = button('Remove source');
  remove.setAttribute('aria-label', `Remove ${source.title || 'untitled source'}`);
  remove.onclick = () => { card.remove(); updateSourceCount(); };
  actions.append(remove);
  fields.append(actions);
  card.append(fields);
  $('sources').append(card);
  updateSourceCount();
  return card;
}

function validatePrepare() {
  const question = $('question');
  question.removeAttribute('aria-invalid');
  if (!question.value.trim()) {
    question.setAttribute('aria-invalid', 'true');
    $('message').textContent = 'Enter a research question.';
    question.focus();
    return false;
  }
  const cards = activeSourceCards();
  if (cards.length > 6) {
    $('message').textContent = 'Provide at most six sources.';
    $('add-source').focus();
    return false;
  }
  for (const [index, card] of cards.entries()) {
    const source = sourceData(card);
    for (const [name, value] of [['title', source.title], ['url', source.url], ['excerpt', source.excerpt]]) {
      const field = card.querySelector(`.source-${name}`);
      field.removeAttribute('aria-invalid');
      let invalid = name === 'url' ? !value : name === 'title' ? !!source.excerpt && !value : false;
      if (name === 'url' && value) {
        try { invalid = !['http:', 'https:'].includes(new URL(value).protocol); }
        catch { invalid = true; }
      }
      if (name === 'excerpt' && !invalid) invalid = value.length > 5000;
      if (invalid) {
        card.open = true;
        field.setAttribute('aria-invalid', 'true');
        $('message').textContent = `Source ${index + 1}: enter a valid ${name === 'url' ? 'http or https URL' : name}.`;
        field.focus();
        return false;
      }
    }
  }
  $('message').textContent = '';
  return true;
}

function sourceProvenance(source) {
  if (source.suppliedBy === 'agent') return 'Auto-gathered snapshot';
  return source.origin === 'fetched' ? 'User-supplied link · fetched snapshot' : 'User-pasted excerpt';
}

function renderEventList(target, items) {
  target.replaceChildren();
  for (const item of items) {
    const li = element('li', `${item.stage} · ${item.message}`);
    li.append(element('small', new Date(item.at).toLocaleString()));
    target.append(li);
  }
}

function renderPacket(run) {
  const packetState = !run.confirmedPacket;
  $('prepare-form').hidden = packetState;
  $('packet-review').hidden = !packetState;
  if (!packetState) return;
  $('packet-summary').textContent = `${run.sources.length} of 6 sources saved. Inspect origins, URLs, and excerpts before the agents draft.`;
  const status = $('packet-status');
  status.className = 'state-banner';
  if (run.status === 'error') {
    status.classList.add('error');
    status.textContent = `Gathering stopped: ${run.error}. Start a new question to retry.`;
  } else if (run.status === 'packet_review') {
    status.textContent = 'The packet is ready. Remove any auto-gathered snapshots you do not trust, then confirm it.';
  } else {
    status.textContent = 'Gathering is in progress. The saved packet and events will update when it finishes.';
  }
  $('confirm').hidden = run.status !== 'packet_review';
  $('confirm').disabled = busy || !run.sources.length;
  $('packet-message').textContent = run.status === 'packet_review' && !run.sources.length ? 'Keep at least one source to continue. Start a new question to add your own.' : '';
  const list = $('packet-sources');
  list.replaceChildren();
  for (const source of run.sources) {
    const item = element('article', '', 'packet-source');
    item.append(element('p', `${source.id} · ${sourceProvenance(source)}`, 'section-kicker'));
    item.append(element('h4', source.title));
    const link = element('a', source.url);
    link.href = source.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    item.append(link);
    if (source.origin === 'fetched') item.append(element('small', `Fetched ${source.fetchedAt} · SHA-256 ${source.sha256}`, 'packet-metadata'));
    const details = document.createElement('details');
    details.append(element('summary', 'Read saved excerpt'), element('blockquote', source.excerpt));
    item.append(details);
    if (source.suppliedBy === 'agent' && run.status === 'packet_review') {
      const remove = button(`Remove ${source.id}`, 'button button-secondary remove-snapshot');
      remove.onclick = async () => {
        setBusy(true);
        try { render(await request(`/api/runs/${run.id}/sources/${encodeURIComponent(source.id)}`, { method: 'DELETE' }), 'prepare', false); }
        catch (error) { $('packet-message').textContent = error.message; }
        finally { setBusy(false); }
      };
      item.append(remove);
    }
    list.append(item);
  }
  if (!run.sources.length) list.append(element('p', 'No usable sources were saved.', 'source-empty'));
  const packetEvents = (run.events ?? []).filter(item => ['INPUT', 'GATHER', 'PACKET', 'ERROR'].includes(item.stage));
  renderEventList($('packet-events'), packetEvents);
  $('packet-event-count').textContent = `${packetEvents.length} events`;
}

function renderList(target, values) {
  target.replaceChildren();
  for (const value of values) target.append(element('li', value));
}

function renderPlan(run) {
  const panel = $('plan-panel');
  panel.replaceChildren(element('p', 'Agent 1', 'section-kicker'), element('h3', 'Planner'));
  if (!run.plan) { panel.append(element('p', run.status === 'error' ? 'The Planner did not finish.' : 'The plan is not available yet.', 'review-note')); return; }
  panel.append(element('p', run.plan.approach || 'No approach provided.', 'review-note'));
  if (run.plan.evidenceNeeds?.length) {
    panel.append(element('h4', 'Evidence needs'));
    const list = element('ul', '', 'simple-list');
    renderList(list, run.plan.evidenceNeeds);
    panel.append(list);
  }
}

function renderSources(run) {
  const panel = $('source-panel');
  panel.replaceChildren(element('p', 'Evidence packet', 'section-kicker'), element('h3', `${run.sources.length} saved sources`));
  panel.append(element('p', 'Excerpts and metadata are saved with this run. Their authenticity has not been independently verified.', 'review-note'));
  for (const source of run.sources) {
    const item = element('article', '', 'source-review');
    item.id = `review-source-${source.id}`;
    item.tabIndex = -1;
    item.append(element('strong', `${source.id} · ${source.title}`));
    const link = element('a', source.url);
    link.href = source.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    item.append(link);
    item.append(element('small', `${sourceProvenance(source)}${source.origin === 'fetched' ? ` · ${source.fetchedAt} · SHA-256 ${source.sha256.slice(0, 16)}…` : ''}`));
    const details = document.createElement('details');
    details.append(element('summary', 'Read full excerpt'), element('blockquote', source.excerpt));
    item.append(details);
    panel.append(item);
  }
}

function renderDraft(run) {
  const panel = $('draft-panel');
  panel.replaceChildren(element('p', `Research brief / Revision ${run.revision}`, 'section-kicker'));
  const heading = element('h3', run.status === 'approved' ? 'Reviewed draft' : 'Pending draft');
  panel.append(heading);
  if (!run.draft) { panel.append(element('p', 'No draft is available for this run.', 'review-note')); return; }
  if (run.status !== 'approved') panel.append(element('span', run.status === 'check_failed' ? 'Checks failed · release blocked' : run.status === 'error' ? 'Run error · release blocked' : 'Pending human approval', 'pending-label'));
  panel.append(element('p', run.draft.summary, 'draft-summary'));
  panel.append(element('h4', 'Findings & evidence', 'document-section-heading'));
  const list = element('ol', '', 'finding-list');
  for (const [index, finding] of (run.draft.findings ?? []).entries()) {
    const card = element('li', '', 'finding-card');
    const claim = element('div', '', 'finding-claim');
    claim.append(element('span', String(index + 1).padStart(2, '0'), 'finding-number'), element('p', finding.claim));
    const cite = button(`View source ${finding.sourceId}`, 'citation-link');
    cite.onclick = () => {
      const source = $(`review-source-${finding.sourceId}`);
      if (!source) return;
      source.querySelector('details').open = true;
      source.focus({ preventScroll: true });
      source.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    };
    const evidence = element('blockquote', `“${finding.evidence}”`, 'finding-evidence');
    const evidenceLabel = element('span', `Excerpt from ${finding.sourceId}`, 'evidence-label');
    card.append(claim, evidence, evidenceLabel, cite);
    list.append(card);
  }
  panel.append(list);
  panel.append(element('h4', 'Limits of this brief', 'document-section-heading'));
  const limits = element('ul', '', 'limit-list');
  renderList(limits, run.draft.limitations ?? []);
  panel.append(limits);
  if (run.draft.revisionNote) panel.append(element('p', run.draft.revisionNote, 'review-note'));
}

function renderReview(run) {
  const panel = $('review-panel');
  panel.classList.toggle('review-failed', run.review?.passed === false || !!run.error);
  panel.replaceChildren(element('p', 'Agent 3 + deterministic checks', 'section-kicker'), element('h3', 'Reviewer findings'));
  if (!run.review) {
    panel.append(element('p', run.error || 'The Reviewer has not finished yet.', run.error ? 'review-result failed' : 'review-note'));
    return;
  }
  const passed = run.review.passed;
  panel.append(element('p', passed ? 'Checks passed. Human approval is still required.' : 'Checks failed. Approval is blocked until a revision passes.', `review-result ${passed ? 'passed' : 'failed'}`));
  if (run.review.note) panel.append(element('p', run.review.note, 'review-note'));
  if (run.review.issues?.length) {
    const issues = element('ul', '', 'issue-list');
    renderList(issues, run.review.issues.map(issue => `${issue.type}: ${issue.message}`));
    panel.append(issues);
    if (run.review.issues.some(issue => issue.type === 'prompt_injection')) panel.append(element('p', 'The confirmed packet contains instruction-like text. Return to Prepare sources and start a new run with a corrected packet; revisions reuse this packet.', 'review-result failed'));
  }
  if (run.error) panel.append(element('p', run.error, 'review-result failed'));
}

function renderFinalDocument(run) {
  const documentPanel = $('final-text');
  documentPanel.replaceChildren();
  documentPanel.append(element('p', `Approved by ${run.approval.reviewer} · ${new Date(run.approval.at).toLocaleString()}`, 'brief-byline'));
  documentPanel.append(element('h4', run.question, 'brief-title'));
  documentPanel.append(element('h5', 'Summary'), element('p', run.draft.summary, 'brief-lead'));
  documentPanel.append(element('h5', 'Findings'));
  const findings = element('ol', '', 'brief-findings');
  for (const finding of run.draft.findings) {
    const item = element('li', finding.claim);
    item.append(element('span', ` [${finding.sourceId}]`, 'brief-citation'));
    findings.append(item);
  }
  documentPanel.append(findings, element('h5', 'Limitations'));
  const limitations = element('ul', '', 'brief-list');
  renderList(limitations, [...run.draft.limitations, 'Supplied source excerpts and metadata were not independently authenticated.', ...(run.sources.some(source => source.suppliedBy === 'agent') ? ['Sources were gathered automatically from web search and were not selected by a human.'] : [])]);
  documentPanel.append(limitations, element('h5', 'Supplied sources'));
  const sources = element('ol', '', 'brief-list');
  for (const source of run.sources) {
    const item = document.createElement('li');
    item.append(element('strong', `[${source.id}] ${source.title} — `));
    const link = element('a', source.url);
    link.href = source.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    item.append(link, element('span', ` · ${sourceProvenance(source)}${source.origin === 'fetched' ? ` · fetched ${source.fetchedAt} · SHA-256 ${source.sha256}` : ''}`));
    sources.append(item);
  }
  documentPanel.append(sources);
}

function renderApproval(run) {
  const status = run.status;
  const state = $('approval-state');
  state.className = 'state-banner';
  $('decision-form').hidden = status === 'approved' || !decisionStatuses.includes(status);
  $('revision-details').open = status === 'check_failed' || status === 'error';
  $('reviewer').disabled = status === 'approved';
  $('feedback').disabled = status === 'approved';
  $('revise').hidden = status === 'approved';
  $('approve').hidden = status !== 'pending_approval';
  $('decision-actions').hidden = status !== 'pending_approval';
  $('final-panel').hidden = status !== 'approved';
  document.querySelector('.release-note').hidden = status === 'approved';
  document.querySelector('.approval-layout').classList.toggle('approved-layout', status === 'approved');
  if (status === 'approved') {
    state.classList.add('approved');
    state.textContent = `Approved by ${run.approval.reviewer} on ${new Date(run.approval.at).toLocaleString()}. The final brief is available below.`;
    $('decision-copy').textContent = 'The release decision is recorded in the workflow history.';
    $('reviewer').value = run.approval.reviewer;
    renderFinalDocument(run);
    $('download').href = `/api/runs/${run.id}/export`;
  } else {
    $('download').removeAttribute('href');
    $('final-text').replaceChildren();
    $('decision-copy').textContent = 'Inspect the pending draft and its evidence before deciding.';
    if (status === 'pending_approval') state.textContent = 'Checks passed. Enter your name to approve, or give feedback to request another draft.';
    else if (!decisionStatuses.includes(status)) state.textContent = 'The agents are still working. A human decision becomes available after the checks finish.';
    else {
      state.classList.add(status === 'check_failed' ? 'warning' : 'error');
      state.textContent = status === 'check_failed' ? 'Approval is blocked by failed checks. Enter feedback to request a revised draft and a new review.' : 'This run ended with an error. Approval is unavailable; you may request a revision.';
    }
  }
}

function renderProgress(run) {
  const stages = ['GATHER', 'PACKET', 'PLAN', 'ORCHESTRATE', 'EXECUTE', 'CHECK', 'HUMAN APPROVAL', 'OUTPUT'];
  const events = run.events ?? [];
  const lastRejection = events.findLastIndex(item => item.stage === 'HUMAN APPROVAL' && /rejected/.test(item.message));
  const cycle = events.slice(lastRejection + 1);
  const progress = $('workflow-progress');
  progress.replaceChildren();
  for (const stage of stages) {
    let state = cycle.some(item => item.stage === stage) ? 'done' : 'locked';
    if (stage === 'GATHER' && events.some(item => item.stage === 'GATHER')) state = 'done';
    if (stage === 'PACKET' && run.confirmedPacket) state = 'done';
    if (stage === 'PLAN' && cycle.some(item => item.stage === 'PLAN') && !cycle.some(item => item.stage === 'ORCHESTRATE')) state = run.status === 'error' ? 'failed' : 'waiting';
    if (stage === 'EXECUTE' && !cycle.some(item => item.stage === 'EXECUTE') && cycle.some(item => item.stage === 'ORCHESTRATE')) state = run.status === 'error' ? 'failed' : 'waiting';
    if (stage === 'CHECK' && !cycle.some(item => item.stage === 'CHECK') && cycle.some(item => item.stage === 'EXECUTE')) state = run.status === 'error' ? 'failed' : 'waiting';
    if (stage === 'CHECK' && run.status === 'check_failed') state = 'failed';
    if (stage === 'HUMAN APPROVAL' && run.status === 'pending_approval') state = 'waiting';
    if (stage === 'HUMAN APPROVAL' && ['check_failed', 'error'].includes(run.status)) state = 'locked';
    const item = element('li', stage);
    item.className = state;
    item.setAttribute('aria-label', `${stage}: ${state === 'done' ? 'completed' : state === 'failed' ? 'failed' : state === 'waiting' ? 'awaiting human decision' : 'not reached'}`);
    progress.append(item);
  }
}

function render(run, stage = run.status === 'approved' ? 'approval' : run.confirmedPacket ? 'review' : 'prepare', focus = true) {
  clearTimeout(refreshTimer);
  currentRun = run;
  $('nav-review').disabled = busy || !run.confirmedPacket;
  $('nav-approval').disabled = busy || !run.confirmedPacket || !decisionStatuses.includes(run.status);
  $('to-approval').hidden = !run.confirmedPacket || run.status === 'approved' || !decisionStatuses.includes(run.status);
  $('run-meta').textContent = `Run ${run.id} · Live model · Revision ${run.revision}`;
  const banner = $('review-status');
  banner.className = 'state-banner';
  if (run.status === 'pending_approval') banner.textContent = 'The draft passed review and is waiting for a human decision. It is not final output.';
  else if (run.status === 'approved') banner.textContent = 'This brief has been approved. The release decision is recorded below.';
  else if (run.status === 'check_failed') { banner.classList.add('warning'); banner.textContent = run.review?.issues?.some(issue => issue.type === 'prompt_injection') ? 'Review failed. The confirmed packet contains instruction-like text; return to Prepare sources and start a corrected run. Approval and export remain blocked.' : 'Review failed. Read the issues, then request a revision. Approval and export remain blocked.'; }
  else if (run.status === 'error') { banner.classList.add('error'); banner.textContent = `The run stopped: ${run.error || 'Unknown error'}. No final output was released.`; }
  else banner.textContent = 'Agents are still working. Completed transitions below come from the saved event history.';
  renderEventList($('events'), run.events ?? []);
  $('event-count').textContent = `${run.events?.length ?? 0} events`;
  renderProgress(run);
  renderPlan(run);
  renderSources(run);
  renderDraft(run);
  renderReview(run);
  renderApproval(run);
  renderPacket(run);
  history.replaceState(null, '', `#run=${run.id}`);
  showStage(run.confirmedPacket ? stage : 'prepare', focus);
  if (['created', 'gathering', 'planning', 'executing', 'checking'].includes(run.status)) {
    refreshTimer = setTimeout(async () => {
      if (currentRun?.id !== run.id) return;
      try { render(await request(`/api/runs/${run.id}`), activeStage, false); }
      catch { /* The saved run remains visible; a page reload can retry. */ }
    }, 1500);
  }
}

$('nav-prepare').onclick = () => showStage('prepare');
document.querySelector('.skip-link').addEventListener('click', event => {
  event.preventDefault();
  $('main').focus({ preventScroll: true });
  $('main').scrollIntoView({ block: 'start', behavior: 'auto' });
});
$('nav-review').onclick = () => showStage('review');
$('nav-approval').onclick = () => showStage('approval');
$('to-approval').onclick = () => showStage('approval');
$('back-to-review').onclick = () => showStage('review');
$('add-source').onclick = () => { if (sourceCards().length < 6) sourceCard().querySelector('.source-url').focus(); };
$('question').addEventListener('input', () => $('question').removeAttribute('aria-invalid'));

$('sample').onclick = async () => {
  try {
    const sample = await request('/api/sample');
    $('question').value = sample.question;
    $('question').removeAttribute('aria-invalid');
    $('sources').replaceChildren();
    sample.sources.forEach(sourceCard);
    $('message').textContent = 'Sample packet loaded. A live model and search sidecar are still required.';
    updateSourceCount();
  } catch (error) { $('message').textContent = error.message; }
};

$('prepare-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!validatePrepare()) return;
  const working = 'Gathering sources. The saved packet will appear when this request finishes.';
  setBusy(true, working);
  try {
    const sources = activeSourceCards().map(sourceData);
    const run = await request('/api/runs', { method: 'POST', body: JSON.stringify({ question: $('question').value.trim(), sources }) });
    render(run, 'prepare');
  } catch (error) { $('message').textContent = error.message; }
  finally { setBusy(false, working); }
});


$('confirm').onclick = async () => {
  if (!currentRun || currentRun.status !== 'packet_review' || !currentRun.sources.length) return;
  setBusy(true);
  $('packet-message').textContent = 'Planning, drafting, and checking the confirmed packet…';
  try {
    render(await request(`/api/runs/${currentRun.id}/confirm`, { method: 'POST' }), 'review');
    $('packet-message').textContent = '';
  } catch (error) {
    $('packet-message').textContent = error.message;
    try { render(await request(`/api/runs/${currentRun.id}`), undefined, false); } catch { /* Keep the visible packet. */ }
  } finally { setBusy(false); }
};
$('new-run').onclick = () => {
  clearTimeout(refreshTimer);
  currentRun = null;
  history.replaceState(null, '', location.pathname);
  $('question').value = '';
  $('sources').replaceChildren();
  updateSourceCount();
  $('prepare-form').hidden = false;
  $('packet-review').hidden = true;
  $('nav-review').disabled = true;
  $('nav-approval').disabled = true;
  $('message').textContent = '';
  showStage('prepare');
  $('question').focus();
};
function validateDecision(revising) {
  $('reviewer').removeAttribute('aria-invalid');
  $('feedback').removeAttribute('aria-invalid');
  if (!$('reviewer').value.trim()) {
    $('reviewer').setAttribute('aria-invalid', 'true');
    $('decision-message').textContent = 'Enter your name to record the decision.';
    $('reviewer').focus();
    return false;
  }
  if (revising && !$('feedback').value.trim()) {
    $('feedback').setAttribute('aria-invalid', 'true');
    $('decision-message').textContent = 'Explain what should change before requesting a revision.';
    $('feedback').focus();
    return false;
  }
  $('decision-message').textContent = '';
  return true;
}

$('reviewer').addEventListener('input', () => $('reviewer').removeAttribute('aria-invalid'));
$('feedback').addEventListener('input', () => $('feedback').removeAttribute('aria-invalid'));
$('approve').onclick = async () => {
  if (!currentRun || currentRun.status !== 'pending_approval' || !validateDecision(false)) return;
  setBusy(true);
  try { render(await request(`/api/runs/${currentRun.id}/approve`, { method: 'POST', body: JSON.stringify({ reviewer: $('reviewer').value.trim() }) }), 'approval'); }
  catch (error) { $('decision-message').textContent = error.message; }
  finally { setBusy(false); }
};
$('revise').onclick = async () => {
  if (!currentRun || !['pending_approval', 'check_failed', 'error'].includes(currentRun.status) || !validateDecision(true)) return;
  setBusy(true);
  $('decision-message').textContent = 'Revising and checking the new draft…';
  try {
    render(await request(`/api/runs/${currentRun.id}/revise`, { method: 'POST', body: JSON.stringify({ reviewer: $('reviewer').value.trim(), feedback: $('feedback').value.trim() }) }), 'review');
    $('decision-message').textContent = '';
  } catch (error) { $('decision-message').textContent = error.message; }
  finally { setBusy(false); }
};

updateSourceCount();
showStage('prepare', false);
const savedRun = location.hash.match(/^#run=([a-f0-9-]{36})$/)?.[1];
if (savedRun) request(`/api/runs/${savedRun}`).then(run => render(run)).catch(() => {});
