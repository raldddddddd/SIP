# Project description

## Problem and audience

A short research summary can sound authoritative even when its evidence is thin. This prototype helps a student team or small organization see how three bounded AI roles can assemble a brief while preserving human oversight. The intended user is a person who can supply excerpts and inspect the resulting claims. It is for demonstration and low-stakes research support, not autonomous publication or high-stakes decisions.

## What the system does

The user enters a research question and 1–8 sources, each with a title, URL, and pasted excerpt. The Planner identifies evidence needs. The Researcher writes a pending summary and findings, each tied to one source ID and an exact evidence quote. Deterministic checks verify source IDs and quote presence. The Reviewer assesses support and uncertainty. If checks pass, a person reviews the pending draft, then approves or rejects it with feedback. Rejection triggers another full pass. Approval releases a downloadable Markdown brief. Every transition is saved in a local run record.

The three role instructions live in separate `SKILL.md` files and are loaded at runtime. With an OpenAI key, each role makes a distinct structured-output model call. The offline option executes deterministic equivalents for reproducible classroom grading and is visibly labeled as such.

## Human oversight

Approval is required because automatic citation and model review cannot authenticate supplied URLs or guarantee a claim is a fair interpretation. The human sees the source packet, exact evidence quotes, draft, limitations, and reviewer issues before release. A failed check blocks approval. The approval name and time are recorded; the single-user demo does not authenticate the name.
