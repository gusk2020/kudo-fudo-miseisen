import { afterEach, describe, expect, it } from "vitest";
import { RECORD, SEA_AIR_TUNNEL_CAP_KM, bridgeFiction, facilityFiction, fictionMark, seaAirPriority, tunnelFiction, worldRailRecord } from "../../src/sim/fiction41";
import { setTunnelCap, techAt, tunnelCap, waterTechAt } from "../../src/sim/tech";
import { stepMonth } from "../../src/sim/engine";
import { stage3Sim } from "./simhelp";

/** Stage 41 #6/#7: 【架空】 marks from verified records only, and the 2026 tunnel limit while sea or air is the priority. */
afterEach(() => setTunnelCap(null));
describe("Stage 41 #6: fictional marks (verified records only)", () => {
  it("world rail record: Seikan until 2016, then the Gotthard Base; Japan's rail record is Seikan; roads: 24.51 world, 18.6 Japan", () => {
    expect(worldRailRecord(1990)).toBe(53.85); expect(worldRailRecord(2015)).toBe(53.85); expect(worldRailRecord(2016)).toBe(57.09); expect(RECORD.railJapanKm).toBe(53.85); expect(RECORD.roadWorldKm).toBe(24.51); expect(RECORD.roadJapanKm).toBe(18.6);
  });
  it("a tunnel is marked only when longer than a record that is known: world-first above the world record, Japan-first between Japan's and the world's; shorter ones and bridges are not judged", () => {
    const t = (km: number, mode?: "rail") => ({ facility: "tunnel" as const, lengthKm: km, ...(mode ? { mode } : {}) });
    expect(tunnelFiction(t(30, "rail"), 1970), "unjudged, not called real").toBe(""); expect(tunnelFiction(t(54, "rail"), 1980)).toBe("世界初"); expect(tunnelFiction(t(56, "rail"), 2010)).toBe("世界初"); expect(tunnelFiction(t(56, "rail"), 2020)).toBe("日本初"); expect(tunnelFiction(t(58, "rail"), 2020)).toBe("世界初");
    expect(tunnelFiction(t(20), 1990)).toBe("日本初"); expect(tunnelFiction(t(25), 1990)).toBe("世界初"); expect(tunnelFiction(t(10), 1990)).toBe(""); expect(tunnelFiction({ facility: "bridge" as never, lengthKm: 99 }, 2000)).toBe("");
    expect(fictionMark("世界初")).toBe("【架空・世界初】"); expect(fictionMark("")).toBe("");
  });
});
describe("Stage 41 #6: bridges", () => {
  it("a bridge longer than Japan's longest (アクアブリッジ, 4.425 km by the larger count) is Japan-first; longer than the longest continuous bridge over water (38.44 km) is world-first; the 明石海峡大橋's 3.9 km is not marked", () => {
    const b = (km: number) => ({ facility: "bridge" as const, lengthKm: km }); expect(bridgeFiction(b(3.911))).toBe(""); expect(bridgeFiction(b(4.4))).toBe(""); expect(bridgeFiction(b(6))).toBe("日本初"); expect(bridgeFiction(b(38))).toBe("日本初"); expect(bridgeFiction(b(39))).toBe("世界初");
    expect(facilityFiction(b(6), 1990)).toBe("日本初"); expect(facilityFiction({ facility: "tunnel", lengthKm: 58, mode: "rail" }, 2020)).toBe("世界初"); expect(bridgeFiction({ facility: "tunnel", lengthKm: 99 })).toBe("");
  });
});
describe("Stage 41 #7: sea / air priority limits new tunnels to the 2026 record; road/rail priority lifts it", () => {
  it("techAt and the water-tunnel reach are capped only while the cap is set", () => {
    const free = techAt(2, 2100).tunnelKm, freeW = waterTechAt(3, 2100).reachKm; expect(free).toBeGreaterThan(SEA_AIR_TUNNEL_CAP_KM); setTunnelCap(SEA_AIR_TUNNEL_CAP_KM);
    expect(techAt(2, 2100).tunnelKm).toBe(SEA_AIR_TUNNEL_CAP_KM); expect(waterTechAt(3, 2100).reachKm).toBe(SEA_AIR_TUNNEL_CAP_KM); expect(techAt(2, 1950).tunnelKm, "early years are below the cap and untouched").toBeLessThan(SEA_AIR_TUNNEL_CAP_KM); expect(techAt(2, 2100).bridgeKm, "no bridge cap was given").toBe(40); setTunnelCap(SEA_AIR_TUNNEL_CAP_KM, 38.44); expect(techAt(2, 2100).bridgeKm).toBe(38.44); expect(techAt(2, 1960).bridgeKm).toBeLessThan(38.44); setTunnelCap(null); expect(techAt(2, 2100).bridgeKm).toBe(40); expect(techAt(2, 2100).tunnelKm).toBe(free); expect(waterTechAt(3, 2100).reachKm).toBe(freeW);
  });
  it("the game sets the cap each month from its stance: sea/air on, balanced/road/rail off again (resumes)", () => {
    const g = stage3Sim("heisei", 7, true, 0, 2, true, undefined, undefined, { start1800: true } as never), { sim, w } = g, last = sim.kaigen!.eras[sim.kaigen!.eras.length - 1];
    expect(seaAirPriority(sim)).toBe(false); stepMonth(sim, w); expect(tunnelCap()).toBeNull();
    last.stance = "kairo"; expect(seaAirPriority(sim)).toBe(true); stepMonth(sim, w); expect(tunnelCap()).toBe(SEA_AIR_TUNNEL_CAP_KM);
    last.stance = "kuuro"; stepMonth(sim, w); expect(tunnelCap()).toBe(SEA_AIR_TUNNEL_CAP_KM);
    last.stance = "shubun"; stepMonth(sim, w); expect(tunnelCap(), "road priority again: lifted").toBeNull();
  }, 600000);
});
