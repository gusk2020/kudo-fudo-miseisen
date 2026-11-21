# Stage 43 trial — independent playtest at /stage43/: checks, publication, recovery

The Stage 43 trial (PR #100, Draft) is published BESIDE the two sites that are live now, without touching them:

| path | what | built from | storage |
| --- | --- | --- | --- |
| `/kudo-fudo-miseisen/` | Stage 41 (the real game) | `9e0a8c805f29af18e8cf018254832d79573aa5c7` | `kfm-stage1`, `kfm.*` |
| `/kudo-fudo-miseisen/stage42/` | Stage 42 trial | `2fc9922dc4297238efa32f79dce4247aeedae466` (`VITE_SAVE_NS=stage42trial`) | `kfm-stage1-stage42trial`, `kfm-stage42trial.*` |
| `/kudo-fudo-miseisen/stage43/` | **Stage 43 trial (new)** | the frozen release branch (`VITE_SAVE_NS=stage43trial`) | `kfm-stage1-stage43trial`, `kfm-stage43trial.*` |

All three share one origin (`gusk2020.github.io`), so the storage names are what keep the saves apart. The trial starts a new game; it cannot see Stage 41 or 42 saves (by design).

## Guards (run by `stage43-preview-package.yml` on every push to PR #100, and again inside the publish workflow before anything is uploaded)
1. **`tools/stage43-assemble.sh`**
   - Checks every file the live site lists in its own `deployed-sha256.txt` (26 files: Stage 41 root and `/stage42/`) against the live URL, then requires the rebuilt Stage 41 and Stage 42 to reproduce each one **byte for byte**.
   - Requires that **nothing else exists outside `/stage43/`**. The two root record files are kept exactly as live.
   - Requires that neither older `index.html` mentions `/stage43/`, and that the Stage 43 bundle uses `stage43trial` with no bare storage names.
   - Writes this deployment's record to `/stage43/deployed-sha256.txt` and `/stage43/deployed-note.txt`.
   - Negative tests: one changed byte in a Stage 41 file is refused; one extra root file is refused.
2. **`tools/isolation-check3.mjs`** (real Chromium, one origin, all three paths). Stage 41 plays and saves, then Stage 42, then Stage 43, in one browser profile. The checks:
   - each later site starts without a game;
   - each saves only under its own names;
   - every `kfm` localStorage key belongs to exactly one prefix;
   - after each later site, the older sites' storage is byte-identical;
   - finally each site reloads its own game with no page errors.
   - Negative control: a Stage 43 build without its namespace fails ("starts WITHOUT a game" — it opened Stage 41's save).
3. **`tools/stage43-trial-check.mjs`** (the `/stage43/` build, Pixel 7 size, new 1800 game, 空路重視・地方分散). It checks:
   - the Stage 43 rules flags and the north towns;
   - the one-line policy display, the hidden title and the folding speed panel;
   - the layer window (3 groups, 8 rows with samples, one row switching one layer);
   - the moon button and its slider;
   - the 1900 special line drawn 千葉→東京→大阪→神戸, accepted and built to both outer ends;
   - the decade mode advancing;
   - flights at 2000 (every airport served, lifeline local routes, both tiers drawn);
   - reload, and no page errors.
4. Regular CI (type check, unit, E2E) on PR #100 and the Stage 41 → Stage 43 same-name save compatibility check (`tools/compat-check.mjs`, 16/16).

## Publication
1. Freeze: branch `claude/release-pages-stage43trial-<sha>` from PR #100's head, with `.github/workflows/pages.yml` replaced by `docs/playtest/pages-stage43-trial.yml`.
   - That workflow is `workflow_dispatch` only, so creating the branch deploys nothing.
2. Run "Pages" on that branch. The job builds the three sites, runs guards 1–3, and only then uploads ONE site.
3. After deployment, verify:
   - every file listed in the root `deployed-sha256.txt` is byte-identical on the live URL;
   - `/stage43/` answers 200 and loads without console errors;
   - the isolation check runs again against the live URLs (read-only use of a fresh browser profile).

## Recovery (rollback)
- **Remove only Stage 43, keep 41 and 42 exactly:** run "Pages" on `claude/release-pages-stage42trial-163f079`. That is the branch the current live site was deployed from (Stage 41 root + `/stage42/`). The URL returns to its previous state.
- **Earlier states:**
  - `claude/release-pages-9e0a8c8`: Stage 41 only.
  - `claude/release-pages-8b1de5b`: the previous generation.
- No save is deleted in any direction. Each version's saves live under its own names and simply stop being reachable while its path is not published.

## Not verified here
- Pixel 7a behaviour (touch, speed, heat) of the trial.
- The real phone's GPU speed for the decade mode.
