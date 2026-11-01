# Stage 31–35 implementation plan (approved specification, 2026-11-01)

Base: claude/stage29. This is a planning-only branch. No gameplay code changed. Do not merge into main or deploy this branch to Pages before review. Existing public Pages deploy is shared by many branches.

## Confirmed implementation constraints
- Keep current internal spatial/grid resolution. Round 1 km movements, 30 km² island target, reclamation km², and lake–sea land gap to representable internal units; report actual effective values.
- Legacy save import is NOT required; do not delete existing saves.
- Preserve x20 speed as far as practical and measure regression.
- Existing fictional Japan has 49 prefectures. Show this and the fictional-world disclaimer in ONE startup modal, along with detailed save-tab cautions; remove these notices from in-game tabs, including Northern Territories note. No real-world territorial-dispute-based exclusion of site placement.
- Existing era-name selection unchanged. Preserve era-name no-reuse rules.

## Stage 31: onboarding and staged setup
1. Startup modal once per launch with consolidated notices; remove redundant save and island/political notices during gameplay.
2. Initial setup: terrain modifications → era selection → capital/subcapital/palace placement → Route 1 placement → final review. Each step offers Back and Confirm, preserves prior values, and invalidates/rechecks only downstream affected items. Final review can reopen any step.
3. During relocation UI, hide upper-map informational overlays. On-screen skipped-time indicator must express actual real-world elapsed hours (not simulated years), grounded in real measured elapsed time.
4. Tests for back navigation, state retention, cancellation and no unintended sim mutation.

## Stage 32: map placement and viewport
1. Nationwide fit includes all Northern Territories and Okinawa islands.
2. For each of capital, subcapital, palace: prefecture-name selector and adjacent '地図から選択' button. Prefecture choice centers map on its prefectural capital, but user may pan anywhere. Selecting a map point reveals Confirm, Fine adjust, Retry. Fine adjust zooms appropriately and shows four direction arrows around target; each press moves one internal spatial unit approximating 1 km.
3. Ocean click snaps to geometrically closest coast/land among ALL Japanese land regardless of prefecture; show snapped target for confirmation. Actual prefecture name automatically updates from final position.
4. Capital and subcapital MUST be in different prefectures; palace may coincide with either. Existing island placement exclusions must be removed.
5. Confirm accurate coast detection at grid resolution; preserve map pan/zoom controls and test on touch/mobile.

## Stage 33: terrain and freshwater
1. Remove ridgeline menu. Add plain (×0) and lake (×-0.05, visual freshwater is sufficient) to mountain menu.
2. Fuji and Biwa coastal tolerance: sea/coast outranks Fuji (truncate at coastline). Sea/coast outranks Biwa, but retain at least one representable land-cell separation from sea. Other lakes lose to Biwa on contact.
3. Allow mountain raising and lake creation centered on any eligible green/plain cell, using same placement/adjustment UX. Exclude former locations of moved Fuji/Biwa and previously flattened mountain ranges from new creation.
4. Raising: +500m per click up to 1500m, nominal diameter 10× elevation (document actual units); noncircular irregular perimeter with approximately preserved area, deterministic seeded randomness. Lake: +5km diameter per click up to 15km; same irregular-area requirement. Apply Fuji/Biwa collision priorities respectively. New creations remain editable.
5. Add second-class rivers, zoom-dependent rendering of river classes; freshwater styling. Freshwater spans >=3km eligible for bridge/tunnel/route logic, using representable grid threshold.
6. Test shoreline collisions, former-site exclusions, deterministic generation and connectivity.

## Stage 34: islands and reclamation
1. When capital/subcapital/palace is placed on island under nominal 30km², expand island to target area before simulation starts or relocation resumes; never join separate islands.
2. For coastal/island capital and subcapital independently, reclaim nearest coastline at 5km²/year for years 1–50, 0.5km²/year for years 51–100, none years 101–150. Never join islands by land; connections between islands only via bridge/tunnel. No double-counting overlapping reclaimed cells.
3. On relocation stop old-site reclamation, retain reclaimed land, restart new-site schedules. Skipped relocation in unattended automatic mode does not reset schedule.
4. Recompute relevant land/water and route eligibility incrementally. Profile x20 and test save/restore determinism.

## Stage 35: relocation and integration
1. In unattended automatic mode, every 150-year relocation is skipped entirely: no era change, no capital/subcapital/palace move, no Route 0. Returning to manual mode does not catch up skipped relocations; next chance is the next scheduled 150-year boundary (2200, 2350, ...).
2. Manual relocation workflow: era → capital/subcapital/palace → roads → review → save → resume. Apply island enlargement/reclamation logic.
3. Preserve all other existing behavior unless explicitly changed. New saves must work; old save import not required.
4. Regression: Vitest, TypeScript, Playwright, mobile touch pan/zoom, x20 benchmark, 150-year crossings, 49-prefecture selection, new and old terrain interactions.

## Delivery rules
- Implement each stage on separate child branch and draft PR targeting the previous stage, not main; no automatic merges or Pages deploys.
- Keep implementation changes minimal and bounded. Report actual grid size, effective distances/areas, tests, performance, and known limitations.
- First implement Stage 31 only. Do not interpret this planning document as authorization to alter unrelated UI, erase saves, or merge.
