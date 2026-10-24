import { createHash } from 'node:crypto';

const injectionPattern = /ignore\s+(all\s+|any\s+)?(previous|prior|above)\s+instructions|system\s+prompt|developer\s+message|(?:system|assistant|developer)\s*:\s*|you\s+are\s+now\s+an?\s+|reveal\s+(the\s+|your\s+)?(api\s+key|secret)|send\s+(the\s+|your\s+)?(api\s+key|secret)|override\s+(the\s+|your\s+)?instructions|exfiltrat(?:e|ion)|run\s+(?:this\s+)?(?:shell\s+)?command/i;

export function normalizeInput(input) {
  if (!input || typeof input !== 'object') throw new Error('Provide a question and sources.');
  const question = String(input.question ?? '').trim();
  if (!question || question.length > 500) throw new Error('Question must be 1–500 characters.');
  if (!Array.isArray(input.sources) || input.sources.length < 1 || input.sources.length > 8) {
    throw new Error('Provide 1–8 sources.');
  }
  const sources = input.sources.map((source, index) => {
    const title = String(source?.title ?? '').replace(/\s+/g, ' ').trim();
    const url = String(source?.url ?? '').trim();
    const excerpt = String(source?.excerpt ?? '').trim();
    if (!title || title.length > 200) throw new Error(`Source ${index + 1}: title must be 1–200 characters.`);
    const origin = source?.origin === 'fetched' ? 'fetched' : 'pasted';
    const limit = origin === 'fetched' ? 6000 : 5000;
    if (!excerpt || excerpt.length > limit) throw new Error(`Source ${index + 1}: excerpt must be 1–${limit} characters.`);
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
    } catch {
      throw new Error(`Source ${index + 1}: enter an http or https URL.`);
    }
    if (origin === 'fetched') {
      const sha256 = String(source.sha256 ?? '');
      const fetchedAt = String(source.fetchedAt ?? '');
      const requestedUrl = String(source.requestedUrl ?? '');
      const actualHash = createHash('sha256').update(excerpt).digest('hex');
      if (sha256 !== actualHash || !Number.isFinite(Date.parse(fetchedAt))) {
        throw new Error(`Source ${index + 1}: invalid fetched snapshot metadata.`);
      }
      try {
        const original = new URL(requestedUrl);
        if (!['http:', 'https:'].includes(original.protocol)) throw new Error();
      } catch { throw new Error(`Source ${index + 1}: invalid original URL.`); }
      return { id: `S${index + 1}`, title, url, excerpt, origin, requestedUrl, fetchedAt, sha256 };
    }
    return { id: `S${index + 1}`, title, url, excerpt, origin, requestedUrl: null, fetchedAt: null, sha256: null };
  });
  const mode = input.mode === 'live' ? 'live' : input.mode === 'offline' ? 'offline' : null;
  if (!mode) throw new Error('Choose offline or live mode.');
  return { question, sources, mode };
}

function normalizeText(value) {
  return String(value ?? '').normalize('NFKC')
    .replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"')
    .replace(/\s+/g, ' ').trim().toLowerCase();
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
