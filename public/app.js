const $ = id => document.getElementById(id);
let currentRun = null;

function sourceCount() {
  return document.querySelectorAll('.source-card').length;
}

function sourceCard(source = {}) {
  const card = document.createElement('div');
  card.className = 'source-card';
  card.innerHTML = '<div class="source-top"><strong>Source</strong><button type="button" class="remove secondary">Remove</button></div><label>Title<input class="source-title" maxlength="200"></label><label>URL<input class="source-url" type="url" placeholder="https://..."></label><label>Excerpt<textarea class="source-excerpt" rows="5" maxlength="5000" placeholder="Paste the evidence to analyze — or leave empty to fetch this URL"></textarea></label>';
  card.sourceMeta = { origin: 'pasted' };
  card.querySelector('.source-title').value = source.title ?? '';
  card.querySelector('.source-url').value = source.url ?? '';
  card.querySelector('.source-excerpt').value = source.excerpt ?? '';
  card.querySelector('.remove').onclick = () => card.remove();
  if (sourceCount() >= 6) $('message').textContent = 'A brief supports at most 6 sources.';
  $('sources').append(card);
}

function provenanceLabel(source) {
  if (source.suppliedBy === 'agent') return 'auto-gathered';
  return source.origin === 'fetched' ? 'user-supplied · fetched link' : 'user-supplied · pasted excerpt';
}

function element(tag, text, className = '') {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

function setBusy(busy) {
  for (const id of ['run', 'approve', 'revise', 'confirm']) $(id).disabled = busy;
  if (busy) $('message').textContent = 'Agents are working…';
  else if ($('message').textContent === 'Agents are working…') $('message').textContent = '';
}

async function request(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'content-type': 'application/json' } });
  const body = await response.json();
  if (!response.ok && !body.id) throw new Error(body.error ?? 'Request failed.');
  if (body.id && body.error) throw new Error(body.error);
  return body;
}

function renderList(target, values) {
  target.replaceChildren();
  for (const value of values) target.append(element('li', value));
}

function render(run) {
  currentRun = run;
  $('empty').hidden = true;
  $('result').hidden = false;
  $('status').textContent = run.status.replaceAll('_', ' ').toUpperCase();
  $('status').className = `status ${run.status}`;
  $('run-meta').textContent = `Run ${run.id} · live mode · revision ${run.revision}`;
  $('events').replaceChildren();
  for (const item of run.events) {
    const li = element('li', `${item.stage} · ${item.message}`);
    li.append(element('small', new Date(item.at).toLocaleString()));
    $('events').append(li);
  }
  const awaitingConfirmation = run.status === 'packet_review';
  $('packet-panel').hidden = !awaitingConfirmation;
  const packetSources = $('packet-sources');
  packetSources.replaceChildren();
  if (awaitingConfirmation) {
    if (!run.sources.length) packetSources.append(element('p', 'The packet is empty. At least one source is required before drafting.', 'bad'));
    for (const source of run.sources) {
      const item = element('div', '', 'source-review');
      item.append(element('strong', `${source.id} · ${source.title} · ${provenanceLabel(source)}`));
      const link = element('a', source.url);
      link.href = source.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      item.append(link);
      if (source.origin === 'fetched') item.append(element('small', `Fetched ${source.fetchedAt} · SHA-256 ${source.sha256}`, 'hint'));
      else item.append(element('blockquote', source.excerpt));
      if (source.suppliedBy === 'agent') {
        const remove = element('button', 'Remove this snapshot', 'secondary');
        remove.type = 'button';
        remove.onclick = async () => {
          setBusy(true);
          try { render(await request(`/api/runs/${run.id}/sources/${source.id}`, { method: 'DELETE' })); }
          catch (error) { $('message').textContent = error.message; }
          finally { setBusy(false); }
        };
        item.append(remove);
      }
      packetSources.append(item);
    }
  }
  const plan = $('plan-panel');
  plan.replaceChildren();
  if (run.plan) {
    plan.append(element('h3', 'Planner'), element('p', run.plan.approach));
    const list = element('ul', '');
    renderList(list, run.plan.evidenceNeeds ?? []);
    plan.append(list);
  }
  const sourcePanel = $('source-panel');
  sourcePanel.replaceChildren(element('h3', run.autoGathered ? 'Confirmed source packet (includes auto-gathered sources, not human-selected)' : 'Confirmed source packet'));
  for (const source of run.sources) {
    const item = element('div', '', 'source-review');
    item.append(element('strong', `${source.id} · ${source.title} · ${provenanceLabel(source)}`));
    const link = element('a', source.url);
    link.href = source.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    item.append(link, element('blockquote', source.excerpt));
    if (source.origin === 'fetched') item.append(element('small', `Fetched ${source.fetchedAt} · SHA-256 ${source.sha256.slice(0, 16)}…`, 'hint'));
    sourcePanel.append(item);
  }
  const draft = $('draft-panel');
  draft.replaceChildren();
  if (run.draft) {
    draft.append(element('h3', run.status === 'approved' ? 'Reviewed draft' : 'Pending draft'), element('p', run.draft.summary));
    const list = element('ul', '', 'findings');
    for (const finding of run.draft.findings ?? []) {
      const li = element('li', `${finding.claim} [${finding.sourceId}]`);
      const quote = element('blockquote', `Evidence: “${finding.evidence}”`);
      li.append(quote); list.append(li);
    }
    draft.append(list, element('h4', 'Limitations'));
    const limits = element('ul', '');
    renderList(limits, run.draft.limitations ?? []);
    draft.append(limits);
    if (run.draft.revisionNote) draft.append(element('p', run.draft.revisionNote, 'hint'));
  }
  const review = $('review-panel');
  review.replaceChildren();
  if (run.review) {
    const reviewMessage = !run.review.passed ? 'Failed. Approval is blocked until issues are resolved.' : run.status === 'approved' ? 'Passed. Human approval recorded.' : 'Passed. Human approval is still required.';
    review.append(element('h3', 'Reviewer check'), element('p', reviewMessage, run.review.passed ? 'good' : 'bad'));
    if (run.review.note) review.append(element('p', run.review.note, 'hint'));
    const issues = element('ul', '');
    renderList(issues, run.review.issues.map(issue => `${issue.type}: ${issue.message}`));
    review.append(issues);
  }
  if (run.error) review.append(element('p', run.error, 'bad'));
  $('approval-panel').hidden = !['pending_approval', 'check_failed', 'error'].includes(run.status);
  $('approve').hidden = run.status !== 'pending_approval';
  $('final-panel').hidden = run.status !== 'approved';
  if (run.status === 'approved') {
    $('final-text').textContent = buildFinalPreview(run);
    $('download').href = `/api/runs/${run.id}/export`;
  }
  history.replaceState(null, '', `#run=${run.id}`);
}

function buildFinalPreview(run) {
  return [
    `Research brief: ${run.question}`, '', `Approved by ${run.approval.reviewer} on ${run.approval.at}`, '',
    'Summary', run.draft.summary, '', 'Findings',
    ...run.draft.findings.map(item => `• ${item.claim} [${item.sourceId}]`), '',
    'Limitations', ...run.draft.limitations.map(item => `• ${item}`),
    '• Supplied source excerpts and metadata were not independently authenticated.',
    ...(run.sources.some(source => source.suppliedBy === 'agent') ? ['• Sources were gathered automatically from web search and were not selected by a human.'] : []),
    '',
    'Supplied sources', ...run.sources.map(source => `• [${source.id}] ${source.title} — ${source.url}${source.origin === 'fetched' ? ` · fetched ${source.fetchedAt} · SHA-256 ${source.sha256}` : ' · user-pasted excerpt'} · ${source.suppliedBy === 'agent' ? 'auto-gathered' : 'user-supplied'}`)
  ].join('\n');
}

$('add-source').onclick = () => {
  if (sourceCount() >= 6) { $('message').textContent = 'A brief supports at most 6 sources.'; return; }
  sourceCard();
};
$('sample').onclick = async () => {
  try {
    const sample = await request('/api/sample');
    $('question').value = sample.question;
    $('sources').replaceChildren();
    sample.sources.forEach(sourceCard);
    $('message').textContent = 'Sample packet loaded.';
  } catch (error) { $('message').textContent = error.message; }
};
$('run').onclick = async () => {
  setBusy(true);
  try {
    const sources = [...document.querySelectorAll('.source-card')].map(card => {
      const title = card.querySelector('.source-title').value;
      const url = card.querySelector('.source-url').value;
      const excerpt = card.querySelector('.source-excerpt').value;
      return excerpt.trim() ? { title, url, excerpt } : { title, url };
    }).filter(source => source.title.trim() || source.url.trim() || source.excerpt?.trim());
    if (!sources.length) $('message').textContent = 'No sources supplied; the agent will search automatically…';
    const run = await request('/api/runs', { method: 'POST', body: JSON.stringify({ question: $('question').value, sources }) });
    const hasLinks = sources.some(source => !source.excerpt);
    if (run.status === 'packet_review') $('message').textContent = `Packet ready: ${run.sources.length} source${run.sources.length === 1 ? '' : 's'}${hasLinks ? ' (user links fetched)' : ''}. Review and confirm to draft.`;
    else if (run.status === 'error') $('message').textContent = run.error;
    render(run);
  } catch (error) { $('message').textContent = error.message; }
  finally { setBusy(false); }
};
$('confirm').onclick = async () => {
  if (!currentRun) return;
  setBusy(true);
  $('message').textContent = 'Drafting from the confirmed packet…';
  try { render(await request(`/api/runs/${currentRun.id}/confirm`, { method: 'POST', body: '{}' })); }
  catch (error) { $('message').textContent = error.message; }
  finally { setBusy(false); }
};
$('approve').onclick = async () => {
  if (!currentRun) return;
  setBusy(true);
  try { render(await request(`/api/runs/${currentRun.id}/approve`, { method: 'POST', body: JSON.stringify({ reviewer: $('reviewer').value }) })); }
  catch (error) { $('message').textContent = error.message; }
  finally { setBusy(false); }
};
$('revise').onclick = async () => {
  if (!currentRun) return;
  setBusy(true);
  try { render(await request(`/api/runs/${currentRun.id}/revise`, { method: 'POST', body: JSON.stringify({ reviewer: $('reviewer').value, feedback: $('feedback').value }) })); }
  catch (error) { $('message').textContent = error.message; }
  finally { setBusy(false); }
};

sourceCard();
const savedRun = location.hash.match(/^#run=([a-f0-9-]{36})$/)?.[1];
if (savedRun) request(`/api/runs/${savedRun}`).then(render).catch(() => {});
