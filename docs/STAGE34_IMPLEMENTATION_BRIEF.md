# Stage 34 implementation brief — island enlargement and reclamation

Base: claude/stage33 (includes Stage 33 fixes, commit reported 9962f54). Implement in claude/stage34. Stage 33 Draft PR #56. Master plan: docs/stage31-35-implementation-plan.md. This document is an implementation handoff, NOT implemented code.

## Scope
1. On confirming placement of capital, subcapital, or imperial residence, identify island connected component in existing simulation land grid. If island is below nominal 30 km², enlarge to at least 30 km² equivalent BEFORE simulation starts or relocation resumes. Grid is approximately 5km × 5km (25 km² per cell): implement minimal representable enlargement and report actual area (likely 50 km² if initial component is 25 km²), never pretend exact 30 km². Never merge islands. Apply to all three seats.
2. Coastal/island capital and subcapital each get their own reclamation schedule: 5 km² per simulated year for first 50 years, 0.5 km²/year for next 50, none in years 101–150. Independently accrue fractional km² internally, and only convert to grid cells when at least one representable cell can be reclaimed. Preserve fractional remainder; do not round up annually. No reclamation for imperial residence alone.
3. Prevent reclaimed land joining separate islands or creating a land bridge. Existing separate islands may only connect through bridges/tunnels, never by reclaimed land. Coastal reclamation should grow connected land near current capital/subcapital and follow actual coastline and eligibility. If no legal cell exists, preserve budget or explicitly document policy; never silently violate no-merger.
4. Independently track each capital/subcapital budget and elapsed years. Overlapping reclaimed cells are not counted twice. Define deterministic allocation/ownership so two sites cannot double-charge same cell. Reclamation by one site must not silently spend the other's quota.
5. Relocation: stop previous capital/subcapital reclamation, retain all already reclaimed land, begin new site schedules; island enlargement applies at new seat confirmation. In fully unattended automatic mode where relocation is skipped (Stage 35), do not restart the schedules.
6. Update geographic land/water masks, coast and land connectivity, collision/placement, transport bridge/tunnel/ferry candidate classification, and relevant route logic after land changes. Preserve Stage 33 freshwater lake/barrier and Fuji/coast priorities. Avoid land being added over lakes/other protected features.
7. Save/load newly added reclamation budgets, elapsed years, claimed cells, island enlargement and resulting land mask deterministically. Old save compatibility is not required, but NEVER delete old saves or stored data.
8. UI should distinguish nominal and actual representable areas and make reclaimed progress understandable without clutter. Ensure Stage 31 wizard, Stage 32 placement and Stage 33 terrain editing remain usable.

## Tests and acceptance
- Tiny island under 30km² expanded before game/relocation; cannot connect to nearby island, even diagonal/edge adjacency as defined by existing topology.
- Two nearby islands remain distinct under decades of reclamation; no crossing open water by land.
- At year 50/51/100/101 transitions rates are correct, and fractional budget never becomes a whole cell early.
- Capital/subcapital independence, overlap no double counting, relocation stop/start, former land retained.
- 25km² cell area accounting and effective actual enlargement documented.
- Save/restore and deterministic replay match land mask, budgets, seats and route classification.
- Unit tests, TypeScript, build, full E2E, PR CI, mobile-sized touch flows and x20 performance check. Report CI and real Pixel 7a as separate statuses.

## Delivery
Commit only to claude/stage34; use the existing Stage 34 Draft PR targeting claude/stage33. Do not merge, publish Pages, edit shared deployment workflow, or delete saves. Stage 35 relocation wizard and automatic skip are out of scope. Work autonomously and report any unavoidable grid-related constraints and policy decisions explicitly.
