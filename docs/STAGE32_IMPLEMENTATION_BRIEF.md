# Stage 32 implementation brief — map and seat placement

Base: claude/stage31; branch: claude/stage32. Stage 31 Draft PR #54. Stage 31–35 plan: docs/stage31-35-implementation-plan.md (PR #53). This brief is an implementation handoff, not completed gameplay code.

## Required features
1. Nationwide fit must contain Northern Territories and all Okinawa islands, without clipping. Preserve usable zoom/pan on Pixel 7a portrait and other viewports.
2. In Stage 31 setup step 3 and manual relocation, for each of capital, subcapital, imperial residence, show prefecture name (opens prefecture selector) and adjacent map selection control. Prefecture choice initially centers map at its administrative capital, but map pan/zoom and placement are allowed anywhere on Japanese land, even in another prefecture.
3. After map tap show 決定 / 微調整 / やり直し. Fine adjustment zooms appropriately, places target crosshair with four direction buttons, and shifts one current internal spatial unit per tap (approximately nominal 1 km; do NOT replace grid engine). Explicitly show final target and resulting prefecture.
4. Ocean tap: snap to globally nearest Japanese land, not just within chosen prefecture, using straight-line distance on the existing map geometry. Recompute actual prefecture from final land position; update name accordingly. Avoid a fake visual-only snap: persisted coordinates and simulation use same point.
5. Capital and subcapital must be in different prefectures. Imperial residence may share prefecture/point. No additional minimum distance or politically motivated territorial exclusion. All Japanese islands including Northern Territories, Takeshima, Senkaku, Iwo Jima eligible if represented by current model.
6. If an island under nominal 30 km² is selected, DO NOT implement expansion yet (Stage 34). Clearly preserve placement and document deferred enlargement; no invisible area mutation in Stage 32.
7. Keep Stage 31 wizard navigation, selection persistence, final review, relocation handling, saved games and existing manual/automatic gameplay intact.
8. Use current internal smallest unit for movement and area. Document actual spatial resolution and edge cases. No legacy save compatibility requirement; never delete saves.

## Delivery
- Implement on claude/stage32 only. Do not merge to main or other branches, do not deploy or modify Pages workflows. Avoid modifying shared deployment.
- Add tests for all placement routes, global nearest-land snap (including across prefecture), prefecture label update, different-prefecture validation, seat overlap, viewport coverage, fine adjust, back/confirm/retry, touch pan/zoom, wizard and relocation integration.
- Run typecheck, unit tests, build, Playwright, inspect CI and fix failures. Profile where global nearest-land queries are expensive.
- Create a Draft PR targeting claude/stage31 and report URL, commit, changes, tests, mobile emulation vs Pixel 7a real-device status, unresolved limitations and Stage 33/34 handoff.
- Work autonomously to completion; ask only if a blocking conflict cannot be resolved safely.
