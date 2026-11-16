# Stage 41 #4: simple intervention mode

Status: implemented, unit + Chromium-emulation E2E pass. **Not verified on a real Pixel 7a.**

- Where: policy window sheet (every 10 years) has a かんたん / 詳細 toggle; the choice is remembered in localStorage (`kfm.polSimple`), default 詳細 so existing flows are unchanged.
- Three answers (each optional, tap again to clear): 交通 道路/鉄道/海路/空路, 都市 集中/分散, 地域 日本海側/太平洋側. Preview shows what will be adopted.
- Mapping (src/sim/simple41.ts): 道路→`p-road`, 鉄道→`p-rail`, 集中→`o-select`, 分散→`p-region` (existing items, with their own `block` rules kept). 海路/空路→ `seaBias`/`airBias` dials (+0.15 × strength) as 10-year mods: **there is no detailed policy item for them**, so this is a new mapping, labelled `s-sea`/`s-air`. 地域→ **no dial**: the coast belongs to the reconstruction policy set at an era change; it only steers the next era change in automatic mode (candidate with matching `recon.coast`). Stated honestly in the UI.
- Strength = max(ADOPT_BAR, environment score), no points spent. Points carry over as before.
- 「今後の自動でも続ける」 (`sim.simple41.keep`): automatic policy windows use the answers (`autoResolve`), automatic era changes use `autoEraIdx`. With keep off or nothing answered, the automatic choice is bit-identical to before (test).
- Save: `sim.simple41` is saved with the game; a hand-edited invalid value cannot throw (whitelisted).
- Tests: tests/unit/simple41.test.ts (4), tests/e2e/real.spec.ts "Stage 41 simple intervention".
- Open: the era-change sheet (manual) does not yet mark candidates that match the coast answer.
