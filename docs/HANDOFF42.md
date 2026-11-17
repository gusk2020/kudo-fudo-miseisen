# Stage 42 handoff (2026-11-17): the owner's final batch (Issues #86, #87, #88)

Read with Issue #78/#86/#87/#88 and HANDOFF41C.md. **GitHub facts win over this file.** Nothing merged to main, nothing made Ready, no force-push, **no Pages update** (live = 9e0a8c8, docs/PAGES-RELEASE41.md). PR #73 (rail V2) is in none of these branches. No other repository changed.

## Branch stack (each on top of the one before; all pushed; base = `claude/s41-integration` 9e0a8c8, the live version)
| branch | content | state |
|---|---|---|
| `claude/s42-seats` | #88-2 seat bug fix; #88-3 night grain-size slider | done, tested |
| `claude/s42-special60` | #87 sixty symbols, six fixed years, signs, embedded fonts | done, tested |
| `claude/s42-era86` | #86 era names / policy apart | done for 1800-start games, tested |
| `claude/s42-islands` | #88-1 no long/remote island links planned before 2000 | done, measured, tested (PR #89 = this stack) |
| `claude/s42-fast` | #88-4 decade mode; long-run probe and data | done (mode), measured to 2800 (docs/LONG42.md) |
| `claude/s42-trunk` | capital↔sub-capital by mode: measure + data + builder design | measure only (docs/TRUNK42.md) |
Because they are stacked, the top branch contains everything: a publish candidate is the top of the stack after CI is green.

## Stage 1 — seat bug (Issue #88-2): FIXED
- **Reproduced exactly** (E2E, before the fix): at a relocation, sub-capital tapped at A and palace at B in 札幌県 → both markers at B.
- **Cause**: `apply2200` (`event2200.ts`) replaced the same-year move of the prefecture when a second role was set in it, so the 県庁所在地 went to the point given last; and after a relocation the markers of capital/sub-capital were drawn at the prefecture's 県庁所在地 (`App.seatPoints`), not at the role's own point. The setup screen before a game starts was already correct (tested both orders).
- **Fix**: the second seat of a prefecture in one relocation is an `extra` move (as at game start: the first keeps the 県庁所在地, the second keeps its own point); markers use `sim.capitalPos / subPos / subPos2 / palace.pos`. Stored positions of existing saves are not rewritten.
- Tests: `tests/unit/seat88.test.ts` (2), `tests/e2e/seat88.spec.ts` (setup, both orders; relocation with touch, close, reload). Islet/coast snapping code untouched.
- Not done: nothing in the simulation uses the sub-capital's own point for routing (roads still aim at the prefecture's 県庁所在地, by the Stage 20 design).

## Stage 5 — night grains (Issue #88-3): DONE
`src/render/night.ts`: slider 0–100 in レイヤー (shown while the night view is on). 100 = the continuous glow (default, as before); below, the same light field is drawn as grains (≤5 per 5 km cell by brightness, fixed pseudo-random places, radius 0.35→3.2 km, never under 0.9 px on screen, cap 26,000). Display only; remembered in localStorage. Measured (software GL): 10,038 grains, slider redraw+render ≈ 0.6–0.8 s — **unknown on a real Pixel 7a**; if slow, lower `GRAIN_MAX_DOTS`.

## Stage 4 — sixty special routes (Issue #87): DONE (core), details
- `SPECIALS60` by code point; `FIXED_YEARS` 2200 ♨ / 3300 ♥(ハート) / 4400 ꧅ / 5500 ⌬ / 6600 𓃀 / 7700 ꙮ; 7600 = ∞ U+221E. New games: `sim.special60`. Games made by the live build (13-symbol list, `special41` only) keep their list and order.
- Rule: in a fixed year the fixed symbol is built; other years take the first unused ordinary symbol in order (skipped ones carry over; fixed ones are never given out elsewhere). **Decided here** (owner left it open): a fixed symbol whose year passed without building is not carried over.
- "Previous must be complete" now means the special route made last (`lastSpecial`).
- Map signs show the symbol (they showed "0" before for A号 etc. — a bug of the live build).
- Fonts: 43 tiny woff2 subsets (27 KB, SIL OFL 1.1; `src/assets/fonts41/`, `LICENCE.md`, `tools/build_symbol_fonts.py`), family `KfmSym` last in the font stacks. Headless Chromium without those scripts draws **59 of 60**; U+21A04 𡨄 (5400) has no font found → shows the reading ナン where the device has no glyph. `isDoubleCenturyYear` / `isQuadYear` exist for the future boom-year idea; **no event is implemented**.
- Tests: `special41.test.ts` (10), `glyph87.spec.ts`.

## Stage 3 — eras (Issue #86): DONE for new 1800 games — see docs/ERA86.md
**Open point for the owner**: the 14 昭和時候補 have no verified reading, so they are listed but not selectable, and the 1900s relocation offers generated names. A source for the readings switches them on.

## Stage 6 — remote islands before 2000 (Issue #88-1): rule written
`islandlink37.ts`: `earlyLinkBlock` — a fixed island link may be PLANNED in 1900–1999 only if its gap ≤ 12 km and both shores are within 60 km of a mainland (land mass ≥ 15,000 km²). From 2000 the old rules. Existing/under-way links are not touched. The strait planner between mainlands (`crossing.ts`) is unchanged.

## NOT DONE (in the owner's order)
- **Stage 2** capital ↔ sub-capital in all four modes: MEASURED (rail is the gap: under road/sea priority 東京–大阪 has no rail link even in 2050; 東京–札幌 never), builder designed in docs/TRUNK42.md, **not implemented**. Original notes: Entry points: `planning.ts` (rail/road candidates), `hubs.ts` (ports, airports, routes), `ferry.ts`. Idea: a yearly "trunk duty" that, for each capital–sub pair, checks per mode whether a path exists (road graph, rail graph, sea route between ports reachable by land, air route between airports reachable by land) and, if not and the technology exists, raises the priority of exactly one missing piece (never free construction).
- **Stage 7** decade mode DONE; 1000-year run measured (≈5 min in node to 2800, save 4.6 MB; `numreg` grows fastest — compact it next). See docs/LONG42.md.
- **Stage 8** northern places (design in NORTH41.md: gated place set).
- **Stage 9** shared data: `kfm.region.v1` exists (SHARED-DATA41.md); nothing new.

## Before publishing (needs the owner's approval)
Top of the stack green in CI → `tools/compat-check.mjs dist-9e0a8c8-build new-build` → frozen branch `claude/release-pages-<sha>` → `pages.yml`. Rollback branch of the live version: `claude/release-pages-9e0a8c8`.
