/**
 * Stage 36: the main highways (街道) and their post towns (宿場) an 1800 game starts with. They are laid over the start's road network between the cities they pass, designated as national routes
 * that carry their old name (東海道 ...) beside the official number. FICTION/GAME ASSUMPTION: which cities each highway joins is the game's own simplification of the real five highways + 西国街道
 * (the game has 55 cities, not every post town), and the post towns are the nearest real places along the line, one about every POST_KM. No railway and no air route exists.
 */
import { nearestPlace } from "../core/gazetteer";
import { designate, ev } from "./engine";
import { buildIndex, layPath } from "./network";
import { pathfind, type World } from "./world";
import type { SimState, RouteEdgeRef } from "./types";

export const KAIDO_1800: readonly { name: string; via: readonly string[] }[] = [
  { name: "東海道", via: ["東京", "横浜市", "静岡市", "名古屋市", "津市", "大津市", "京都市"] },
  { name: "中山道", via: ["東京", "さいたま市", "前橋市", "長野市", "岐阜市", "大津市"] },
  { name: "日光街道", via: ["東京", "さいたま市", "宇都宮市"] },
  { name: "奥州街道", via: ["宇都宮市", "福島市", "仙台市", "盛岡市", "青森市"] },
  { name: "甲州街道", via: ["東京", "八王子市", "甲府市", "長野市"] },
  { name: "西国街道", via: ["京都市", "大阪市", "神戸市", "岡山市", "広島市", "山口市", "北九州市", "福岡市"] },
];
export const POST_KM = 28, POST_REACH_KM = 12;

/** Lays the highways and names their post towns. Returns what it made. */
export function seedKaido1800(sim: SimState, w: World): { routes: number; posts: number; km: number } {
  let routes = 0, posts = 0, km = 0; const taken = new Set<string>(w.cities.map((c) => c.name)), claimed = new Set<string>();
  for (const k of KAIDO_1800) {
    const cities = k.via.map((n) => w.cities.find((c) => c.name === n)).filter((c): c is NonNullable<typeof c> => !!c), cells: number[] = [], hold = { id: "r.kaido-hold", edges: [] as RouteEdgeRef[], oldEdges: [] as string[], active: false } as unknown as SimState["routes"][string];   // (a later leg can split an edge an earlier leg already laid: the chain is kept in a route-shaped holder while laying, so splitEdge rewrites it too -- a plain array went stale and broke the route's chain)
    sim.routes[hold.id] = hold;
    for (let i = 1; i < cities.length; i++) {
      if (w.t.island[cities[i - 1].cell] !== w.t.island[cities[i].cell]) break;   // (a highway of one island: it ends where the sea begins, so the route stays one connected chain)
      const path = pathfind(w, cities[i - 1].cell, cities[i].cell, { roadCells: buildIndex(sim).roadCells, margin: 10 }); if (!path) continue;
      const l = layPath(sim, w, path, { open: true, surface: "gravel", quality: 55, built: 1, month: 0, standard: "rural" }); hold.edges.push(...l.chain); cells.push(...path);
    }
    delete sim.routes[hold.id]; const chain = hold.edges;
    if (!chain.length) continue;
    const r = designate(sim, chain, "national", "JP", `${k.name}: ${cities[0].name}〜${cities[cities.length - 1].name}`, "1800年の主要街道(ゲーム上の初期配置。実在の街道の簡略化)", true); if (!r) continue;
    r.kaido = k.name; routes++; km += chain.reduce((a, c) => a + (sim.edges[c.edgeId]?.lengthKm ?? 0), 0);
    // post towns: about one every POST_KM of line, each the nearest unclaimed settlement within POST_REACH_KM, renamed after the nearest real place
    let run = 0, prev = cells[0];
    for (const c of cells) {
      run += Math.hypot(w.cellPos(c)[0] - w.cellPos(prev)[0], w.cellPos(c)[1] - w.cellPos(prev)[1]); prev = c; if (run < POST_KM) continue; run = 0;
      const p = w.cellPos(c); let best: (typeof sim.settlements)[string] | null = null, bd = POST_REACH_KM;
      for (const s of Object.values(sim.settlements)) { if (claimed.has(s.id) || s.post) continue; const d = Math.hypot(w.cellPos(s.cell)[0] - p[0], w.cellPos(s.cell)[1] - p[1]); if (d < bd) { bd = d; best = s; } }
      if (!best) continue; const np = nearestPlace(w.cellPos(best.cell), taken); if (!np) continue;
      taken.add(np.name); claimed.add(best.id); best.name = `${np.name}宿`; best.post = k.name; posts++;
    }
  }
  ev(sim, "seed", `1800年の主要街道: ${routes}本(約${Math.round(km)}km)・宿場${posts}か所`, "初期条件(ゲーム上の簡略化。鉄道・空路はない)", {});
  return { routes, posts, km };
}
