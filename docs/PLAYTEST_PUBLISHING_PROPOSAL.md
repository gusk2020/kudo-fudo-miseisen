# Playtest publishing proposal (GitHub only) — nothing here has been run

Status: **proposal awaiting approval**. Nothing was published, no Pages setting was changed, no repository was created, `.github/workflows/pages.yml` was not touched. No playtest URL exists yet, so none is given.

## What is in the way (verified by reading the repository)
1. `.github/workflows/pages.yml` builds this repository and deploys **one** GitHub Pages site (`concurrency: pages`, environment `github-pages`, `BASE_PATH=/kudo-fudo-miseisen/`). Its `push` list ends at `claude/stage30a`; Stage 31-35 and the audit branch are not on it. It also has `workflow_dispatch`, which can be run **from any branch**, so running it from a Stage 35 branch would replace the public site with that build. Nobody should run it from a branch.
2. A repository has one Pages site. Adding a second build "next to" the first inside this repository means changing the shared workflow, and a failure there would stop the real site from updating.
3. **Saves are per origin, not per path.** The game keeps its saves in IndexedDB (`kfm-stage1`) and a few settings in `localStorage` (`kfm.*`). Every GitHub Pages project site of one account is on the same origin (`https://<owner>.github.io`), so a playtest published as another repository's site would read and overwrite the real game's saves. **This is fixed in code on this branch**: a build made with `VITE_SAVE_NS=<name>` uses its own database (`kfm-stage1-<name>`) and its own keys (`kfm-<name>.*`); the normal build keeps the old names exactly (checked in a real browser: normal build → `kfm-stage1` / `kfm.run`; `VITE_SAVE_NS=playtest` → `kfm-stage1-playtest` / `kfm-playtest.run`).

## Options
| | what | existing public site | verdict |
|---|---|---|---|
| **A** | a **separate public repository** used only for playtests, with its own Pages site; built with `VITE_SAVE_NS` | untouched (different repository, different site) | **recommended** |
| B | a sub-path of this repository's site, built by an edited `pages.yml` | at risk (shared workflow and artifact) | not recommended |
| C | download the build artifact and open it on the phone | untouched | not workable: the page loads modules and a worker, which a `file://` page cannot do |
| D | Cloudflare / Netlify / other hosts | untouched | out of scope (GitHub only) |

## Option A — the minimum steps
Needs the owner's approval for steps 1, 2 and 4; step 3 is a setting only the owner can change.
1. Create a new **public** repository, e.g. `kudo-fudo-miseisen-playtest` (free accounts need a public repository for Pages).
2. Put the source of this branch into it (default branch) and add `docs/playtest/pages-playtest.yml.template` as `.github/workflows/pages-playtest.yml`, with the repository name filled in for `BASE_PATH`. The template runs **only by hand** (`workflow_dispatch`) and builds with `VITE_SAVE_NS=playtest`.
3. In that repository: **Settings → Pages → Build and deployment → Source: GitHub Actions** (a phone browser can do this).
4. Run the workflow once from the Actions tab. When the deploy job finishes, its log prints the real `page_url`; **that** is the playtest URL. By GitHub's convention it would be `https://<owner>.github.io/<repository>/`, but it must not be trusted until the run shows it, and it should be opened once from the phone before anyone relies on it.
5. Updating the playtest later = run the same workflow again; the real game's repository is never involved.

## Things to check on the phone after publishing (not yet possible)
- the startup window appears once; the wizard is usable with a thumb; saving and reloading brings the same game back;
- the real game's saves are still there when the real site is opened afterwards (they should be: different database names);
- a relocation can be played through (set the clock with the in-game controls or play to the boundary).

## What was and was not verified here
Verified: the namespace change in a real (emulated) browser, the existing workflow's contents, the build with `BASE_PATH`. **Not** verified: any live URL, GitHub's Pages enablement from a workflow run, the physical Pixel 7a.
