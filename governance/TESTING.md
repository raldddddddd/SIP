# Test record

Run both suites from the project root:

```bash
npm test
.venv/bin/python -m pytest sidecar/tests -q
```

The Node tests use temporary run directories and fake sidecar/model responses. The Python tests use HTTPX mock transport and saved HTML, so automated tests need no live search or API key.

| Case | Expected result | Evidence |
|---|---|---|
| Normal offline packet | Plan, draft, and review pass; output waits for approval. | `test/workflow.test.js` |
| Missing citation or unsupported claim | Check fails and approval is blocked. | `test/workflow.test.js` |
| Prompt injection in pasted or fetched text | Source text remains data and release is blocked. | Both Node test files |
| Human rejection | Feedback starts another draft and review. | `test/workflow.test.js` |
| Live model failure or malformed output | Error with no offline substitution; malformed output retried once. | Both Node test files |
| Fake sidecar and saved snapshot | Fetched text enters the run with hash and reaches pending approval. | `test/improvement.test.js` |
| Sidecar outage | Clear error; pasted source workflow still runs. | `test/improvement.test.js` |
| Quote typography | Curly quotes and nonbreaking spaces match valid saved evidence. | `test/improvement.test.js` |
| Private, localhost, or non-HTTP destination | Fetch is blocked before page request. | `sidecar/tests/test_safe_fetch.py` |
| Public redirect to private address | Redirect destination is blocked. | `sidecar/tests/test_safe_fetch.py` |
| Wrong content type or oversized page | Extraction is rejected. | `sidecar/tests/test_safe_fetch.py` |
| `robots.txt` disallow | Page request is not made. | `sidecar/tests/test_safe_fetch.py` |
| Saved HTML fixture | Main text, title, time, and hash are returned. | `sidecar/tests/test_safe_fetch.py` |
| Search and extraction failures | Search returns a clear error; every failed selected URL is reported. | `sidecar/tests/test_app.py` |

Verified on 2026-10-24: **15 Node tests passed and 9 Python tests passed**. A manual local browser run searched for the NIST AI RMF, displayed candidate results, fetched a human-selected NIST page, showed its extracted snapshot and SHA-256, and moved that snapshot through the Planner, Researcher, and Reviewer to `pending_approval`. A final localhost API smoke test repeated real search and fetch, confirmed export returned HTTP **409** before approval, approved a relevant cited draft, and confirmed export returned HTTP **200**. A real live model call was not made because no API credentials were supplied.
