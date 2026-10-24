# Risk assessment

Likelihood and impact are qualitative for this single-user demo: Low, Medium, or High. Residual risk is what remains after the listed control. The project owner is responsible for maintaining code and prompts; the human reviewer is responsible for the release decision.

| Risk | Likelihood / impact | Control and response | Residual risk / owner |
|---|---|---|---|
| Unsupported or overstated claim | Medium / High | Exact evidence quote, valid citation ID, Reviewer support check, human review; block failed checks. | Medium / human reviewer |
| Fabricated or misleading source title/URL | Medium / High | Distinguish pasted sources from fetched snapshots; record final URL, fetch time, and text hash; show the packet. | Medium / human reviewer |
| Prompt injection in an excerpt or web page | High / High | Skills treat all source text as data; deterministic pattern check blocks obvious instruction text; human inspects packet. | Medium / project owner |
| Sensitive data disclosure through a live API call or saved run | Medium / High | Keep key server-side, disable response storage in API request, bind localhost, owner-only run files, input warning. | Medium / project owner |
| Biased or incomplete source selection | High / Medium | Planner lists evidence needs; final brief states packet limits; reviewer and human assess gaps. | Medium / human reviewer |
| Mistaken human approval | Medium / High | Pending label, visible evidence and issues, named timestamped approval, reversible revision before approval. | Medium / human reviewer |
| Live model outage or invalid response | Medium / Low | Stop in error state and record it; never silently use offline output. | Low / project owner |
| SSRF through a selected URL or redirect | Medium / High | Allow only HTTP(S) on standard ports; reject non-public DNS/IP results on each redirect; localhost-only service. | Medium / project owner |
| Source drift after retrieval | High / Medium | Store exact extracted text, final URL, time, and SHA-256; check quotes against that snapshot. | Low / project owner |
| Search rate limit or blocking | Medium / Low | Show explicit error; preserve manual paste path. | Low / project owner |
| Unreliable extraction or missing context | High / Medium | Limit formats and size; report thin extraction as failure; show snapshot for human inspection. | Medium / human reviewer |

These ratings are design judgments, not measured probabilities. DNS can change between validation and connection, so the SSRF control is incomplete. The prototype does not authenticate reviewer identity or independently authenticate publishers; it must not be exposed as an unattended public service.
