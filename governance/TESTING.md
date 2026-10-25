# Test record

Run all three suites from the project root:

```bash
npm test
.venv/bin/python -m pytest sidecar/tests -q
npm run test:ui
```

The Node tests use temporary run directories and fake sidecar/model responses. The Python tests use HTTPX mock transport and saved HTML. The Playwright browser suite starts `ui-tests/fixture-server.js`, which replaces only external model and search services with controlled responses while exercising the real API, orchestrator, and saved run records. Automated tests need no live search or API key; the application itself remains live-only.

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
| Editorial packet review | Saved sources show provenance, URL, hash, excerpt, removable agent snapshots, and gathering events; confirmation starts drafting. | `ui-tests/workspace.spec.js` |
| Browser approval and export gate | Unapproved export returns 409; named approval releases the final document with automatic-gathering disclosure. | `ui-tests/workspace.spec.js` |
| Browser errors and revision | Gathering and live model failures remain visible; failed review blocks approval; rejection reuses the confirmed packet. | `ui-tests/workspace.spec.js` |
| Restoration and accessibility | URL-hash restoration returns to packet or review stage; keyboard focus follows stages; axe scans cover prepare, packet, review, and approval. | `ui-tests/workspace.spec.js` |
| Responsive layout | No horizontal overflow at 320, 768, or 1440 px through prepare, packet, pending review, failed review, and approved output. | `ui-tests/workspace.spec.js` |

Verified on 2026-10-25: **39 Node tests, 9 Python tests, and 13 browser tests passed**. Browser tests used controlled fixtures, including model failure and search failure; a real external model call was not made. The saved event history and source packet are the evidence for each run's actual transitions, and the release endpoint independently enforces approval.
