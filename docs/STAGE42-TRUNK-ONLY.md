# Stage 42 safe separation: trunk railway only

This branch starts from PR #90 (claude/s42-trunk) and ports the capital–subcapital railway duty from PR #93 **without** the deferred Fuji urban population correction (Issue #91).

**Owner decision (2026-11-17):** enlarged/relocated Fuji causing unusually resilient Tokyo–Kanto urban life and mountain tunnels is a desirable exploratory experience; urban shrinkage and road restrictions are on hold. Do not accidentally integrate land.ts uninhabitable, capUninhabitable, or uninhab91 from PR #93.

Includes the rail-trunk candidate and train ferry logic, trunk flag for newly created 1800 games, railway tests, and measurements. Does not yet guarantee Tokyo–Sapporo railway connection; see docs/TRUNK42.md. No main merge, publication, or existing saves modified.

**Cautions:** PR #93 remains Draft; do not publish its combined branch. This isolated PR needs independent CI and save-compat verification. The existing live release is unchanged. Follow-up work on #92 (ceremony UX, immediate intervention) is separate.
