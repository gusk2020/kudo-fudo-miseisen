"""Stage 36 / M1: adds the northern Kuril islands (islets.json) and southern Sakhalin up to 50N (islands-extra.json) from Natural Earth 1:10m land (public domain).
Usage: python3 tools/build_karafuto36.py <ne_10m_land.geojson>
Nothing here is invented geometry: every outline is a Natural Earth polygon (Sakhalin clipped at 50N, simplified). Names, elevations and areas of the Kuril islands are
approximate public figures and are flagged `provisional` -- gameplay values, not survey data. Re-running is idempotent (entries are keyed by id)."""
import json, sys, math
land = json.load(open(sys.argv[1]))
LON0, LAT0 = 137.0, 37.0
KX, KY = 111.32*math.cos(math.radians(36)), 110.57
prj = lambda lo, la: [round((lo-LON0)*KX, 2), round((la-LAT0)*KY, 2)]
polys = []
for f in land['features']:
    g = f['geometry']
    for p in (g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]): polys.append(p[0])
def area_km2(ring):
    r = [prj(*q[:2]) for q in ring]; return abs(0.5*sum(r[i][0]*r[(i+1) % len(r)][1]-r[(i+1) % len(r)][0]*r[i][1] for i in range(len(r))))
cen = lambda ring: [sum(q[0] for q in ring)/len(ring), sum(q[1] for q in ring)/len(ring)]
def dp(pts, tol):
    if len(pts) < 3: return pts
    a, b = pts[0], pts[-1]; dx, dy = b[0]-a[0], b[1]-a[1]; L = math.hypot(dx, dy) or 1e-9
    best, bi = -1, 0
    for i in range(1, len(pts)-1):
        d = abs((pts[i][0]-a[0])*dy-(pts[i][1]-a[1])*dx)/L
        if d > best: best, bi = d, i
    if best <= tol: return [a, b]
    return dp(pts[:bi+1], tol)[:-1] + dp(pts[bi:], tol)
# ---- northern Kurils: (id, name, lon, lat, prefecture) -- prefecture from src/sim/kuril1800.ts's frozen rule
KURILS = [("urup", "得撫島", 150.0, 45.9, "HK-NEM", 1450), ("simushir", "新知島", 152.0, 46.9, "HK-NEM", 350), ("ketoi", "計吐夷島", 152.5, 47.3, "HK-NEM", 73), ("rasshua", "羅処和島", 153.02, 47.77, "HK-NEM", 67),
          ("matua", "松輪島", 153.2, 48.1, "HK-NEM", 52), ("onekotan", "温禰古丹島", 154.7, 49.4, "HK-NEM", 425), ("paramushir", "幌筵島", 155.8, 50.3, "HK-NEM", 2053), ("shumshu", "占守島", 156.3, 50.75, "HK-NEM", 388)]
islets = json.load(open('src/data/islets.json')); have = {s['id'] for s in islets['islets']}
for n, (kid, name, lon, lat, pref, area) in enumerate(KURILS):
    sid = f"IS-2{n:02d}"
    if sid in have: continue
    cand = [(area_km2(r), r) for r in polys if math.hypot(cen(r)[0]-lon, cen(r)[1]-lat) < 0.6]
    if not cand: raise SystemExit(f"no Natural Earth polygon near {name}")
    a, r = min([t for t in cand if t[0] > 5], key=lambda t: math.hypot(cen(t[1])[0]-lon, cen(t[1])[1]-lat)); rr = [q[:2] for q in r[:-1]]; mm = max(range(len(rr)), key=lambda i: math.hypot(rr[i][0]-rr[0][0], rr[i][1]-rr[0][1]))   # a closed ring is simplified as two open halves
    sh = [[round(q[0], 4), round(q[1], 4)] for q in dp(rr[:mm+1], 0.004)[:-1] + dp(rr[mm:] + [rr[0]], 0.004)[:-1]]; sh.append(sh[0])
    xs, ys = [q[0] for q in sh], [q[1] for q in sh]; c = cen(sh)
    islets['islets'].append({"name": name, "group": "千島列島(北部)", "pref": pref, "lon": lon, "lat": lat, "area": area, "elev": 300, "len": round((max(ys)-min(ys))*KY, 1), "wid": round((max(xs)-min(xs))*KX, 1), "bear": 0,
                             "pop": 0, "id": sid, "shape": sh, "shapeAreaKm2": round(a, 1), "c": [round(c[0], 4), round(c[1], 4)], "since": 36, "provisional": True})
json.dump(islets, open('src/data/islets.json', 'w'), ensure_ascii=False, indent=1)
# ---- southern Sakhalin (clipped at 50N)
sak = max((r for r in polys if 142 < cen(r)[0] < 145 and 46 < cen(r)[1] < 55), key=area_km2)
def clip(ring, lat):
    out = []; n = len(ring)
    for i in range(n):
        a, b = ring[i], ring[(i+1) % n]; ina, inb = a[1] <= lat, b[1] <= lat
        if ina: out.append(a[:2])
        if ina != inb: t = (lat-a[1])/(b[1]-a[1]); out.append([a[0]+t*(b[0]-a[0]), lat])
    return out
cl = clip(sak[:-1], 50.0); pr = [prj(*q) for q in cl]
m = max(range(len(pr)), key=lambda i: math.hypot(pr[i][0]-pr[0][0], pr[i][1]-pr[0][1]))   # a closed ring is simplified as two open halves
sim = dp(pr[:m+1], 0.8)[:-1] + dp(pr[m:] + [pr[0]], 0.8)[:-1]
if sum(sim[i][0]*sim[(i+1) % len(sim)][1]-sim[(i+1) % len(sim)][0]*sim[i][1] for i in range(len(sim))) < 0: sim.reverse()
ar = round(abs(0.5*sum(sim[i][0]*sim[(i+1) % len(sim)][1]-sim[(i+1) % len(sim)][0]*sim[i][1] for i in range(len(sim)))))
ex = json.load(open('src/data/islands-extra.json'))
ex['islands']['karafuto'] = {"name": "樺太(北緯50度以南)", "pref": "KRF", "parts": [sim], "areaKm2": ar, "provisional": True}
ex['cities'] = [c for c in ex['cities'] if c['id'] not in ('X-TOYOHARA', 'X-KARAFUTO')] + [{"id": "X-KARAFUTO", "name": "豊原", "pos": prj(142.74, 46.96), "kind": "capital", "pref": "KRF", "island": "karafuto", "pop": 3000, "popNote": "game estimate (1800), not a sourced figure"}]
json.dump(ex, open('src/data/islands-extra.json', 'w'), ensure_ascii=False, separators=(',', ':'))
print("kurils added:", len(islets['islets'])-103, "karafuto vertices", len(sim), "area km2", ar)

# ---- the 50th prefecture
j = json.load(open('src/data/japan.json'))
if not any(q['id'] == 'KRF' for q in j['prefectures']):
    j['prefectures'].append({"id": "KRF", "weight": 100, "name": "樺太県", "island": "karafuto", "capital": "豊原", "seed": prj(142.74, 46.96), "seedApprox": False, "pop": 3000})
    json.dump(j, open('src/data/japan.json', 'w'), ensure_ascii=False, separators=(',', ':'))
