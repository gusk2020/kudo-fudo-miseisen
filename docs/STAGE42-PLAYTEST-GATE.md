# Stage 42: pre-playtest compatibility gate

The owner asked to continue toward a **playable** Stage 42. This branch starts from PR #94 (capital/subcapital railway without deferred Fuji population suppression). It deliberately excludes PR #93's unapproved mountain/city shrinkage and PR #96 northern towns (independent work).

## The new validation
`.github/workflows/stage42-compat.yml` checks out the currently published Stage 41 source at `9e0a8c805f29af18e8cf018254832d79573aa5c7`, builds it under the existing Pages base path, and builds this Stage 42 candidate separately. In real headless Chromium, `tools/compat-check.mjs` creates Stage 41 autosaves and a manual save, opens them in Stage 42, checks that gameplay resumes and saves again, and then checks safe rollback. This is the **existing, unchanged** compatibility check: no skips or relaxed criteria.

Do not treat a green regular CI as evidence of successful cross-build saved-game migration until this new job succeeds. If it fails, diagnose the real reason. The version-sensitive UI paths in the existing check may need a separately reviewed compatibility fix, without changing acceptance thresholds.

## Release controls
- This branch changes **only a dedicated validation workflow and documentation**; no game logic or UI. Do not merge into main, release to Pages, use force-push or mark ready without express approval.
- Latest approved public trial remains Stage 41. A new public Stage 42 trial URL is **not yet prepared/verified**.
- Do not include PR #93 Fuji compensation or PR #96 north towns in the first Stage 42 trial. The 1800-era Showa candidate provisional readings (option A) are approved.
- If this compatibility gate succeeds, build a frozen Stage 42 candidate, confirm old/current saves, and present the minimal update/publication decision to the owner. Do not claim successful Pixel 7a testing until user confirms.
- Keep technical details in GitHub; user report: player-visible changes, availability, verified/unverified results, and only necessary next action.
