"""Reference alignments for the 1950-style starting network: real rail and road corridors from Natural Earth (public domain).
Usage: python3 tools/build_reference.py <naturalEarthDir>   (needs countries/railroads/roads geojson)
Output: src/data/reference-lines.json   (km coordinates in the game projection; simplified to ~1.5 km)"""
import json, sys, math
ne = sys.argv[1]
LON0, LAT0 = 137.0, 37.0
KX, KY = 111.32*math.cos(math.radians(36)), 110.57
prj = lambda lon, lat: [round((lon-LON0)*KX, 1), round((lat-LAT0)*KY, 1)]
J = json.load(open(f'{ne}/countries.geojson'))
g = [f for f in J['features'] if f['properties']['ADM0_A3'] == 'JPN'][0]['geometry']
polys = g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]
def inland(x, y):
    for pl in polys:
        r = pl[0]; c = False
        for i in range(len(r)):
            a, b = r[i], r[i-1]
            if (a[1] > y) != (b[1] > y) and x < (b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0]: c = not c
        if c: return True
    return False
def dp(p, tol):
    if len(p) < 3: return p
    a, b = p[0], p[-1]; dx, dy = b[0]-a[0], b[1]-a[1]; L = math.hypot(dx, dy) or 1e-9
    best, bi = -1, 0
    for i in range(1, len(p)-1):
        d = abs((p[i][0]-a[0])*dy-(p[i][1]-a[1])*dx)/L
        if d > best: best, bi = d, i
    return [a, b] if best <= tol else dp(p[:bi+1], tol)[:-1] + dp(p[bi:], tol)
def lines(f):
    gm = f['geometry']
    if not gm: return []
    return gm['coordinates'] if gm['type'] == 'MultiLineString' else [gm['coordinates']]
out = {'rail': [], 'road': [], 'source': 'Natural Earth 1:10m Railroads and Roads (public domain), simplified'}
for ft in json.load(open(f'{ne}/ne_10m_railroads.geojson'))['features']:
    for L in lines(ft):
        m = L[len(L)//2]
        if 128 < m[0] < 146 and 30 < m[1] < 46 and inland(m[0], m[1]):
            p = ft['properties']; pts = dp([prj(x, y) for x, y in L], 1.5)
            if len(pts) >= 2: out['rail'].append({'cat': p.get('category'), 'electric': p.get('electric'), 'tracks': p.get('mult_track'), 'pts': pts})
for ft in json.load(open(f'{ne}/ne_10m_roads.geojson'))['features']:
    for L in lines(ft):
        m = L[len(L)//2]
        if 128 < m[0] < 146 and 30 < m[1] < 46 and inland(m[0], m[1]):
            p = ft['properties']; pts = dp([prj(x, y) for x, y in L], 1.5)
            if len(pts) >= 2: out['road'].append({'type': p.get('type'), 'pts': pts})
json.dump(out, open('src/data/reference-lines.json', 'w'), separators=(',', ':'))
print(len(out['rail']), len(out['road']), sum(len(l['pts']) for l in out['rail']), sum(len(l['pts']) for l in out['road']))
