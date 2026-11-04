# Stage 31–35 integration audit and playtest preparation

Base: claude/stage35 (reported a6c9e83). Audit-only branch. Do not deploy or merge.

## Priority audit
1. Compare implementation with docs/stage31-35-implementation-plan.md, docs/STAGE33_IMPLEMENTATION_BRIEF.md, docs/STAGE34_IMPLEMENTATION_BRIEF.md, docs/STAGE35_IMPLEMENTATION_BRIEF.md and docs/STAGE35_RELOCATION_ORIGIN_CLARIFICATION.md. Latest user rule overrides older fixed-year text: relocation boundaries = each game's start year + 150*n.
2. Exercise initial wizard, map seat placement, freshwater terrain editing, island enlargement, 100-year reclamation, manual relocation and auto-skip, and save/load across boundaries in a representative end-to-end scenario. Do not infer that existing unit tests cover UI.
3. Check whether ordinary era changes in full auto are distinct from relocation-era change. Do not silently change unrelated era system; report behavior and conflicts.
4. Check relocation wizard Back without snapshot and save/reload mid-wizard. Repair reproducible user-facing failures with focused tests.
5. Inspect reclaimed island/population cap and forecast updates for game-impacting inconsistency; report and prioritize, avoid unapproved balancing changes.
6. Check 25 km² grid approximation, no island merging, freshwater precedence, reclaimed cells and route/cache recomputation. Report deferred reclamation budget if no legal cells and verify behavior.
7. Investigate previously flaky E2E around menus, overlays, async checkpoint loading. Repeat targeted tests to detect recurrence; don't claim root cause unless demonstrated.
8. Validate mobile-sized touch interactions (Pixel 7a actual device unavailable) and x20 performance with reproducible baseline and variance. Distinguish emulation from real device.
9. Prepare a **non-deploying** GitHub Pages playtest plan: identify current deployment workflow and protected production URL, branch/preview limitations, minimal safe options for user approval. DO NOT publish, alter pages.yml, merge main, or overwrite existing public site.
10. Provide prioritized findings with severity, reproduction, fixed/unfixed, test evidence, commit SHA, CI status. If safe, implement bounded bug fixes on this audit branch, preserve Stage 31–35 behavior, and report each change. Do not mark Ready or force-push.

## Required validation
Typecheck, build, all unit tests, full E2E, PR CI; mobile viewport flows; deterministic save/replay; x20 performance. Clearly identify untested portions and avoid claiming verified playability without an actual accessible URL and device test.
