# NIST AI RMF worksheet

This worksheet applies the four [NIST AI RMF 1.0 Core functions](https://airc.nist.gov/airmf-resources/airmf/5-sec-core/) to this prototype. The functions are connected activities: governance applies across mapping, measurement, and management. The [NIST Playbook](https://airc.nist.gov/airmf-resources/playbook/) offers voluntary suggested actions; this worksheet selects controls appropriate to a classroom demo.

| Function | Project-specific answer | Evidence or decision |
|---|---|---|
| **GOVERN** | The project owner maintains the role skills and rules. The human reviewer owns the release decision. No agent can approve itself. | [Rules](RULES.md), separate skills, blocked export endpoint, named approval event. |
| **MAP** | The system serves a single local user preparing a low-stakes research brief from supplied excerpts. Affected people include the researcher and anyone who might later read an exported brief. Inputs are untrusted and may be inaccurate, biased, private, or malicious. | Source packet fields, localhost scope, [risk register](RISK_ASSESSMENT.md), limits in README. |
| **MEASURE** | Check that every finding has a valid source ID and exact evidence quote; screen for obvious instruction-like text; run role review; track status, issues, revisions, and approval events. | `src/guardrails.js`, `src/offline.js`, `test/workflow.test.js`, [test results](TESTING.md). The sample passes; adversarial fixtures fail. |
| **MANAGE** | Block approval on check failures. Let a human reject with feedback and rerun all roles. Keep API failures visible rather than silently switching modes. Release output only after approval. | Orchestrator state transitions, export gate, event history, failure and revision tests. |

## Measurement limits and follow-up

The quote check measures whether evidence appears in the **pasted excerpt**, not whether the webpage actually says it. The offline support check is lexical and can miss subtle overclaims or reject valid paraphrases. A human must compare the draft with the source packet. If this system were deployed beyond a classroom, the owner would add authenticated users, source retrieval and provenance checks, retention settings, stronger prompt-injection evaluation, and monitoring of real user outcomes before expanding scope.
