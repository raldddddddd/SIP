# Risk assessment

Likelihood and impact are qualitative for this single-user demo: Low, Medium, or High. Residual risk is what remains after the listed control. The project owner is responsible for maintaining code and prompts; the human reviewer is responsible for the release decision.

| Risk | Likelihood / impact | Control and response | Residual risk / owner |
|---|---|---|---|
| Unsupported or overstated claim | Medium / High | Exact evidence quote, valid citation ID, Reviewer support check, human review; block failed checks. | Medium / human reviewer |
| Fabricated or misleading source title/URL | Medium / High | Label sources as user supplied; never claim URL was fetched; show full packet and limitation in output. | High / human reviewer |
| Prompt injection in an excerpt | Medium / High | Skills treat excerpts as data; deterministic pattern check blocks obvious instruction text; human inspects packet. | Medium / project owner |
| Sensitive data disclosure through a live API call or saved run | Medium / High | Keep key server-side, disable response storage in API request, bind localhost, owner-only run files, input warning. | Medium / project owner |
| Biased or incomplete source selection | High / Medium | Planner lists evidence needs; final brief states packet limits; reviewer and human assess gaps. | Medium / human reviewer |
| Mistaken human approval | Medium / High | Pending label, visible evidence and issues, named timestamped approval, reversible revision before approval. | Medium / human reviewer |
| Live model outage or invalid response | Medium / Low | Stop in error state and record it; never silently use offline output. | Low / project owner |

These ratings are design judgments, not measured probabilities. The prototype does not authenticate reviewer identity or verify URLs; it must not be used as an unattended publishing tool.
