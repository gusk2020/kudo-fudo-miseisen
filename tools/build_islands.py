"""Builds src/data/islands-extra.json: the five islands added in Issue #13 (淡路島, 対馬, 佐渡島, 壱岐島, 隠岐諸島), from public-domain Natural Earth.
Usage: python3 tools/build_islands.py <ne_10m_admin_0_countries.geojson>
Each island is picked by the position of its polygon (centroid inside a small box around the island), never by index, so the choice is checkable.
Projection and simplification match tools/build_data.py. City figures are approximate round numbers of the 2020 census, kept only to size a 1950 town (not statistics)."""
import json, sys, math
LON0, LAT0 = 137.0, 37.0
KX, KY = 111.32*math.cos(math.radians(36)), 110.57
def prj(lon, lat): return [round((lon-LON0)*KX, 2), round((lat-LAT0)*KY, 2)]
def dp(pts, tol):
    if len(pts) < 3: return pts
    a, b = pts[0], pts[-1]; dx, dy = b[0]-a[0], b[1]-a[1]; L = math.hypot(dx, dy) or 1e-9
    best, bi = -1, 0
    for i in range(1, len(pts)-1):
        d = abs((pts[i][0]-a[0])*dy-(pts[i][1]-a[1])*dx)/L
        if d > best: best, bi = d, i
    if best <= tol: return [a, b]
    return dp(pts[:bi+1], tol)[:-1] + dp(pts[bi:], tol)
def area(p): return 0.5*sum(p[i][0]*p[(i+1)%len(p)][1]-p[(i+1)%len(p)][0]*p[i][1] for i in range(len(p)))
def crosses(p):
    n = len(p)
    def o(a, b, c): return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
    for i in range(n):
        for j in range(i+2, n):
            if i == 0 and j == n-1: continue
            a, b, c, d = p[i], p[(i+1) % n], p[j], p[(j+1) % n]
            if (o(a, b, c) > 0) != (o(a, b, d) > 0) and (o(c, d, a) > 0) != (o(c, d, b) > 0): return True
    return False
def ring_poly(r, tol):
    p = [prj(*q[:2]) for q in r[:-1]]
    m = max(range(len(p)), key=lambda i: math.hypot(p[i][0]-p[0][0], p[i][1]-p[0][1]))
    s = dp(p[:m+1], tol)[:-1] + dp(p[m:] + [p[0]], tol)[:-1]
    if area(s) < 0: s.reverse()
    return s
def simple_ring(r, tol):
    while True:
        p = ring_poly(r, tol)
        if not crosses(p) or tol < 0.05: return p
        tol *= 0.75
# id, 日本語名, prefecture id, box (lon0, lon1, lat0, lat1) that contains the centroid of every polygon of the island, minimum polygon area (km2)
ISLANDS = [
  ("awaji", "淡路島", "JP-28", (134.6, 135.1, 34.1, 34.7), 100),
  ("tsushima", "対馬", "JP-42", (129.1, 129.6, 34.0, 34.8), 100),
  ("sado", "佐渡島", "JP-15", (138.1, 138.7, 37.7, 38.4), 100),
  ("iki", "壱岐島", "JP-42", (129.5, 129.9, 33.6, 33.95), 50),
  ("oki", "隠岐諸島", "JP-32", (132.9, 133.5, 36.0, 36.4), 30),
]
# a town to anchor each island (name, lon, lat, rounded population)
CITIES = {"awaji": ("洲本市", 134.90, 34.34, 41000), "tsushima": ("対馬市", 129.29, 34.20, 28500), "sado": ("佐渡市", 138.43, 38.02, 51500), "iki": ("壱岐市", 129.69, 33.75, 25500), "oki": ("隠岐の島町", 133.33, 36.20, 13000)}
G = json.load(open(sys.argv[1]))
jp = [f for f in G['features'] if f['properties']['ADM0_A3'] == 'JPN'][0]['geometry']
polys = jp['coordinates'] if jp['type'] == 'MultiPolygon' else [jp['coordinates']]
out = {'islands': {}, 'cities': [], 'sources': [{'name': 'Natural Earth 1:10m admin_0_countries', 'license': 'Public domain', 'url': 'https://www.naturalearthdata.com/'}]}
for iid, name, pref, (lo0, lo1, la0, la1), amin in ISLANDS:
    parts = []
    for pl in polys:
        r = pl[0]; cx = sum(q[0] for q in r)/len(r); cy = sum(q[1] for q in r)/len(r)
        if lo0 <= cx <= lo1 and la0 <= cy <= la1:
            a = abs(area([prj(*q[:2]) for q in r[:-1]]))
            if a >= amin: parts.append((a, r))
    assert parts, iid
    parts.sort(key=lambda t: -t[0])
    out['islands'][iid] = {'name': name, 'pref': pref, 'parts': [simple_ring(r, 0.5) for a, r in parts], 'areaKm2': round(sum(a for a, r in parts))}
    nm, lon, lat, pop = CITIES[iid]
    out['cities'].append({'id': 'X-' + iid.upper(), 'name': nm, 'pos': prj(lon, lat), 'kind': 'city', 'pref': pref, 'island': iid, 'pop': pop})
json.dump(out, open('src/data/islands-extra.json', 'w'), ensure_ascii=False, separators=(',', ':'))
print({k: (v['areaKm2'], len(v['parts']), [len(p) for p in v['parts']]) for k, v in out['islands'].items()})
