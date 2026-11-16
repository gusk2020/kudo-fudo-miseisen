/**
 * Stage 41 #8: which special-route symbols this phone can really draw. A symbol outside the fonts a device carries is painted as an empty box ("tofu"); the same box is what the device paints for a code point that has no character at all, so a symbol whose picture equals
 * those reference pictures -- or is blank -- is treated as not drawable and the game shows its katakana reading instead (special41.ts `shownSymbol`). Nothing about the route (its key, its saved data) depends on this: only what is shown.
 */
import { SPECIAL_SYMS, setGlyphCheck } from "../sim/special41";

export function detectGlyphs(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  try {
    const c = document.createElement("canvas"); c.width = c.height = 40; const g = c.getContext("2d", { willReadFrequently: true }); if (!g) return Object.fromEntries(SPECIAL_SYMS.map((s) => [s, true]));
    const pic = (ch: string) => { g.clearRect(0, 0, 40, 40); g.fillStyle = "#000"; g.font = "28px system-ui, 'Noto Sans', sans-serif"; g.textBaseline = "alphabetic"; g.fillText(ch, 4, 30); const d = g.getImageData(0, 0, 40, 40).data; let h = 2166136261, ink = 0; for (let i = 3; i < d.length; i += 4) { const a = d[i] > 40 ? 1 : 0; ink += a; h = Math.imul(h ^ a, 16777619) >>> 0; } return { h, ink }; };
    const refs = new Set(["͸", "\u{10FFFD}", "\u{E0FFF}", "￿", "\u{3FFFD}"].map((r) => pic(r).h));   // (assigned to nothing: each device draws its own "missing" picture)
    for (const s of SPECIAL_SYMS) { const p = pic(s); out[s] = p.ink > 3 && !refs.has(p.h); }
  } catch { for (const s of SPECIAL_SYMS) out[s] = true; }
  return out;
}
export function installGlyphCheck(): Record<string, boolean> { const ok = detectGlyphs(); setGlyphCheck((s) => ok[s] !== false); return ok; }
