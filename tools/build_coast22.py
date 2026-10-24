"""Stage 22: coastlines from 地球地図日本 (Global Map Japan, GSI; via dataofjapan/land japan.geojson).
Writes (1) each islet's outline into src/data/islets.json (`shape`, lon/lat, simplified) and (2) a display coastline of all Japan, src/data/coast-gmj.json
(integer lon/lat x 1000, simplified per polygon size). Run: python3 -I tools/build_coast22.py <japan.geojson> <repo dir>"""
import json, math, sys
src, repo = sys.argv[1], sys.argv[2]
g = json.load(open(src))
polys = []
for f in g['features']:
    geom = f['geometry']; rings = [geom['coordinates']] if geom['type'] == 'Polygon' else geom['coordinates']
    for r in rings: polys.append(r[0])
def km(p, q, lat): return math.hypot((p[0]-q[0])*math.cos(math.radians(lat))*111.32, (p[1]-q[1])*110.57)
def area_km2(r):
    lat = sum(p[1] for p in r)/len(r); s = 0
    for i in range(len(r)):
        x1, y1 = r[i][0]*math.cos(math.radians(lat))*111.32, r[i][1]*110.57; x2, y2 = r[(i+1)%len(r)][0]*math.cos(math.radians(lat))*111.32, r[(i+1)%len(r)][1]*110.57
        s += x1*y2 - x2*y1
    return abs(s)/2
def dp(pts, tol, lat):
    if len(pts) < 4: return pts
    def rec(a, b):
        A, B = pts[a], pts[b]; best, bi = -1, -1
        for i in range(a+1, b):
            P = pts[i]
            # distance point-segment in km
            ax, ay = A[0]*math.cos(math.radians(lat))*111.32, A[1]*110.57; bx, by = B[0]*math.cos(math.radians(lat))*111.32, B[1]*110.57; px, py = P[0]*math.cos(math.radians(lat))*111.32, P[1]*110.57
            dx, dy = bx-ax, by-ay; L = dx*dx+dy*dy; t = 0 if L == 0 else max(0, min(1, ((px-ax)*dx+(py-ay)*dy)/L))
            d = math.hypot(px-(ax+t*dx), py-(ay+t*dy))
            if d > best: best, bi = d, i
        if best > tol: return rec(a, bi)[:-1] + rec(bi, b)
        return [A, B]
    out = rec(0, len(pts)-1)
    return out
def inside(pt, ring):
    x, y = pt; c = False; n = len(ring)
    for i in range(n):
        x1, y1 = ring[i][:2]; x2, y2 = ring[(i+1)%n][:2]
        if (y1 > y) != (y2 > y) and x < (x2-x1)*(y-y1)/(y2-y1)+x1: c = not c
    return c
bbs = [(min(p[0] for p in r), min(p[1] for p in r), max(p[0] for p in r), max(p[1] for p in r)) for r in polys]
# --- islets ---
ip = repo + '/src/data/islets.json'; d = json.load(open(ip))
names = {s['name'] for s in d['islets']}
extra = [dict(name='南鳥島', group='その他の東京都の島', pref='JP-13', lon=153.98, lat=24.29, area=1.51, elev=9, len=2.0, wid=1.9, bear=0, pop=0),
         dict(name='沖ノ鳥島', group='その他の東京都の島', pref='JP-13', lon=136.08, lat=20.43, area=0.01, elev=1, len=4.5, wid=1.7, bear=60, pop=0, claim='日本が島として扱い排他的経済水域の根拠としている。中国・韓国は「岩」であるとして異論を唱えている。')]
nid = max(int(s['id'][3:]) for s in d['islets'])
for e in extra:
    if e['name'] not in names: nid += 1; e['id'] = 'IS-%03d' % nid; d['islets'].append(e)
found = 0; missing = []
# candidates: polygons that contain the islet's centre or come within 8 km of it; score = distance + 3 x |log(area ratio)|; each polygon goes to one islet only (best scores first)
cands = []
for si, s in enumerate(d['islets']):
    p = (s['lon'], s['lat'])
    for ri, (r, b) in enumerate(zip(polys, bbs)):
        if not (b[0]-0.12 <= p[0] <= b[2]+0.12 and b[1]-0.12 <= p[1] <= b[3]+0.12): continue
        dd = 0 if inside(p, r) else min(km(q, p, p[1]) for q in r)
        if dd > 25: continue
        a = area_km2(r)
        if a > 4000: continue   # a big island the grid already holds, not this islet
        cands.append((dd / 5 + 3 * abs(math.log(max(a, 0.005) / max(s['area'], 0.005))), si, ri, a))
cands.sort(); taken_i = set(); taken_r = set()
for sc, si, ri, a in cands:
    if si in taken_i or ri in taken_r: continue
    taken_i.add(si); taken_r.add(ri); s = d['islets'][si]; r = polys[ri]; p = (s['lon'], s['lat'])
    tol = 0.05 if a < 5 else 0.15 if a < 50 else 0.3 if a < 500 else 0.6
    sh = dp([q[:2] for q in r], tol, p[1])
    if len(sh) < 5: sh = [q[:2] for q in r][:60]
    if len(sh) > 160: sh = dp([q[:2] for q in r], tol*2, p[1])
    s['shape'] = [[round(q[0], 4), round(q[1], 4)] for q in sh]; s['shapeAreaKm2'] = round(a, 2); found += 1
    cx = sum(q[0] for q in r) / len(r); cy = sum(q[1] for q in r) / len(r); s['c'] = [round(cx, 4), round(cy, 4)]   # the outline's centre (lon/lat of the older figures are kept for the Stage 20 worlds)
# an outline whose area is far from the island's own figure is someone else's (or the data merged it with a bridged neighbour): dropped, and said so
KEEP = {'西之島', '沖ノ鳥島'}   # 西之島 has grown since the 1:1M data was made; 沖ノ鳥島 is two rocks the data draws as one speck
for si, s in enumerate(d['islets']):
    if si in taken_i and s['name'] not in KEEP and not (0.25 < s['shapeAreaKm2'] / max(s['area'], 0.01) < 4): taken_i.discard(si); s['shapeNote'] = '地球地図日本の輪郭と面積が合わず(隣の島と一体、または対応する輪郭が見当たらない)、輪郭なし'
for si, s in enumerate(d['islets']):
    if si not in taken_i: s.pop('shape', None); s.pop('shapeAreaKm2', None); s.pop('c', None); missing.append(s['name'])
d['shapeSource'] = '輪郭: 地球地図日本(国土地理院、1:100万、dataofjapan/land 経由の GeoJSON)を Douglas-Peucker で簡略化。出典: 地球地図日本(国土地理院)'
json.dump(d, open(ip, 'w'), ensure_ascii=False, indent=1)
print('islets with shape', found, 'missing', missing)
# --- display coastline: every polygon, simplified by size; tiny ones (< 0.05 km2) dropped unless an islet uses them ---
out = []; npts = 0
for r in polys:
    a = area_km2(r)
    if a < 0.05: continue
    lat = sum(q[1] for q in r)/len(r)
    tol = 0.12 if a < 20 else 0.3 if a < 500 else 0.6 if a < 20000 else 0.9
    sh = dp([q[:2] for q in r], tol, lat)
    if len(sh) < 3: continue
    flat = []
    for q in sh: flat += [round(q[0]*1000), round(q[1]*1000)]
    out.append(flat); npts += len(sh)
json.dump({'source': '地球地図日本(国土地理院)。dataofjapan/land の japan.geojson を簡略化。座標は経度・緯度の1000倍の整数', 'license': '国土地理院コンテンツ利用規約に基づき出典を明記して利用(出典: 地球地図日本)', 'polys': out}, open(repo + '/src/data/coast-gmj.json', 'w'), separators=(',', ':'))
print('coast polys', len(out), 'points', npts)
