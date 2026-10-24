# Test record

Run `npm test` from the project root. The automated tests use temporary run directories and a stubbed live API; they need no credentials or network access.

| Case | Expected result | Automated test |
|---|---|---|
| Normal offline packet | Plan, draft, review pass; final output waits for approval; approved brief includes citations. | `offline workflow plans, checks...` |
| Missing citation | Deterministic check fails and approval is blocked, even if Reviewer says pass. | `missing citation blocks approval...` |
| Unsupported claim | Offline Reviewer flags a claim unrelated to quoted evidence. | `unsupported claim is caught...` |
| Prompt injection | Obvious instruction text in an excerpt is treated as data and blocks release. | `instruction-like source text...` |
| Human rejection and revision | Feedback causes a new draft and review; approval is possible only afterward. | `human rejection triggers...` |
| Premature final output | Rendering final output before approval throws. | Included in normal workflow test. |
| Live API failure | Run stays in live error state; no offline draft is substituted. | `live API failure remains an error...` |
| Runtime skill and API shape | Planner skill is loaded and structured-output request is sent. | `role skill files are loaded...` |

Verified on 2026-10-24 with Node.js 26: **7 tests passed, 0 failed**. Live calls to OpenAI were not made because no API credentials were supplied; the HTTP behavior was tested with a stub. Manual browser smoke check: load the sample, inspect pending draft and source packet, reject with feedback, approve the revised result, and download the brief.
