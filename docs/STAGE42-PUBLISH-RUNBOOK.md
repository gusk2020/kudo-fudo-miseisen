# Stage 42 trial — verified state, safe publication procedure, comparison and recovery

Status (see the PR #98 description for the latest CI): **ready to publish up to the last click; NOT published.** Nothing in this document or its workflow changes GitHub Pages by itself. The decision to publish is the owner's.

## 1. What the trial contains (fixed)
PR #98 branch = PR #97 = PR #94 stack: Stage 42 **without** PR #93 (Fuji population suppression), PR #96 (樺太), PR #99 (千島). The Showa readings stay option A (owner's decision, recorded in ERA86.md / Issue #86).

## 2. The live site, verified (2026-11-19, read from the live URL, not assumed)
- Latest Pages deployment (Actions run 43968282120, `workflow_dispatch` by the owner, 2026-11-16 22:15–22:36 UTC, success): head `9e0a8c805f29af18e8cf018254832d79573aa5c7`, branch `claude/release-pages-9e0a8c8`.
- **Byte comparison**: Stage 41 rebuilt from `9e0a8c8` (`BASE_PATH=/kudo-fudo-miseisen/ npm run build`) against the live URL, file by file: **13 of 13 files byte-identical** (`index.html` sha256 `562e9eb3…db307`; the 7 files `index.html` references plus the 6 lazy chunks / worker / DEM). So the recorded commit IS what is live, and the build is reproducible.
- `https://gusk2020.github.io/kudo-fudo-miseisen/stage42/` returns 404 now (not published).

## 3. Why a separate path is not enough, and what keeps the saves apart
GitHub Pages serves all of an account's project sites from one origin (`gusk2020.github.io`); IndexedDB and localStorage belong to the origin, not the path. The trial is built with `VITE_SAVE_NS=stage42trial`, so it uses the database `kfm-stage1-stage42trial` and localStorage keys `kfm-stage42trial.*`; the real game keeps `kfm-stage1` and `kfm.*`.
**A leak was found and fixed while checking this**: one key, `kfm.polSimple` (the simple-intervention switch), had been written as a bare string and so bypassed the namespace — the trial would have read and overwritten the real game's setting. It now goes through `lsKey()`; `tests/unit/storagens.test.ts` fails if any storage name is written as a bare literal again, and the package workflow greps the built bundle for the same.
**Consequence for players**: the trial cannot see Stage 41 saves (by design) — it starts a new game. The "Stage 41 → Stage 42 save compatibility 16/16" gate (PR #97) tests the other case (replacing the game at the SAME names); it stays as the safety net for a later real update, and passes, but is not what protects the real game while the trial is beside it. That protection is the isolation check below.

## 4. Checks (all run by CI on PR #98's branch, `stage42-preview-package.yml`)
1. Build pinned Stage 41 (`9e0a8c8`) at `/kudo-fudo-miseisen/`, Stage 42 at `/kudo-fudo-miseisen/stage42/` with the namespace; assemble the composite site; the Stage 41 root must not mention `/stage42/`.
2. **Rebuilt Stage 41 root vs the live site**: every file fetched (read-only GET) and compared; any difference fails the job.
3. **No bare storage names** in the Stage 42 bundle.
4. **`tools/isolation-check.mjs`** (real Chromium, one origin, both paths): the real game saves; the trial must start without that save, play and save under its own names; afterwards the real game's IndexedDB + localStorage must be **byte-identical** and it must still load its save. Run locally three times: **10/10 each**; with the namespace removed the check fails ("the trial does NOT see the real game's save") — the negative control that shows the check can fail.
5. Regular CI (type check, unit, E2E) and the Stage 41→42 same-name compatibility gate (16/16) on PR #97 / #98.

## 5. Publication procedure (needs the owner's explicit OK; nothing here has been run)
1. Freeze: create branch `claude/release-pages-stage42trial-<PR#98 head sha>` from PR #98's head, whose `.github/workflows/pages.yml` is replaced by `docs/playtest/pages-stage42-trial.yml` (below). It has only `workflow_dispatch`; creating the branch deploys nothing (the push list of the repo's normal `pages.yml` does not include it).
2. Owner: GitHub → Actions → "Pages" → Run workflow → branch `claude/release-pages-stage42trial-…`. The job (a) rebuilds Stage 41 from the pinned commit and Stage 42 with the namespace, (b) refuses to continue unless the rebuilt Stage 41 root equals the live site byte for byte, the bundle has no bare keys and the isolation check passes, (c) deploys ONE site: Stage 41 at the root, unchanged, plus `/stage42/`.
3. After deployment: compare again (the same byte comparison against the live URL; the root must still equal `562e9eb3…` for `index.html` and every other Stage 41 file; `/stage42/` must answer 200), then open `/stage42/` once on a phone.
## 6. Recovery
- Remove only the trial: run "Pages" on **`claude/release-pages-9e0a8c8`** (the frozen Stage 41 branch: exactly the previous site, no `/stage42/`). The same URL returns to the previous state. Nothing is deleted from any browser: the trial's saves live under their own names and simply stop being reachable.
- The real game's saves are never touched by either direction (they are byte-identical, checked above).
- Previous generation: `claude/release-pages-8b1de5b`.
## 7. Not verified here
Pixel 7a behaviour (touch, speed, heat) of the trial; the live Pages "environment" branch rules (a deploy from the new branch could be refused by them — then the owner changes that one setting; earlier `claude/**` releases worked); that the CI-built Stage 41 equals the live site on GitHub's runner (the step above checks it on every run; locally it is identical).
