import { sourceLooksInstructional } from './guardrails.js';

const stop = new Set('a an and are as at be by for from has in is it of on or that the this to was were with'.split(' '));
const words = text => new Set(String(text).toLowerCase().match(/[a-z]{3,}/g)?.filter(word => !stop.has(word)) ?? []);

function firstUsableSentence(excerpt, question) {
  const sentences = excerpt.match(/[^.!?]+[.!?]?/g) ?? [];
  const candidates = sentences.map(value => value.trim()).filter(value => value.length >= 15 && !sourceLooksInstructional(value));
  const queryWords = words(question);
  candidates.sort((a, b) => {
    const score = value => [...queryWords].filter(word => words(value).has(word)).length;
    return score(b) - score(a);
  });
  return candidates[0] ?? '';
}

export function offlineRole(role, payload) {
  const { question, sources, feedback = '', revision = 0 } = payload;
  if (role === 'planner') {
    return {
      subquestions: [question],
      evidenceNeeds: sources.map(source => `Check what ${source.id} supports and where it is limited.`),
      approach: 'Use only the supplied excerpts and label unanswered points.',
      searchQueries: [question]
    };
  }
  if (role === 'researcher') {
    let findings = sources.map(source => {
      const evidence = firstUsableSentence(source.excerpt, question);
      return evidence ? { claim: evidence, sourceId: source.id, evidence } : null;
    }).filter(Boolean);
    if (revision && /short|concise|brief/i.test(feedback)) findings = findings.slice(0, 2);
    const limitations = ['Only supplied excerpts were assessed; source authenticity and completeness were not independently verified.'];
    if (revision) limitations.push('This revision keeps conclusions limited to the quoted excerpts; a human must decide whether the feedback was fully addressed.');
    return {
      summary: findings.length ? (revision ? 'After human feedback, the supplied excerpts support these bounded findings.' : 'The supplied excerpts provide the following evidence.') : 'The supplied excerpts do not provide usable evidence.',
      findings,
      limitations,
      revisionNote: revision ? `Revision ${revision}: human feedback considered: ${String(feedback).slice(0, 300)}` : ''
    };
  }
  if (role === 'reviewer') {
    const issues = [];
    for (const [index, finding] of payload.draft.findings.entries()) {
      const claimWords = words(finding.claim);
      const evidenceWords = words(finding.evidence);
      const overlap = [...claimWords].filter(word => evidenceWords.has(word)).length;
      if (claimWords.size && overlap / claimWords.size < 0.35) {
        issues.push({ type: 'unsupported_claim', message: `Finding ${index + 1} is not supported by its quoted evidence.` });
      }
    }
    return { passed: issues.length === 0, issues, note: 'Offline review checks lexical support only; a human must assess meaning.' };
  }
  throw new Error(`Unknown role: ${role}`);
}
