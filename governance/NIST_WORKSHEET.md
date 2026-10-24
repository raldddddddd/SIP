# NIST AI RMF worksheet

This worksheet applies the four [NIST AI RMF 1.0 Core functions](https://airc.nist.gov/airmf-resources/airmf/5-sec-core/) to this prototype. The functions are connected activities: governance applies across mapping, measurement, and management. The [NIST Playbook](https://airc.nist.gov/airmf-resources/playbook/) offers voluntary suggested actions; this worksheet selects controls appropriate to a classroom demo.

| Function | Project-specific answer | Evidence or decision |
|---|---|---|
| **GOVERN** | The project owner maintains the role skills and rules. The human reviewer owns the release decision. No agent can approve itself. | [Rules](RULES.md), separate skills, blocked export endpoint, named approval event. |
| **MAP** | The system serves a single local user preparing a low-stakes brief from human-selected fetched pages or pasted excerpts. Search results, web pages, and excerpts are untrusted. Risks now include SSRF, prompt injection, changing pages, search blocking, and poor extraction. | Search selection UI, sidecar fetch boundary, saved snapshot fields, [risk register](RISK_ASSESSMENT.md). |
| **MEASURE** | Check destination addresses, redirects, robots rules, file type, and size before extraction; record snapshot time and hash. Check every finding's source ID and quote against saved text; screen for obvious instruction text; track review and approval events. | `sidecar/safe_fetch.py`, `src/guardrails.js`, Node and Python [test results](TESTING.md). |
| **MANAGE** | Fail a selected URL visibly rather than silently omitting it. Keep pasted sources available when the sidecar is down. Block approval on check failures, support human rejection and rerun, and never silently replace a failed live model call. | Per-URL fetch outcomes, orchestrator states, export gate, event history. |

## Measurement limits and follow-up

The quote check measures whether evidence appears in the **saved snapshot or pasted excerpt**, not whether the full source proves the claim. The hash detects changes to saved fetched text; it does not authenticate the publisher. The offline support check is lexical and can miss subtle overclaims or reject valid paraphrases. A human must compare the draft with the source packet. If deployed beyond a classroom, the owner would add authenticated users, stronger DNS pinning and provenance controls, retention settings, prompt-injection evaluation, and monitoring before expanding scope.
