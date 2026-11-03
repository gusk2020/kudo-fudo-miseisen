# Stage 33 implementation brief — terrain editing and freshwater

Base: claude/stage32. Implement in claude/stage33. Parent PR #55, approved master plan docs/stage31-35-implementation-plan.md on claude/stage31-plan. This file is a handoff, not implementation.

## Required
1. In terrain setup/edit UI, remove 稜線 menu. Extend mountain editing with 平野（×0） and 湖化（×−0.05）. Explain resulting terrain in concise Japanese.
2. Existing Fuji and Biwa can be positioned near coast without over-restrictive collision checks. Coast/sea wins over Fuji: clip Fuji at coastline. For Biwa, sea/coast wins but a minimum representable one-cell land barrier must remain. Biwa takes precedence over any other lake; the other lake disappears where contact occurs.
3. Plain green cells are editable as mountain/lake creation centers. Reuse Stage 32 map selection, confirm, fine adjust, retry UI as practical. Only center must be eligible plain; boundaries can intersect other features and must follow collision priorities. Disallow new creation at former Fuji/Biwa sites or sites of other flattened mountain ranges, as explicitly approved.
4. Mountain creation: each press raises elevation by 500m, max 1500m; nominal diameter 10×height (check existing units and document mapping). Make noncircular naturalistic boundary with approximately preserved intended area. New mountains remain editable with same limits.
5. Lake creation: diameter grows by 5km each press, up to 15km; use current grid resolution (~5km), irregular outline preserving nominal area as closely as representable. Freshwater visual appearance sufficient; do not require detailed hydrology. New lakes remain editable with same limits.
6. All mountain–sea and lake–sea collisions obey Fuji/Biwa precedence as applicable. Do not join inland lakes to sea. Existing lakes and rivers should remain coherent after edits.
7. Add second-class rivers, show first/second classes according to zoom; freshwater styling. Freshwater crossing of >=3km nominal counts as bridge/tunnel/ferry candidate; adapt threshold to internal minimum grid resolution and report effective threshold. Avoid inventing second-class rivers as factual geographic datasets; clearly distinguish procedural approximation if source data absent.
8. Protect Stage 31 setup flow and Stage 32 seat selection; existing save/load and simulation behavior should not regress. Legacy saves need not be supported but do not delete them. Do not implement Stage 34 island enlargement/reclamation or Stage 35 relocation skip.

## Validation and delivery
- Inspect existing terrain model, geographic geometry, rendering and transport classification before changing. Identify whether height/diameter units and lake creation are physically representable at ~5km resolution. If user-specified nominal values conflict with grid, implement nearest deterministic representable behavior and report effective values, without pretending exact compliance.
- Unit tests: coastal clipping, one-cell Biwa land barrier, Biwa vs lake, eligibility/exclusions, repeat edit caps, area/irregular shape determinism, freshwater route crossing, zoom-dependent rivers.
- E2E: terrain setup navigation, selection/fine-adjust and terrain edit persistence, seat placement and Route 1 unaffected. Typecheck, build, full unit and Playwright suites, CI. Profile x20 and map responsiveness when feasible.
- Commit only to claude/stage33 and update existing Draft PR #56 (to be created) targeting claude/stage32. Do not merge to main, alter Pages workflow, deploy public site, or erase saves.
- Report implementation status, commit, PR, test and CI outcomes, actual internal grid resolution and representable dimensions, known limits, and Stage 34 handoff.
