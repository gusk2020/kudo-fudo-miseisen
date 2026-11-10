# Stage 31-35 audit: results (branch claude/stage31-35-audit, Draft PR #59)

Base: claude/stage35 (a6c9e83). Emulation vs. real device: everything below ran in headless Chromium (Pixel 7 emulation, software GL) and in node. **Nothing was run on a physical Pixel 7a.**

| # | concern | severity | reproduced? | result |
|---|---|---|---|---|
| 1 | a real seat move that lands on the **same 5 km cell** does not restart that seat's reclamation schedule | medium | **yes** (unit test failed before the fix) | **fixed**: a site records `epoch` = how many relocation events had moved its role; a move that changes the epoch ends the old site and starts a new one. Choosing the default prefecture again with no point is no longer counted as a move (`apply2200`). Tests: 3 in `stage35.test.ts` ("audit") |
| 2 | relocation wizard Back, snapshot restore, save / reload mid-wizard | medium | exercised, **no defect** | covered by `mobile35.spec.ts`: reload in stage 1 (event stays open, clock stopped, wizard restarts at stage 1); Back from the road stage restores the snapshot and keeps the choices; Back with the stored snapshot **deleted** shows the message and stays on the road stage with nothing half-applied; review Back works |
| 3 | population cap / forecast after reclamation | info | measured | `capPop` of an islet seat = the islet's **real** area x 2,500 people/km2 and is **identical with and without** island enlargement (e.g. 波照間島 12.8 km2 -> 32,000 both ways, grid area 50 km2). Reclaimed land adds grid cells but no capacity. **Not changed** (balance decision); see "for decision" |
| 4 | E2E instability in CI | medium | partly | the earlier CI failures were test-side (policy window left open over the menu, async checkpoint list, reload before save). Repeated 36 runs of the 12 relocation / save / mobile tests locally: 36 / 36 passed. CI for e9ce9a7: both runs passed. Not proven gone for good (CI is ~2x slower than this machine) |
| 5 | x20 performance | medium | **measured** | see below |
| 6 | **saves shared with another Pages site** (found while preparing the playtest) | **high for publishing** | verified by reading + in a browser | browser storage is per origin; all `<owner>.github.io/<repo>/` sites share one. **Fixed**: `VITE_SAVE_NS` gives a build its own database and localStorage keys; the normal build keeps every old name (checked in a browser) |
| 7 | `pages.yml` can overwrite the public site | high | by reading | not changed (out of scope); see `docs/PLAYTEST_PUBLISHING_PROPOSAL.md` |
| 8 | old 2200-specific comments in `event2200.ts` | low | read | the fixed years are only in comments / test fixtures; the schedule is `relocFirst` (start year + 150) everywhere in the logic |

Not changed on purpose: the relocation candidate order (`n` counts opened events only; `stage35.test.ts` asserts it).

## x20 performance (reproducible)
`PERF35=1 PERF35_OUT=<file> npx vitest run tests/unit/perf35.test.ts` — seed 5, 25 simulated years from 1950, fully automatic policy, 4 runs per variant in one node process (node 22). Measured on this machine:

| variant | min / median / max |
|---|---|
| without reclamation (Stage 33 behaviour) | 6587 / 7148 / 7967 ms (288 ms per simulated year) |
| with reclamation (Stage 34/35) | 8564 / 9733 / 10102 ms (373 ms per simulated year) |

**A real cost**: about +35 % while reclamation is running (the first 100 years of each seat's life). Cause isolated: with the cache reset after each filled cell switched off, the two variants are equal (6602 vs 6731 ms median), so the cost is the rebuilding of the world-keyed memos (sea grid, nearest-sea distances, hubs, reference grids, ...) at each of the ~10 fills in 25 years, ~0.26 s each. It is a hitch of about a quarter of a second every few game years, not a slowdown of every step. Not optimised: skipping a memo is only safe if it provably does not depend on the coastline, and the quick check (cached vs. rebuilt values) was not conclusive for most of them. Options for a decision: (a) accept; (b) invalidate only the sea / coast memos after a fill (needs a per-memo review); (c) apply fills in batches every N years.
This is node CPU time, not a phone.

## For decision (nothing was changed)
1. Should an enlarged / reclaimed island raise its seat city's population cap (now: no)?
2. The reclamation cache cost above: accept, or approve the per-memo review?
3. Playtest publishing: see the proposal (needs your approval to create a repository).

## Tests added
`stage35.test.ts` (3, concern 1), `mobile35.spec.ts` (2 touch flows), `ns35.test.ts` (3, storage namespace), `perf35.test.ts` (benchmark, skipped unless `PERF35`).
