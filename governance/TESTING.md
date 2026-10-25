# Test record

Run both suites from the project root:

```bash
npm test
.venv/bin/python -m pytest sidecar/tests -q
```

The Node tests use temporary run directories and fake sidecar/model responses. The Python tests use HTTPX mock transport and saved HTML, so automated tests need no live search or API key.

| Case | Expected result | Evidence |
|---|---|---|
| Normal live packet | User sources plus gathered snapshots pause at packet review; confirm drafts and output waits for approval. | `test/workflow.test.js`, `test/auto-gather.test.js` |
| Missing citation or unsupported claim | Check fails and approval is blocked. | `test/workflow.test.js` |
| Prompt injection in pasted or fetched text | Source text remains data and release is blocked. | Both Node test files |
| Human rejection | Feedback starts another draft and review. | `test/workflow.test.js` |
| Live model failure or malformed output | Error with no fallback; malformed output retried once. | Both Node test files |
| Fake sidecar and saved snapshot | Fetched text enters the run with hash and reaches pending approval. | `test/improvement.test.js` |
| Sidecar outage | Clear error; no source substitution. | `test/improvement.test.js`, `test/aggregate-review.test.js` |
| Packet review and removal | Gathered snapshots can be removed with a logged event; user sources cannot; empty packet blocks drafting. | `test/aggregate-review.test.js` |
| Offline mode requested | Creation rejected with "Live mode required." | `test/aggregate-review.test.js` |
| Six-source cap | More than six user sources rejected; gathering caps the packet at six total. | `test/aggregate-review.test.js`, `test/auto-gather.test.js` |
| Removed search routes | `POST /api/search` and `POST /api/fetch` return 404. | `test/aggregate-review.test.js` |
| Quote typography | Curly quotes and nonbreaking spaces match valid saved evidence. | `test/improvement.test.js` |
| Private, localhost, or non-HTTP destination | Fetch is blocked before page request. | `sidecar/tests/test_safe_fetch.py` |
| Public redirect to private address | Redirect destination is blocked. | `sidecar/tests/test_safe_fetch.py` |
| Wrong content type or oversized page | Extraction is rejected. | `sidecar/tests/test_safe_fetch.py` |
| `robots.txt` disallow | Page request is not made. | `sidecar/tests/test_safe_fetch.py` |
| Saved HTML fixture | Main text, title, time, and hash are returned. | `sidecar/tests/test_safe_fetch.py` |
| Search and extraction failures | Search returns a clear error; every failed URL is reported. | `sidecar/tests/test_app.py` |

Verified on 2026-10-24: **37 Node tests passed and 9 Python tests passed** (`npm test`, `pytest sidecar/tests`). The Node suites cover `test/workflow.test.js`, `test/improvement.test.js`, `test/auto-gather.test.js`, and `test/aggregate-review.test.js`. A manual local browser run searched for the NIST AI RMF, gathered candidate snapshots automatically, showed each extracted snapshot with final URL, fetch time, and SHA-256 at the review pause, and confirmed the packet through the Planner, Researcher, and Reviewer to `pending_approval`. A final localhost API smoke test repeated real search and fetch, confirmed export returned HTTP **409** before approval, approved a relevant cited draft, and confirmed export returned HTTP **200**. A real live model call was not made because no API credentials were supplied.
