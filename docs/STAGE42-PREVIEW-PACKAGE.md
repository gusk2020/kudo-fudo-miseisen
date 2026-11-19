# Stage 42 playtest package — release is NOT authorized

Target is **a separately isolated smartphone test version** at `/kudo-fudo-miseisen/stage42/` while retaining the existing Stage 41 root. Candidate is PR #97 stack (ultimately PR #94, WITHOUT deferred Fuji compensation #93 or northern data #96).

## What was prepared
`.github/workflows/stage42-preview-package.yml` builds a pinned Stage 41 root from the public release source `9e0a8c805f29af18e8cf018254832d79573aa5c7`, then Stage 42 from this preview branch. `BASE_PATH=/kudo-fudo-miseisen/stage42/` ensures separate assets. `VITE_SAVE_NS=stage42trial` activates the existing `src/core/ns.ts` isolation for IndexedDB and localStorage, because **GitHub Pages URLs of the same account/repo share an origin**: a path alone is not safe for saves. It packages both builds for inspection as a CI artifact; **NO deployment action is defined**. Stage 41 root built from pinned source must be checked against the actual published asset bytes before any deploy, because a rebuild alone is not evidence of byte identity.

## Verification
- PR #97 Stage41→Stage42 cross-build compatibility on 2026-11-18, workflow 44278675138: **16/16 passed**, including old save restored, continue, re-save, backup byte-identical, rollback.
- PR #97 CI workflow 44278684778: **success**. Another run 44278675255 failed one E2E city tap case after 739 unit tests passed and 111/112 E2E succeeded: investigate non-determinism, do not weaken or skip tests. No unverified assertion of complete CI stability.
- Newly added package job must succeed. Its artifact does **not** establish the new URL is live.
- Stage 42 must be tested on real Pixel 7a after a separately authorized safe Pages preview publication. The public Stage 41 route and its saves must not change.

## Next actions
1. Inspect preview artifact (stage42 link, asset base, storage namespace) and compare root build to live Pages index/assets; fix if mismatched.
2. Decide on safe preview publication. Do not trigger the repository's existing `pages.yml` from this branch: it would replace the **whole** Pages deployment with Stage 42 at root.
3. Only after user approves publishing the isolated preview, use a bounded workflow that deploys the inspected composite root+subpath with unchanged old assets, records previous Pages deployment for rollback, preserves `stage42trial` storage namespace, and confirms the URL. Explicitly state this action updates GitHub Pages even though default Stage 41 gameplay should remain unchanged.
4. Avoid mixing in Issue #91 Fuji adjustment and Draft PR #96 north towns. Keep PRs Draft, no main merge, no destructive GitHub actions.
5. Report only game-visible change, playable URL when verified, testing result, and necessary user action. Keep detailed technical handoff here, smartphone operations minimal.

Important: `docs/HANDOFF42.md` is stale in parts; the Showa 14 provisional readings **option A are approved**, as already recorded in Issue #86. Do not ask owner again.
