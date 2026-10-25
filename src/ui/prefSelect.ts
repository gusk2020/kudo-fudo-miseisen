/**
 * Stage 23: the prefecture picker as the game first had it (Stage 5: one labelled <select> per seat) with the grouping Stage 10 added (<optgroup> per regional
 * block, north to south). On a phone the browser shows its own list for it: a dark window, one column, ○/● to the left of each name, scrolling, closed by
 * tapping outside -- which is the feel asked for, and nothing of ours to get wrong at 360px.
 */
import { REGION_BLOCKS, prefName } from "../core/seat";
import { h } from "./app";

export function prefSelect(id: string, label: string, value: string, other: string | null, cityName: (pid: string) => string, change: (pid: string) => void): HTMLSelectElement {
  const s = h("select", { id, "aria-label": label, onchange: (e: Event) => change((e.target as HTMLSelectElement).value) }) as HTMLSelectElement;
  for (const blk of REGION_BLOCKS) {
    const g = h("optgroup", { label: blk.name });
    for (const pid of blk.prefs) { const c = cityName(pid); g.append(h("option", { value: pid, ...(pid === value ? { selected: "" } : {}), ...(pid === other ? { disabled: "" } : {}) }, c ? `${prefName(pid)}(${c})` : prefName(pid))); }
    s.append(g);
  }
  s.value = value; return s;
}
