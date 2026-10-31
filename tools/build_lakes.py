#!/usr/bin/env python3
"""Stage 29: Japan's main lakes, brackish lakes and the islands in them, from OpenStreetMap (ODbL), written to src/data/lakes.json.

Nothing here is invented: every outline is an OSM way/relation (water=lake / lagoon with a name and a wikidata link), simplified (Douglas-Peucker, ~80 m) and rounded to 1e-4 degree. Islands are the inner rings of the
lake's own multipolygon plus place=island/islet ways whose centre lies inside the lake. Reservoirs (water=reservoir) are left out: this map shows lakes, not dams.
Run on a GitHub runner (the sandbox cannot reach Overpass): python3 tools/build_lakes.py [out.json]
"""
import json, math, sys, time, urllib.request, urllib.parse

ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://overpass.private.coffee/api/interpreter"]
MIN_KM2 = 3.0
BRACKISH = {"宍道湖", "中海", "浜名湖", "涸沼", "十三湖", "小川原湖", "網走湖", "能取湖", "サロマ湖", "風蓮湖", "厚岸湖", "霞ヶ浦", "北浦", "外浪逆浦", "佐鳴湖", "北潟湖", "湖山池", "漫湖", "宇曽利山湖", "八郎潟", "久美浜湾", "松川浦", "小湊", "能取湖", "藻琴湖", "濤沸湖", "オホーツク海"}
MUST = {"琵琶湖", "霞ヶ浦", "サロマ湖", "猪苗代湖", "浜名湖", "宍道湖", "中海", "洞爺湖", "支笏湖", "十和田湖", "田沢湖", "屈斜路湖", "摩周湖", "阿寒湖", "山中湖", "河口湖", "諏訪湖", "芦ノ湖", "中禅寺湖", "浜名湖", "小川原湖", "網走湖", "風蓮湖", "涸沼", "十三湖", "北浦", "八郎潟", "能取湖"}

def overpass(q):
    last = None
    for attempt in range(4):
        for url in ENDPOINTS:
            try:
                req = urllib.request.Request(url, data=urllib.parse.urlencode({"data": q}).encode(), headers={"User-Agent": "kudo-fudo-miseisen lake build (github actions)"})
                with urllib.request.urlopen(req, timeout=600) as r:
                    return json.load(r)
            except Exception as e:
                last = e; print("overpass failed", url, e, file=sys.stderr); time.sleep(10 * (attempt + 1))
    raise SystemExit(f"overpass unreachable: {last}")

def km2(ring):
    if len(ring) < 3: return 0.0
    lat0 = sum(p[1] for p in ring) / len(ring); kx = 111.32 * math.cos(math.radians(lat0)); ky = 110.57
    a = 0.0
    for i in range(len(ring)):
        x1, y1 = ring[i][0] * kx, ring[i][1] * ky; x2, y2 = ring[(i + 1) % len(ring)][0] * kx, ring[(i + 1) % len(ring)][1] * ky; a += x1 * y2 - x2 * y1
    return abs(a) / 2

def dp(pts, eps):
    if len(pts) < 4: return pts
    def d(p, a, b):
        ax, ay, bx, by = a[0], a[1], b[0], b[1]; dx, dy = bx - ax, by - ay
        if dx == 0 and dy == 0: return math.hypot(p[0] - ax, p[1] - ay)
        t = max(0, min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / (dx * dx + dy * dy))); return math.hypot(p[0] - (ax + t * dx), p[1] - (ay + t * dy))
    keep = [False] * len(pts); keep[0] = keep[-1] = True; stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop(); m, k = 0, -1
        for x in range(i + 1, j):
            v = d(pts[x], pts[i], pts[j])
            if v > m: m, k = v, x
        if m > eps: keep[k] = True; stack += [(i, k), (k, j)]
    return [p for p, f in zip(pts, keep) if f]

def inside(pt, ring):
    x, y = pt; c = False; n = len(ring)
    for i in range(n):
        x1, y1 = ring[i]; x2, y2 = ring[(i + 1) % n]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1: c = not c
    return c

def to_ring(geom): return [[round(g["lon"], 5), round(g["lat"], 5)] for g in geom]

def join_rings(members):
    """Outer/inner member ways of a relation -> closed rings (ways are joined end to end)."""
    ways = [to_ring(m["geometry"]) for m in members if m.get("geometry")]
    rings, cur = [], None
    pool = [w for w in ways if len(w) >= 2]
    while pool:
        cur = pool.pop(0)
        grew = True
        while grew and cur[0] != cur[-1]:
            grew = False
            for i, w in enumerate(pool):
                if w[0] == cur[-1]: cur += w[1:]; pool.pop(i); grew = True; break
                if w[-1] == cur[-1]: cur += list(reversed(w))[1:]; pool.pop(i); grew = True; break
                if w[-1] == cur[0]: cur = w[:-1] + cur; pool.pop(i); grew = True; break
                if w[0] == cur[0]: cur = list(reversed(w))[:-1] + cur; pool.pop(i); grew = True; break
        if cur[0] == cur[-1] and len(cur) >= 4: rings.append(cur[:-1])
    return rings

def main(out):
    q = '[out:json][timeout:600];area["ISO3166-1"="JP"][admin_level=2]->.jp;(relation["natural"="water"]["water"~"^(lake|lagoon)$"]["name"]["wikidata"](area.jp);way["natural"="water"]["water"~"^(lake|lagoon)$"]["name"]["wikidata"](area.jp););out geom;'
    data = overpass(q); lakes = []
    for el in data["elements"]:
        tags = el.get("tags", {}); name = tags.get("name:ja") or tags.get("name")
        if el["type"] == "way": outers = [to_ring(el["geometry"])[:-1]] if el.get("geometry") else []; inners = []
        else:
            outers = join_rings([m for m in el.get("members", []) if m.get("role") == "outer"]); inners = join_rings([m for m in el.get("members", []) if m.get("role") == "inner"])
        for o in outers:
            a = km2(o)
            if a < MIN_KM2 and name not in MUST: continue
            holes = [h for h in inners if inside(h[0], o)]
            lakes.append({"name": name, "kind": "brackish" if (name in BRACKISH or tags.get("salt") in ("yes", "brackish") or tags.get("water") == "lagoon") else "lake", "km2": round(a, 1), "outer": o, "holes": holes})
    # islands in the lakes: place=island/islet ways whose first point lies in the lake (the inner rings above are the same islands, drawn as holes)
    big = [l for l in lakes if l["km2"] >= 5]
    if big:
        bbs = "".join(f'way["place"~"^(island|islet)$"]({min(p[1] for p in l["outer"])},{min(p[0] for p in l["outer"])},{max(p[1] for p in l["outer"])},{max(p[0] for p in l["outer"])});' for l in big)
        isl = overpass(f'[out:json][timeout:300];({bbs});out geom;')
        for el in isl["elements"]:
            if not el.get("geometry") or el["geometry"][0] != el["geometry"][-1]: continue
            ring = to_ring(el["geometry"])[:-1]
            for l in big:
                if inside(ring[0], l["outer"]) and not any(inside(ring[0], h) for h in l["holes"]):
                    l["holes"].append(ring); l.setdefault("islands", []).append({"name": el.get("tags", {}).get("name:ja") or el.get("tags", {}).get("name") or "", "km2": round(km2(ring), 3)}); break
    res = []
    for l in sorted(lakes, key=lambda x: -x["km2"]):
        eps = 0.0008 if l["km2"] > 20 else 0.0004
        res.append({"name": l["name"], "kind": l["kind"], "km2": l["km2"], "outer": [[round(x * 1e4) for x in p] for p in dp(l["outer"] + [l["outer"][0]], eps)[:-1]],
                    "holes": [[[round(x * 1e4) for x in p] for p in dp(h + [h[0]], eps / 2)[:-1]] for h in l["holes"] if km2(h) > 0.0005], "islands": l.get("islands", [])})
    json.dump({"note": "日本の主要な湖・汽水湖と湖中島。OpenStreetMap(ODbL)から tools/build_lakes.py が取得・簡略化。座標は 1e-4 度の整数([経度,緯度]×1e4)。", "source": "OpenStreetMap contributors (ODbL)", "lakes": res}, open(out, "w"), ensure_ascii=False, separators=(",", ":"))
    print(len(res), "lakes;", sum(len(l["holes"]) for l in res), "islands/holes;", ", ".join(f'{l["name"]}({l["km2"]})' for l in res[:12]))

if __name__ == "__main__": main(sys.argv[1] if len(sys.argv) > 1 else "src/data/lakes.json")
