/**
 * Issue #86: era NAMES and transport POLICY are chosen independently, from the candidates history passed over.
 *   pools      大正時候補 (the 1912 names beside 大正): the first era of an 1800 game.   昭和時候補 (1926): the relocation of the 1900s.   平成時候補 + 令和時候補 (1989, 2019): the 2000s.   From 2100: every one of them not yet used.
 *              明治's candidates are not used (none could be verified). 令和's side proposals 佳桜・桜花・知道 are not used. A name history ADOPTED (大正 昭和 平成 令和 ...) is never offered.
 *   readings   A candidate's reading is data, with its source (docs/ERA86.md). The fourteen 1926 names have NO verified reading yet: they are listed, marked 「読み未確認」 and cannot be chosen -- an initial is never guessed.
 *   4 eras     The candidate and the three eras before it must all differ in (1) their first kanji and (2) the first letter of their reading in Hepburn romaji. The two are judged separately; a candidate that fails is still listed, with the mark and the reason, and cannot be chosen.
 *              A fifth era may repeat the first one's initial. An era before it whose reading is unknown (a game from before this rule) is judged by its kanji only.
 *   前・中・後   The game's OWN fiction (not a practice of real Japanese eras): when every verified historical candidate has been used, a name adopted before may come back -- the second time as 前X, the third as 中X, the fourth as 後X (readings ぜん・ちゅう・こう + X).
 *              They are offered only then, each as its own name, each under the same 4-era test.
 *   last resort the game's generated names (いろは + 干支, kaigen.ts), labelled as such, when nothing else can be chosen. Their reading is made by the game: the kana of the iroha character and the on-reading of the stem or branch.
 * Ordinary era changes (every 20-40 years) keep the generated names; the policy is chosen beside the name there too. Only games made with the flag (`sim.era86`, new 1800-start games) use any of this: an older game keeps its eras, names and rules untouched.
 */
import type { EraKey } from "./eras";
import { BRANCHES, IROHA, REAL_ERAS_USED, STEMS, eraKey, eto, futureCandidates, installEra86, type KaigenState } from "./kaigen";

export type EraOrigin = "taisho" | "showa" | "heisei" | "reiwa" | "reuse" | "generated";
export const ORIGIN_LABEL: Record<EraOrigin, string> = { taisho: "大正時候補", showa: "昭和時候補", heisei: "平成時候補", reiwa: "令和時候補", reuse: "再採用(ゲーム独自の前・中・後)", generated: "ゲーム生成(史実の候補ではない)" };
export interface HistCand { name: string; yomi: string | null; origin: EraOrigin; note: string }
/** yomi null = no verified reading (docs/ERA86.md lists the sources tried). */
export const HIST_POOL: readonly HistCand[] = [
  ...[["天興", "てんこう"], ["興化", "こうか"], ["永安", "えいあん"], ["乾徳", "けんとく"], ["昭徳", "しょうとく"]].map(([name, yomi]) => ({ name, yomi, origin: "taisho" as const, note: "1912年の改元で示された候補(不採用)" })),
  ...["神化", "元化", "神和", "同和", "継明", "順明", "明保", "寛安", "元安"].map((name) => ({ name, yomi: null, origin: "showa" as const, note: "1926年の改元の宮内省案(不採用)" })),
  ...["立成", "定業", "光文", "章明", "協中"].map((name) => ({ name, yomi: null, origin: "showa" as const, note: "1926年の改元の内閣案(不採用)" })),
  ...[["修文", "しゅうぶん"], ["正化", "せいか"]].map(([name, yomi]) => ({ name, yomi, origin: "heisei" as const, note: "1989年の改元の最終候補(不採用)" })),
  ...[["英弘", "えいこう"], ["久化", "きゅうか"], ["広至", "こうし"], ["万和", "ばんな"], ["万保", "ばんぽう"]].map(([name, yomi]) => ({ name, yomi, origin: "reiwa" as const, note: "2019年の改元の最終候補(不採用)" })),
];
/** Names history really adopted: never offered, whatever the pool says. */
export const ADOPTED_REAL = new Set(REAL_ERAS_USED.map(eraKey));

// ---- readings and initials
const KANA_INITIAL: Record<string, string> = (() => { const m: Record<string, string> = {}; const rows: [string, string][] = [["あいうえお", "AIUEO"], ["かきくけこ", "KKKKK"], ["さしすせそ", "SSSSS"], ["たちつてと", "TCTTT"], ["なにぬねの", "NNNNN"], ["はひふへほ", "HHFHH"], ["まみむめも", "MMMMM"], ["やゆよ", "YYY"], ["らりるれろ", "RRRRR"], ["わゐゑを", "WIEO"], ["がぎぐげご", "GGGGG"], ["ざじずぜぞ", "ZJZZZ"], ["だぢづでど", "DJZDD"], ["ばびぶべぼ", "BBBBB"], ["ぱぴぷぺぽ", "PPPPP"]]; for (const [k, r] of rows) [...k].forEach((ch, i) => { m[ch] = r[i]; }); return m; })();
/** The first letter of a hiragana reading in Hepburn romaji (し -> S, ち -> C, つ -> T, ふ -> F, じ -> J); null for an empty or non-kana reading. */
export const romajiInitial = (yomi: string | null | undefined): string | null => (yomi ? KANA_INITIAL[[...yomi][0]] ?? null : null);
export const kanjiInitial = (name: string): string => [...eraKey(name)][0] ?? "";
const STEM_ON: Record<string, string> = { 甲: "こう", 乙: "おつ", 丙: "へい", 丁: "てい", 戊: "ぼ", 己: "き", 庚: "こう", 辛: "しん", 壬: "じん", 癸: "き" };
const BRANCH_ON: Record<string, string> = { 子: "し", 丑: "ちゅう", 寅: "いん", 卯: "ぼう", 辰: "しん", 巳: "し", 午: "ご", 未: "び", 申: "しん", 酉: "ゆう", 戌: "じゅつ", 亥: "がい" };
void STEMS; void BRANCHES;
/** The reading the game gives one of ITS OWN generated names (an iroha character and a stem or branch, either order). null when the name is not of that make. */
export function generatedYomi(name: string): string | null {
  const ch = [...name]; if (ch.length !== 2) return null;
  const part = (c: string) => IROHA.find((i) => i.kanji === c)?.kana ?? STEM_ON[c] ?? BRANCH_ON[c] ?? null, a = part(ch[0]), b = part(ch[1]); return a && b ? a + b : null;
}
export const PREFIXES = [["前", "ぜん"], ["中", "ちゅう"], ["後", "こう"]] as const;
/** The base name under a 前/中/後 form (itself when it has none). Only names this module made carry one, so a historical name beginning with 中 or 後 is not cut: the caller passes the set of known bases. */
export function baseOf(name: string, bases: Set<string>): string { const c = [...name]; return c.length > 2 && PREFIXES.some(([p]) => p === c[0]) && bases.has(c.slice(1).join("")) ? c.slice(1).join("") : name; }

// ---- the candidates of one occasion
export interface Era86Cand { name: string; yomi: string | null; origin: EraOrigin; note: string; /** null = can be chosen */ blocked: string | null; /** the mark shown beside a blocked one */ mark?: "漢" | "ロ" | "読" | "済" }
export interface EraPast { name: string; yomi?: string | null }
/** The 4-era test of one name against the eras before it (newest last). */
export function fourEraBlock(name: string, yomi: string | null, past: EraPast[]): { blocked: string; mark: "漢" | "ロ" } | null {
  const last3 = past.slice(-3), k = kanjiInitial(name), hitK = last3.find((e) => kanjiInitial(e.name) === k); if (hitK) return { blocked: `先頭の漢字「${k}」が直前3代の「${hitK.name}」と重なる`, mark: "漢" };
  const r = romajiInitial(yomi); if (r) { const hitR = last3.find((e) => romajiInitial(e.yomi) === r); if (hitR) return { blocked: `ローマ字の頭文字「${r}」が直前3代の「${hitR.name}」と重なる`, mark: "ロ" }; }
  return null;
}
export const poolFor = (year: number): EraOrigin[] => (year < 1900 ? ["taisho"] : year < 2000 ? ["showa"] : year < 2100 ? ["heisei", "reiwa"] : ["taisho", "showa", "heisei", "reiwa"]);
const judge = (c: { name: string; yomi: string | null; origin: EraOrigin; note: string }, past: EraPast[], used: Set<string>): Era86Cand => {
  if (used.has(eraKey(c.name))) return { ...c, blocked: "この世界ですでに使った元号", mark: "済" };
  if (c.yomi === null) return { ...c, blocked: "読みを資料で確認できていない(ローマ字の頭文字を判定できない)", mark: "読" };
  const b = fourEraBlock(c.name, c.yomi, past); return b ? { ...c, ...b } : { ...c, blocked: null };
};
export const GENERATED_SHOWN = 5, GENERATED_TRY = 40;
/** Generated names for `year`, judged: the first five, and more until three can be chosen (at most GENERATED_TRY looked at). */
export function generatedCands(year: number, past: EraPast[], used: Set<string>): Era86Cand[] {
  const out: Era86Cand[] = []; let ok = 0; const taken = new Set<string>(used);
  for (let round = 0; round < GENERATED_TRY / 5 && (out.length < GENERATED_SHOWN || ok < 3); round++) {
    const batch = futureCandidates(year, taken); if (!batch.length) break;
    for (const c of batch) { taken.add(c.name); const j = judge({ name: c.name, yomi: generatedYomi(c.name), origin: "generated", note: c.note }, past, used); if (out.length < GENERATED_SHOWN || (!j.blocked && ok < 3)) { out.push(j); if (!j.blocked) ok++; } }
  }
  return out;
}
/**
 * The candidates of a NAMING OCCASION of the historical kind (the first era, a relocation): the pool of the year, judged; then -- only when none of them can be chosen -- the reuse forms (if every verified historical name is used up) and the generated names.
 * `past` = the eras so far, oldest first, with their readings where known.
 */
export function historicalCands(year: number, past: EraPast[]): Era86Cand[] {
  const used = new Set([...past.map((e) => eraKey(e.name)), ...ADOPTED_REAL]), origins = poolFor(year);
  const out = HIST_POOL.filter((c) => origins.includes(c.origin) && !ADOPTED_REAL.has(eraKey(c.name))).map((c) => judge(c, past, used));
  if (out.some((c) => !c.blocked)) return out;
  const verified = HIST_POOL.filter((c) => c.yomi !== null), exhausted = verified.every((c) => used.has(eraKey(c.name)));
  if (exhausted) {   // 前・中・後: the next form of each name adopted before, in the order they were first adopted
    const bases = new Set(verified.map((c) => c.name)), firstUse = past.map((e) => baseOf(e.name, bases)).filter((b, i, a) => bases.has(b) && a.indexOf(b) === i);
    for (const b of firstUse) { const times = past.filter((e) => baseOf(e.name, bases) === b).length, pf = PREFIXES[times - 1]; if (!pf) continue; const h = verified.find((c) => c.name === b)!;
      out.push(judge({ name: pf[0] + b, yomi: pf[1] + h.yomi!, origin: "reuse", note: `「${b}」の${times + 1}回目の採用(ゲーム独自の規則。史実の元号の慣行ではありません)` }, past, used)); }
    if (out.some((c) => !c.blocked)) return out;
  }
  return [...out, ...generatedCands(year, past, used)];
}
/** An ordinary era change (every 20-40 years): the generated names, judged. */
export const ordinaryCands = (year: number, past: EraPast[]): Era86Cand[] => generatedCands(year, past, new Set([...past.map((e) => eraKey(e.name)), ...ADOPTED_REAL]));
export const pastOf = (k: KaigenState): EraPast[] => k.eras.map((e) => ({ name: e.name, yomi: (e as { yomi?: string | null }).yomi ?? null }));
export const firstSelectable = (c: Era86Cand[]): number => Math.max(0, c.findIndex((x) => !x.blocked));
export const STANCE_CHOICES: EraKey[] = ["heisei", "shubun", "shoka", "kairo", "kuuro"];
void eto;
export const poolText = (year: number): string => `${poolFor(year).map((o) => ORIGIN_LABEL[o]).join("・")}(史実で採用されなかった案。採用された元号は出ません)`;
installEra86((year, k) => ordinaryCands(year, pastOf(k)), (year, k) => historicalCands(year, pastOf(k)), poolText);
/** The first era of a new 1800 game: one of the 大正時候補 by name. */
export const firstEraCands = (): Era86Cand[] => historicalCands(1800, []);
