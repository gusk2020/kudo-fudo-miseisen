# ChatGPT static audit and Claude handoff (2026-11-04)

Status: source inspection only, no runtime reproduction. Work on claude/stage31-35-audit, Draft PR #59.

## Findings
- .github/workflows/pages.yml deploys a SINGLE GitHub Pages site. Trigger branches stop at Stage 30A and include main; Stage 31–35/audit are not listed. workflow_dispatch exists. Deploying from audit branch can replace the current public site. Do NOT trigger deployment.
- vite.config.ts supports BASE_PATH and defaults to relative paths; build script includes tsc and Vite. This does not establish a live URL.
- event2200.ts nextYear2200 counts opened events plus skipped boundaries; open2200 indexes relocation candidates by actually opened events only. stage35.test.ts explicitly tests first event after a skip has n=0. This may be intentional: do not change candidate order without a clear user decision.
- reclaim34.ts stepReclaim restarts reclamation only when seatCellOf changes. A real seat move that resolves to the same cell may not reset the 100-year budget. Reproduce with valid placements before fixing.
- Stage34's population capacity/forecast after reclamation is not known to update. Check gameplay impact; avoid speculative balance changes.
- event2200.ts has old 2200-specific comments/constants; check whether any are used operationally, clean misleading comments if safe.
- Stage35 saves and migrations should be tested with multiple start years and auto/manual switching.

## Bounded Claude tasks
1. Mobile Pixel 7a-size Playwright touch smoke tests: start wizard, map selection, confirmation, simulation, save/reload, relocation, full-auto skip. Distinguish emulator from physical device.
2. Reproduce or disprove same-cell seat relocation issue, fix if real, add regression test.
3. Check relocation Back and snapshot restoration; save/reload; stale overlays; repeat flaky E2E.
4. Investigate reclaimed land and city cap/forecast, report concrete issue before rebalancing.
5. Benchmark x20 with reproducible method.
6. Prepare GitHub-only playtest publishing proposal that does NOT overwrite existing Pages. A separate preview repository or safe isolated versioned path is acceptable as a PROPOSAL, but obtain authorization before publishing or changing settings. No Cloudflare, Netlify or invented URL.
7. Run typecheck, build, unit, full E2E, CI. Report SHA, reproduction evidence, changes and remaining limitations.

DO NOT merge main, mark Ready, force-push, publish Pages, change Pages workflow/settings, delete saves or create unrelated PR. Continue in existing Draft PR #59.