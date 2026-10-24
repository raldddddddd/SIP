const $ = id => document.getElementById(id);
let currentRun = null;

function sourceCard(source = {}) {
  const card = document.createElement('div');
  card.className = 'source-card';
  card.innerHTML = '<div class="source-top"><strong>Source</strong><button type="button" class="remove secondary">Remove</button></div><label>Title<input class="source-title" maxlength="200"></label><label>URL<input class="source-url" type="url" placeholder="https://..."></label><label>Excerpt<textarea class="source-excerpt" rows="5" maxlength="6000" placeholder="Paste the evidence to analyze"></textarea></label>';
  card.sourceMeta = source.origin === 'fetched' ? { origin: 'fetched', snapshotId: source.snapshotId } : { origin: 'pasted' };
  card.querySelector('.source-title').value = source.title ?? '';
  card.querySelector('.source-url').value = source.url ?? '';
  card.querySelector('.source-excerpt').value = source.excerpt ?? '';
  if (source.origin === 'fetched') {
    card.querySelector('strong').textContent = `Fetched snapshot · ${source.fetchedAt ?? ''}`;
    for (const field of card.querySelectorAll('input, textarea')) field.readOnly = true;
  }
  card.querySelector('.remove').onclick = () => card.remove();
  $('sources').append(card);
}

function element(tag, text, className = '') {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

function setBusy(busy) {
  for (const id of ['run', 'approve', 'revise', 'search', 'fetch-selected']) $(id).disabled = busy;
  if (busy) $('message').textContent = 'Agents are working…';
  else if ($('message').textContent === 'Agents are working…') $('message').textContent = '';
}

async function request(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'content-type': 'application/json' } });
  const body = await response.json();
  if (!response.ok && !body.id) throw new Error(body.error ?? 'Request failed.');
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
  $('run-meta').textContent = `Run ${run.id} · ${run.mode.toUpperCase()} mode · revision ${run.revision}`;
  $('events').replaceChildren();
  for (const item of run.events) {
    const li = element('li', `${item.stage} · ${item.message}`);
    li.append(element('small', new Date(item.at).toLocaleString()));
    $('events').append(li);
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
  sourcePanel.replaceChildren(element('h3', 'Supplied source packet'));
  for (const source of run.sources) {
    const item = element('div', '', 'source-review');
    item.append(element('strong', `${source.id} · ${source.title}`));
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
    '• Supplied source excerpts and metadata were not independently authenticated.', '',
    'Supplied sources', ...run.sources.map(source => `• [${source.id}] ${source.title} — ${source.url}${source.origin === 'fetched' ? ` · fetched ${source.fetchedAt} · SHA-256 ${source.sha256}` : ' · pasted excerpt'}`)
  ].join('\n');
}

$('add-source').onclick = () => sourceCard();
$('search').onclick = async () => {
  const query = $('search-query').value.trim() || $('question').value.trim();
  if (!query) { $('search-status').textContent = 'Enter a question or search topic first.'; return; }
  setBusy(true);
  $('search-status').textContent = 'Planner is preparing queries and searching…';
  $('search-results').replaceChildren();
  $('fetch-selected').hidden = true;
  try {
    const data = await request('/api/search', { method: 'POST', body: JSON.stringify({ query, mode: $('mode').value }) });
    $('search-plan').textContent = `Planner queries: ${data.queries.join(' · ')}`;
    $('search-status').textContent = `${data.results.length} candidate results. Select pages to fetch.`;
    for (const result of data.results) {
      const label = element('label', '', 'search-result');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox'; checkbox.value = result.url;
      label.append(checkbox, element('strong', result.title), element('small', result.url), element('span', result.snippet));
      $('search-results').append(label);
    }
    $('fetch-selected').hidden = data.results.length === 0;
  } catch (error) { $('search-status').textContent = `${error.message} Manual paste remains available.`; }
  finally { setBusy(false); }
};
$('fetch-selected').onclick = async () => {
  const urls = [...$('search-results').querySelectorAll('input:checked')].map(input => input.value);
  if (!urls.length || urls.length > 8) { $('fetch-results').textContent = 'Select 1–8 results.'; return; }
  const existing = [...document.querySelectorAll('.source-card')].filter(card =>
    card.sourceMeta.origin === 'fetched' ||
    card.querySelector('.source-title').value.trim() ||
    card.querySelector('.source-url').value.trim() ||
    card.querySelector('.source-excerpt').value.trim()).length;
  if (existing + urls.length > 8) { $('fetch-results').textContent = 'A brief supports at most 8 sources. Remove some sources or select fewer results.'; return; }
  setBusy(true);
  $('fetch-results').textContent = 'Fetching selected pages…';
  try {
    const pages = await request('/api/fetch', { method: 'POST', body: JSON.stringify({ urls }) });
    let added = 0;
    const failures = [];
    for (const page of pages) {
      if (page.ok) { sourceCard(page); added++; }
      else failures.push(`${page.url}: ${page.error}`);
    }
    $('fetch-results').textContent = `${added} snapshots added. ${failures.length ? `Failed: ${failures.join(' | ')}` : ''}`;
  } catch (error) { $('fetch-results').textContent = `${error.message} Manual paste remains available.`; }
  finally { setBusy(false); }
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
    const sources = [...document.querySelectorAll('.source-card')].map(card => ({
      title: card.querySelector('.source-title').value,
      url: card.querySelector('.source-url').value,
      excerpt: card.querySelector('.source-excerpt').value,
      ...card.sourceMeta
    })).filter(source => source.origin === 'fetched' || source.title.trim() || source.url.trim() || source.excerpt.trim());
    const run = await request('/api/runs', { method: 'POST', body: JSON.stringify({ question: $('question').value, sources, mode: $('mode').value }) });
    render(run);
  } catch (error) { $('message').textContent = error.message; }
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
