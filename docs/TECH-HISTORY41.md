# Stage 41 #6 / #7: fictional-technology marks and the sea/air tunnel limit

Status: implemented and unit-tested. **Not verified on a real Pixel 7a.** Sources below were checked by web search on 2026-11-16; items marked ✗ could NOT be confirmed and are deliberately not used.

## Verified records (the only ones the code uses; src/sim/fiction41.ts)
| item | value | status / source |
|---|---|---|
| World's longest rail tunnel | Gotthard Base 57.09 km (2016) | ✔ allplan.com blog, designingbuildings.co.uk, smithsonianmag.com (search results) |
| Rail record 1988–2015 (world and Japan) | Seikan Tunnel 53.85 km (opened 1988) | ✔ trafficnews.jp, lotsberg/encyclopedia.com results |
| World's longest road tunnel | Lærdal 24.51 km (2000) | ✔ Statens vegvesen (vegvesen.no), visitnorway.com |
| Japan's longest road tunnel | 山手トンネル 18.2 km (one source) / 18.6 km (another) | ◐ sources disagree; the **larger (18.6)** is used so nothing real is called fictional |
| Longest bridge (any) | Danyang–Kunshan Grand Bridge 164.8 km (rail viaduct) | ✔ Wikipedia/other results, but it is a viaduct, not comparable to the game's open-water bridge limit |
| Akashi Kaikyō Bridge 3,911 m; single-bridge records by year | – | ✗ not confirmed in this round → **bridges are not marked** |
| Earlier world/Japan tunnel records (Simplon 1906, Dai-shimizu 1982 22.2 km, Mont Blanc 1965, Gotthard road 1980) | – | ✗ not confirmed (one source was unreliable) → not used |

## 【架空】 marks (#6)
- Shown in the road/line detail card after the facility name: `【架空・世界初】` = longer than the world's longest tunnel that existed when it opened; `【架空・日本初】` = longer than Japan's record but not the world's.
- Rule is conservative: it marks only what is **certainly** beyond real history (a record can only grow, so anything above the verified records is above every earlier tunnel too). A tunnel shorter than the verified records is left **unmarked, not called real**, because earlier records were not verified. So a 40 km rail tunnel opened in 1975 (real record then ≈ 22 km, unverified) is currently *not* marked; adding verified earlier records to `RECORD`/`worldRailRecord` would extend this.
- Japan-first vs world-first and road vs rail are distinguished; the tunnel length is the facility edge's `lengthKm` (a single tunnel facility), not a route total.
- Bridges, ports, airports, other technologies: not marked yet.

## Sea/air-priority limit (#7)
- While the stance in force (last entry of the era list; `sim.era` for single-era games) is 海路重視 or 空路重視, `setTunnelCap(57.09)` is applied each month (`stepMonthGen`): `techAt().tunnelKm` and the water-tunnel `waterTechAt().reachKm` cannot exceed the longest tunnel that exists in 2026. A too-long plan is simply "not buildable yet" (the existing `tooLong` path), i.e. a plan/hold is allowed, not a new opening.
- When road/rail/balanced priority returns, the cap is lifted at the next month and planning may resume (tested: sea → air → road).
- Bridges: the model's own limit (40 km by 2150) is already below every record, so no extra cap is added. Under an unverified bridge record this is stated, not assumed.
- Caveats: the cap is a module-level value set by the stepping game (the app runs one game); a tool previewing another game's tech between steps sees the last value. It limits the **length** only, not the existing too-long tunnels already built before the stance changed.
