# Project description

## Problem and audience

A short research summary can sound authoritative even when its evidence is thin. This prototype helps a student team or small organization see how three bounded AI roles can assemble a brief while preserving human oversight. The intended user is a person who can add their own source links and excerpts, review what the agent gathers, and inspect the resulting claims. It is for demonstration and low-stakes research support, not autonomous publication or high-stakes decisions.

## What the system does

The user enters a research question and may add source links and pasted excerpts of their own. The Planner proposes search queries; the Python sidecar searches the web and fetches candidate snapshots automatically. The user then reviews the aggregated packet — their own sources plus the agent-gathered snapshots (each with final URL, fetch time, and text hash) — and can remove any snapshot they do not trust before drafting begins. The Researcher writes a pending summary and findings, each tied to one source ID and an evidence quote. Deterministic checks verify source IDs and quote presence against the saved snapshot. The Reviewer assesses support and uncertainty. If checks pass, a person approves or rejects the draft with feedback. Rejection triggers another full pass. Approval releases a downloadable Markdown brief, which discloses which sources were gathered automatically rather than supplied by the user. Every transition is saved in a local run record.

The three role instructions live in separate `SKILL.md` files and are loaded at runtime. Each role makes a distinct structured-output model call through the OpenAI Responses API (env-configurable base URL). The API key stays on the Node server. The browser never receives it.

## Human oversight

Approval is required because automatic citation and model review cannot guarantee that a fetched page, user-supplied link, or pasted excerpt is complete, authentic, or fairly interpreted. The human reviews the aggregated source packet before drafting, sees exact evidence quotes, draft, limitations, and reviewer issues before release. A failed check blocks approval. The approval name and time are recorded; the single-user demo does not authenticate the name.
