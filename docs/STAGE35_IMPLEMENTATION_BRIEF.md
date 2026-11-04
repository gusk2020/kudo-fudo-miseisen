# Stage 35 implementation brief — relocation integration and unattended automatic mode

Base: claude/stage34. Implement on claude/stage35, existing Stage 35 Draft PR. Read docs/stage31-35-implementation-plan.md, Stage 31–34 code and docs/STAGE34.md.

## Manual relocation
- Fixed relocation boundaries 2200, 2350, 2500, ... (every 150 years); never shift calendar on pause/resume.
- Manual mode at eligible boundary pauses progression, opens full Stage 31-style wizard: era → capital/subcapital/imperial residence (Stage 32 map placement, confirmation, adjustment) → route 1 → final review → confirm/save/resume. Retain back navigation and choices, invalidate downstream dependent choices when upstream changes. No simulation advancement until final confirmation.
- Enforce era no-reuse rules and capital/subcapital in different prefectures; imperial residence may overlap; final prefecture inferred from selected location.
- Hide top info while wizard active, as established Stage 31 behavior.
- Stage 34 island enlargement applies before resuming relocation; old reclamation stops, land retained, new capital/subcapital budgets start; preserve existing land and log. Do not reset unrelated world state.
- If paused mid-wizard, save/reload behavior must be defined and tested. Never accidentally resume sim with unfinished relocation.

## Fully unattended automatic mode
- At boundary, completely skip relocation, era change, route 0/route 1 reset and wizard, and keep simulation progressing with no stop. Do not mutate seat identities, era, or restart Stage 34 reclamation.
- Switching from fully unattended auto to manual after skipped boundaries must NOT retroactively trigger relocation; next relocation only at next fixed 150-year boundary. Avoid double-trigger on same boundary when switching mode or loading save.
- Distinguish fully unattended auto from semi-auto and speed multipliers; do not change modes not requested.
- If manual relocation wizard is already active, switching to unattended must not silently discard choices or mutate world; define safe explicit behavior.

## Regression & performance
- Preserve Stage 31 initial setup, Stage 32 placement, Stage 33 terrain and freshwater rules, Stage 34 islands/reclamation and save replay.
- Unit tests for 2200/2350/2500, automatic skipping, manual resumption, boundary reentry, save/load mid-wizard, era uniqueness, seat placement, route selection, reclamation non-reset, no unexpected world reset.
- Typecheck, build, full unit and E2E, CI. Run targeted mobile-size tests and x20 performance benchmark where possible. Report Pixel 7a actual separately, no invented validation.
- Never merge to main, publish Pages, alter shared Pages deployment workflow, delete existing saves, force-push, or mark PR Ready without explicit permission.

Report actual implementation and deviations; no claim of success until tests run.
