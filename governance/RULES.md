# AI governance rules

| Rule | Enforcement |
|---|---|
| 1. Use only supplied excerpts for factual findings. | Researcher skill; no browsing tool or URL fetch; offline role extracts from packet. |
| 2. Cite every substantive finding with a source ID and exact quoted evidence. | Researcher output schema and deterministic `checkDraft`. |
| 3. State uncertainty and packet limits. | Researcher skill, limitations field, required final source-authenticity note. |
| 4. Treat source text as untrusted data, not instructions. | All three skills; obvious instruction patterns block release. |
| 5. Block release when deterministic or Reviewer checks fail. | Orchestrator requires both passes before `pending_approval`; approve endpoint checks state. |
| 6. Require explicit human approval for final output. | Named, timestamped approval event; export endpoint checks `approved` status. |
| 7. Record revisions, reviewer feedback, checks, and errors. | Persistent per-run event history in `.data/runs/`. |
| 8. Disclose execution mode and never silently replace a failed live call. | Mode label in UI and run; live API failures produce an error state. |

The human approver should inspect claims against the supplied source packet, decide whether missing context matters, and reject a brief that could mislead its audience. The approval gate exists because automated checks cannot establish source authenticity or fully judge interpretation.
