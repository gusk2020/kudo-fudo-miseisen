"""Builds src/data/japan.json + public/japan-dem.bin from public-domain Natural Earth + GEBCO.
Usage: python3 tools/build_data.py <naturalEarthDir> <gebco4096.png>
Natural Earth (public domain): admin_0_countries, admin_1_states_provinces, populated_places_simple, lakes.
GEBCO_2026 (attribution: GEBCO Compilation Group) via the world-viewer repo's committed 4096x2048 raster."""
import json, sys, math, struct
import numpy as np
from PIL import Image
ne, demp = sys.argv[1], sys.argv[2]
LON0, LAT0 = 137.0, 37.0
KX, KY = 111.32*math.cos(math.radians(36)), 110.57
def prj(lon, lat): return [round((lon-LON0)*KX,2), round((lat-LAT0)*KY,2)]
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
def cen(p): return [sum(q[0] for q in p)/len(p), sum(q[1] for q in p)/len(p)]
def crosses(p):
    n=len(p)
    def o(a,b,c): return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
    for i in range(n):
        for j in range(i+2,n):
            if i==0 and j==n-1: continue
            a,b,c,d=p[i],p[(i+1)%n],p[j],p[(j+1)%n]
            if (o(a,b,c)>0)!=(o(a,b,d)>0) and (o(c,d,a)>0)!=(o(c,d,b)>0): return True
    return False
def simple_ring(r, tol):
    # simplify, shrinking the tolerance until the ring is a simple polygon
    while True:
        p = ring_poly(r, tol)
        if not crosses(p) or tol < 0.05: return p
        tol *= 0.75
def ring_poly(r, tol):
    p = [prj(*q[:2]) for q in r[:-1]]
    m = max(range(len(p)), key=lambda i: math.hypot(p[i][0]-p[0][0], p[i][1]-p[0][1]))
    s = dp(p[:m+1], tol)[:-1] + dp(p[m:] + [p[0]], tol)[:-1]
    if area(s) < 0: s.reverse()  # CCW
    return s
G = json.load(open(f'{ne}/countries.geojson'))
jp = [f for f in G['features'] if f['properties']['ADM0_A3'] == 'JPN'][0]['geometry']
polys = jp['coordinates'] if jp['type'] == 'MultiPolygon' else [jp['coordinates']]
cand = []
for pl in polys:
    r = ring_poly(pl[0], 0.3)
    cand.append((abs(area(r)), cen(r), pl[0]))
cand.sort(key=lambda t: -t[0])
def pick(f):
    for a, c, r in cand:
        lon = c[0]/KX+LON0; lat = c[1]/KY+LAT0
        if f(lon, lat) and a > 300: return r
islands = {
 'honshu': (pick(lambda lo, la: 132 < lo < 142.5 and 34 < la < 41.6 and True), 2.0),
 'hokkaido': (pick(lambda lo, la: lo > 139.5 and la > 41.5), 2.0),
 'kyushu': (pick(lambda lo, la: lo < 132.5 and 30.5 < la < 34), 1.8),
 'shikoku': (pick(lambda lo, la: 132 < lo < 135 and 32.5 < la < 34.5), 1.5),
 'okinawa': (pick(lambda lo, la: lo < 129 and la < 27.5), 0.8),
}
out = {'islands': {}}
for k, (r, tol) in islands.items():
    p = simple_ring(r, tol); c = cen(p)
    out['islands'][k] = {'outline': p, 'n': len(p), 'areaKm2': round(area(p))}
# Biwa
L = json.load(open(f'{ne}/lakes.geojson'))
b = [f for f in L['features'] if f['properties']['name'] == 'Biwa Ko'][0]['geometry']
br = (b['coordinates'][0][0] if b['type'] == 'MultiPolygon' else b['coordinates'][0])
bp = ring_poly(br, 0.4); bc = cen(bp)
out['biwa'] = {'center': bc, 'shape': [[round(q[0]-bc[0],2), round(q[1]-bc[1],2)] for q in bp], 'areaKm2': round(area(bp))}
# Fuji (fixed shape: irregular blob, base ~ 20 km radius, 3776 m)
fc = prj(138.7274, 35.3606)
out['fuji'] = {'center': fc, 'summitM': 3776, 'baseRadiusKm': 20}
# prefectures
A = json.load(open(f'{ne}/admin1.geojson'))
P = json.load(open(f'{ne}/places.geojson'))
places = {f['properties']['nameascii']: f['properties'] for f in P['features'] if f['properties']['adm0_a3'] == 'JPN'}
capital = {'Aomori':'青森市','Iwate':'盛岡市','Miyagi':'仙台市','Akita':'秋田市','Yamagata':'山形市','Fukushima':'福島市','Ibaraki':'水戸市','Tochigi':'宇都宮市','Gunma':'前橋市','Saitama':'さいたま市','Chiba':'千葉市','Tokyo':'東京','Kanagawa':'横浜市','Niigata':'新潟市','Toyama':'富山市','Ishikawa':'金沢市','Fukui':'福井市','Yamanashi':'甲府市','Nagano':'長野市','Gifu':'岐阜市','Shizuoka':'静岡市','Aichi':'名古屋市','Mie':'津市','Shiga':'大津市','Kyōto':'京都市','Ōsaka':'大阪市','Hyōgo':'神戸市','Nara':'奈良市','Wakayama':'和歌山市','Tottori':'鳥取市','Shimane':'松江市','Okayama':'岡山市','Hiroshima':'広島市','Yamaguchi':'山口市','Tokushima':'徳島市','Kagawa':'高松市','Ehime':'松山市','Kōchi':'高知市','Fukuoka':'福岡市','Saga':'佐賀市','Nagasaki':'長崎市','Kumamoto':'熊本市','Ōita':'大分市','Miyazaki':'宮崎市','Kagoshima':'鹿児島市','Okinawa':'那覇市'}
asc = {'Kyōto':'Kyoto','Ōsaka':'Osaka','Kōchi':'Kochi','Ōita':'Oita','Hyōgo':'Kobe'}
island_of = {}
for n in 'Aomori Iwate Miyagi Akita Yamagata Fukushima Ibaraki Tochigi Gunma Saitama Chiba Tokyo Kanagawa Niigata Toyama Ishikawa Fukui Yamanashi Nagano Gifu Shizuoka Aichi Mie Shiga Kyōto Ōsaka Hyōgo Nara Wakayama Tottori Shimane Okayama Hiroshima Yamaguchi'.split(): island_of[n] = 'honshu'
for n in 'Tokushima Kagawa Ehime Kōchi'.split(): island_of[n] = 'shikoku'
for n in 'Fukuoka Saga Nagasaki Kumamoto Ōita Miyazaki Kagoshima'.split(): island_of[n] = 'kyushu'
island_of['Okinawa'] = 'okinawa'
prefs = []
for f in A['features']:
    pr = f['properties']
    if pr.get('admin') != 'Japan' or pr['name'] not in island_of: continue
    nm = pr['name']; ja = pr['name_ja'] or nm
    if nm == 'Tokyo': ja = '東京府'
    cityn = asc.get(nm, nm)
    # seed = capital city location if known, else NE label point
    if nm == 'Tokyo': cc = places.get('Tokyo')
    else: cc = places.get({'Hyōgo':'Kobe'}.get(nm, cityn)) 
    approx = cc is None
    lon, lat = (cc['longitude'], cc['latitude']) if cc else (pr['longitude'], pr['latitude'])
    prefs.append({'id': pr['iso_3166_2'], 'weight': round(math.sqrt(pr['area_sqkm'] or 2000)), 'name': ja, 'island': island_of[nm], 'capital': capital[nm], 'seed': prj(lon, lat), 'seedApprox': approx})
# Hokkaido: 3 prefectures (札幌・函館・根室), city coordinates are well-known public facts
for pid, nm, cap, lon, lat in [('HK-SAP','札幌県','札幌市',141.3545,43.0621),('HK-HAK','函館県','函館市',140.7288,41.7688),('HK-NEM','根室県','根室市',145.5828,43.3306)]:
    prefs.append({'id': pid, 'weight': {'HK-SAP':190,'HK-HAK':120,'HK-NEM':170}[pid], 'name': nm, 'island': 'hokkaido', 'capital': cap, 'seed': prj(lon, lat), 'seedApprox': False})
assert len(prefs) == 49, len(prefs)
out['prefectures'] = prefs
cities = [{'id': 'C-'+p['id'], 'name': p['capital'], 'pos': p['seed'], 'kind': 'capital', 'pref': p['id'], 'island': p['island']} for p in prefs]
have = {c['name'] for c in cities}
for nm, pr in places.items():
    pos = prj(pr['longitude'], pr['latitude'])
    if pr['pop_max'] < 300000: continue
    if any(math.hypot(pos[0]-c['pos'][0], pos[1]-c['pos'][1]) < 15 for c in cities): continue
    # island by nearest outline vertex
    best = min(((math.hypot(q[0]-pos[0], q[1]-pos[1]), k) for k, v in out['islands'].items() for q in v['outline']))
    if best[0] > 40: continue
    cities.append({'id': 'C-'+pr['ne_id'].__str__(), 'name': nm, 'pos': pos, 'kind': 'city', 'pref': None, 'island': best[1], 'pop': pr['pop_max']})
out['cities'] = cities
# DEM crop
im = np.array(Image.open(demp).convert('RGB')).astype(np.int32)
H, W, _ = im.shape
x0, x1 = int((122+180)/360*W), int((148+180)/360*W); y0, y1 = int((90-46)/180*H), int((90-24)/180*H)
sub = (im[y0:y1, x0:x1, 0]*256 + im[y0:y1, x0:x1, 1] - 12000).astype(np.int16)
open('public/japan-dem.bin', 'wb').write(sub.tobytes())
out['dem'] = {'w': int(sub.shape[1]), 'h': int(sub.shape[0]), 'lon0': x0/W*360-180, 'lat0': 90-y0/H*180, 'dLon': 360/W, 'dLat': 180/H, 'file': 'japan-dem.bin', 'minM': int(sub.min()), 'maxM': int(sub.max())}
out['proj'] = {'lon0': LON0, 'lat0': LAT0, 'kmPerDegLon': KX, 'kmPerDegLat': KY}
out['sources'] = [
 {'name': 'Natural Earth 1:10m (admin_0, admin_1, populated places, lakes)', 'license': 'Public domain', 'url': 'https://www.naturalearthdata.com/'},
 {'name': 'GEBCO_2026 grid (4096x2048 crop via world-viewer repo)', 'license': 'GEBCO terms: free to use, attribution to GEBCO Compilation Group', 'url': 'https://www.gebco.net/'}]
json.dump(out, open('src/data/japan.json', 'w'), ensure_ascii=False, separators=(',', ':'))
print({k: v['n'] for k, v in out['islands'].items()}, len(cities), out['dem'], [p['name'] for p in prefs if p['seedApprox']])
