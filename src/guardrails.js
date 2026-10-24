const injectionPattern = /ignore (all |any )?(previous|prior) instructions|system prompt|developer message|reveal (the |your )?(api key|secret)|send (the |your )?(api key|secret)|override (the |your )?instructions/i;

export function normalizeInput(input) {
  if (!input || typeof input !== 'object') throw new Error('Provide a question and sources.');
  const question = String(input.question ?? '').trim();
  if (!question || question.length > 500) throw new Error('Question must be 1–500 characters.');
  if (!Array.isArray(input.sources) || input.sources.length < 1 || input.sources.length > 8) {
    throw new Error('Provide 1–8 sources.');
  }
  const sources = input.sources.map((source, index) => {
    const title = String(source?.title ?? '').trim();
    const url = String(source?.url ?? '').trim();
    const excerpt = String(source?.excerpt ?? '').trim();
    if (!title || title.length > 200) throw new Error(`Source ${index + 1}: title must be 1–200 characters.`);
    if (!excerpt || excerpt.length > 5000) throw new Error(`Source ${index + 1}: excerpt must be 1–5000 characters.`);
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
    } catch {
      throw new Error(`Source ${index + 1}: enter an http or https URL.`);
    }
    return { id: `S${index + 1}`, title, url, excerpt };
  });
  const mode = input.mode === 'live' ? 'live' : input.mode === 'offline' ? 'offline' : null;
  if (!mode) throw new Error('Choose offline or live mode.');
  return { question, sources, mode };
}

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

export function checkDraft(draft, sources) {
  const issues = [];
  if (!draft || !Array.isArray(draft.findings) || draft.findings.length === 0) {
    issues.push({ type: 'missing_findings', message: 'The draft has no findings.' });
  } else {
    const byId = new Map(sources.map(source => [source.id, source]));
    draft.findings.forEach((finding, index) => {
      const label = `Finding ${index + 1}`;
      if (!String(finding?.claim ?? '').trim()) issues.push({ type: 'empty_claim', message: `${label} has no claim.` });
      const source = byId.get(finding?.sourceId);
      if (!source) {
        issues.push({ type: 'missing_citation', message: `${label} has no valid source citation.` });
      } else {
        const evidence = normalizeText(finding?.evidence);
        if (!evidence || !normalizeText(source.excerpt).includes(evidence)) {
          issues.push({ type: 'unmatched_evidence', message: `${label} evidence is not an exact excerpt from ${source.id}.` });
        }
      }
    });
  }
  for (const source of sources) {
    if (injectionPattern.test(source.excerpt)) {
      issues.push({ type: 'prompt_injection', message: `${source.id} contains instruction-like text. Remove or replace the excerpt before approval.` });
    }
  }
  return { passed: issues.length === 0, issues };
}

export function sourceLooksInstructional(text) {
  return injectionPattern.test(text);
}
