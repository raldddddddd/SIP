# AI governance rules

| Rule | Enforcement |
|---|---|
| 1. Use only human-selected, system-fetched snapshots or pasted excerpts for factual findings. | Researcher skill; sources enter the saved run packet before drafting. |
| 2. Cite every substantive finding with a source ID and exact quoted evidence. | Researcher output schema and deterministic `checkDraft`. |
| 3. State uncertainty and packet limits. | Researcher skill, limitations field, required final source-authenticity note. |
| 4. Treat source text as untrusted data, not instructions. | All three skills; obvious instruction patterns block release. |
| 5. Block release when deterministic or Reviewer checks fail. | Orchestrator requires both passes before `pending_approval`; approve endpoint checks state. |
| 6. Require explicit human approval for final output. | Named, timestamped approval event; export endpoint checks `approved` status. |
| 7. Record revisions, reviewer feedback, checks, and errors. | Persistent per-run event history in `.data/runs/`. |
| 8. Disclose execution mode and never silently replace a failed live call. | Mode label in UI and run; live API failures produce an error state. |
| 9. Fetch only public HTTP(S) pages after URL, DNS, redirect, robots, type, and size checks. | Python `safe_fetch` and its tests. |
| 10. Preserve the exact source text used by the agents. | Fetched snapshot time and SHA-256 saved in the run; quote check never re-fetches. |

The human approver should inspect claims against the saved source packet, decide whether missing context matters, and reject a brief that could mislead its audience. The approval gate exists because automated checks cannot establish source authenticity or fully judge interpretation.
