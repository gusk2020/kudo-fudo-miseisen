/**
 * Era context for the ten-yearly policy candidates (Issue #13, item 5: the foundation only).
 *
 * Idea: until 2026 the top-five list of each domain (政治 / 経済 / 世論) should lean on what really was going on -- heavy industry, tourism, pollution, the
 * environment, the car industry and the car boom, aviation, regional conflicts and wars -- while keeping history and invention apart. This file is the data
 * structure and the extension point; the table is deliberately small and its effect is OFF (`CONTEXT_WEIGHT = 0`), so nothing changes for existing games and
 * the table can be filled in and checked entry by entry later.
 *
 *  - `real: true` entries must name a `source` (a statute, an event, a published figure). Entries without one are `real: false` (the game's own invention).
 *  - After REAL_UNTIL (2026) nothing may be `real`; later entries are projections.
 *  - `lean` says which existing policies the situation favours (ids from policy.ts) and by how much (0..1 of the policy's base score, before CONTEXT_WEIGHT).
 */
import type { Domain } from "./policy";

export const REAL_UNTIL = 2026, CONTEXT_WEIGHT = 0;
export interface ContextItem { id: string; from: number; to: number; domain: Domain; label: string; real: boolean; source?: string; lean: Record<string, number> }
export const CONTEXT: ContextItem[] = [
  { id: "c-income-doubling", from: 1960, to: 1970, domain: "economy", label: "高度経済成長(所得倍増計画)", real: true, source: "1960年 池田内閣 国民所得倍増計画(閣議決定)", lean: { "e-stimulus": 0.3, "p-road": 0.2, "p-rail": 0.2 } },
  { id: "c-pollution", from: 1967, to: 1980, domain: "opinion", label: "公害問題と環境意識の高まり", real: true, source: "1967年 公害対策基本法 / 1971年 環境庁発足", lean: { "o-green": 0.3, "o-car": -0.2 } },
  { id: "c-oil-shock", from: 1973, to: 1980, domain: "economy", label: "石油危機とエネルギー価格", real: true, source: "1973年 第一次石油危機", lean: { "e-austerity": 0.2, "e-rail-freight": 0.2 } },
  { id: "c-jnr-reform", from: 1980, to: 1990, domain: "politics", label: "国鉄の経営悪化と改革", real: true, source: "1987年 国鉄分割民営化(JR発足)", lean: { "p-priv": 0.3, "p-jnr": -0.1 } },
  { id: "c-bubble-burst", from: 1991, to: 2003, domain: "economy", label: "バブル崩壊後の長期低迷と景気対策", real: true, source: "1990年代の景気後退と公共投資の拡大", lean: { "e-stimulus": 0.2, "e-austerity": 0.1 } },
  { id: "c-expressway-reform", from: 2003, to: 2010, domain: "politics", label: "道路関係四公団の民営化", real: true, source: "2005年 道路関係四公団民営化(NEXCO等の発足)", lean: { "o-select": 0.2, "p-road": -0.1 } },
  { id: "c-quake", from: 2011, to: 2020, domain: "opinion", label: "東日本大震災と防災・老朽化対策", real: true, source: "2011年 東日本大震災", lean: { "o-safety": 0.3 } },
  { id: "c-shrink", from: 2027, to: 2100, domain: "opinion", label: "人口減少と地方の維持", real: false, lean: { "o-rural": 0.2, "p-region": 0.2, "o-select": 0.1 } },
];
/** The extra base score a context item gives a policy in `year` (0 while CONTEXT_WEIGHT is 0). */
export function contextLean(year: number, domain: Domain, policyId: string): number {
  if (!CONTEXT_WEIGHT) return 0; let s = 0;
  for (const c of CONTEXT) if (c.domain === domain && year >= c.from && year < c.to) s += c.lean[policyId] ?? 0;
  return s * CONTEXT_WEIGHT;
}
/** Structural problems in the table (empty when it is sound): used by a test, and cheap to run after every edit. */
export function checkContext(table: ContextItem[] = CONTEXT): string[] {
  const bad: string[] = [], ids = new Set<string>();
  for (const c of table) {
    if (ids.has(c.id)) bad.push(`${c.id}: duplicated id`); ids.add(c.id);
    if (!(c.from < c.to)) bad.push(`${c.id}: empty period`);
    if (c.real && !c.source) bad.push(`${c.id}: a historical entry needs a source`);
    if (c.real && c.to > REAL_UNTIL + 1) bad.push(`${c.id}: nothing after ${REAL_UNTIL} may be marked as history`);
    if (c.real && c.from > REAL_UNTIL) bad.push(`${c.id}: starts after ${REAL_UNTIL} yet marked as history`);
  }
  return bad;
}
