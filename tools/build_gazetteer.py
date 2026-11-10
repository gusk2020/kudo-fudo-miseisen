#!/usr/bin/env python3
"""Stage 40: build the 2000-10-01 municipality gazetteer (names + one representative point each) from the
国土数値情報 行政区域データ N03 (v2.2, 平成12年=2000-10-01), one GML zip per prefecture.
Output: compact JSON. Polygons are NOT kept: they are used only to find one representative point per municipality.
Usage: build_gazetteer.py <dir-with-zips> <out.json>"""
import sys, os, json, math, glob, zipfile, io, re
import xml.etree.ElementTree as ET
NS = {"gml": "http://www.opengis.net/gml/3.2", "ksj": "http://nlftp.mlit.go.jp/ksj/schemas/ksj-app", "xlink": "http://www.w3.org/1999/xlink"}
HREF = "{%s}href" % NS["xlink"]; GID = "{%s}id" % NS["gml"]
def ln(t): return t.rsplit("}", 1)[-1]
def parse(path):
    z = zipfile.ZipFile(path); name = [n for n in z.namelist() if n.lower().endswith("-g.xml") and not n.startswith("KS-META")][0]
    root = ET.fromstring(z.read(name)); curves = {}
    for c in root.iter("{%s}Curve" % NS["gml"]):
        pts = []
        for pl in c.iter("{%s}posList" % NS["gml"]):
            v = [float(x) for x in pl.text.split()]; pts += [(v[i + 1], v[i]) for i in range(0, len(v) - 1, 2)]   # (lon, lat): the file lists lat first
        curves[c.get(GID)] = pts
    surfaces = {}
    for s in root.iter("{%s}Surface" % NS["gml"]):
        rings = []
        for el in s.iter():
            if ln(el.tag) in ("exterior", "interior"):
                pts = []
                for r in el.iter():
                    h = r.get(HREF)
                    if h and h.startswith("#") and h[1:] in curves:
                        cp = curves[h[1:]]; pts += cp[::-1] if r.get("orientation") == "-" else cp
                rings.append((ln(el.tag), pts))
        surfaces[s.get(GID)] = rings
    out = []
    for b in root.iter("{%s}AdministrativeBoundary" % NS["ksj"]):
        g = lambda t: (b.find("ksj:" + t, NS).text or "").strip() if b.find("ksj:" + t, NS) is not None else ""
        h = b.find("ksj:bounds", NS).get(HREF)[1:]
        out.append({"code": g("administrativeAreaCode"), "pref": g("prefectureName"), "sub": g("subPrefectureName"), "county": g("countyName"), "city": g("cityName"), "rings": surfaces.get(h, [])})
    return out
def area_km2(pts):
    if len(pts) < 3: return 0.0
    lat0 = sum(p[1] for p in pts) / len(pts); kx = 111.32 * math.cos(math.radians(lat0)); ky = 110.57; a = 0.0
    for i in range(len(pts)):
        x1, y1 = pts[i]; x2, y2 = pts[(i + 1) % len(pts)]; a += (x1 * kx) * (y2 * ky) - (x2 * kx) * (y1 * ky)
    return a / 2
def centroid(pts):
    a = 0.0; cx = cy = 0.0
    for i in range(len(pts)):
        x1, y1 = pts[i]; x2, y2 = pts[(i + 1) % len(pts)]; f = x1 * y2 - x2 * y1; a += f; cx += (x1 + x2) * f; cy += (y1 + y2) * f
    if abs(a) < 1e-18: return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))
    return (cx / (3 * a), cy / (3 * a))
def inside(pt, ring):
    x, y = pt; c = False
    for i in range(len(ring)):
        x1, y1 = ring[i]; x2, y2 = ring[(i + 1) % len(ring)]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1: c = not c
    return c
def rep_point(ext, holes):
    c = centroid(ext)
    if inside(c, ext) and not any(inside(c, h) for h in holes): return c
    y = c[1]; xs = []
    for ring in [ext] + holes:
        for i in range(len(ring)):
            x1, y1 = ring[i]; x2, y2 = ring[(i + 1) % len(ring)]
            if (y1 > y) != (y2 > y): xs.append((x2 - x1) * (y - y1) / (y2 - y1) + x1)
    xs.sort(); best = None
    for i in range(0, len(xs) - 1, 2):
        if best is None or xs[i + 1] - xs[i] > best[1] - best[0]: best = (xs[i], xs[i + 1])
    return ((best[0] + best[1]) / 2, y) if best else ext[len(ext) // 2]
def main(zdir, outp):
    recs = {}
    for z in sorted(glob.glob(os.path.join(zdir, "*.zip"))):
        for r in parse(z):
            if not r["code"] or not r["city"]: continue
            ext = [p for k, p in r["rings"] if k == "exterior" and len(p) >= 3]; holes = [p for k, p in r["rings"] if k == "interior" and len(p) >= 3]
            if not ext: continue
            big = max(ext, key=lambda p: abs(area_km2(p))); pt = rep_point(big, [h for h in holes if inside(h[0], big)])
            e = recs.setdefault((r["code"], r["city"]), {"code": r["code"], "pref": r["pref"], "sub": r["sub"], "county": r["county"], "city": r["city"], "area": 0.0, "n": 0, "best": -1.0, "pt": None})
            ar = abs(area_km2(big)); e["area"] += sum(abs(area_km2(p)) for p in ext); e["n"] += 1
            if ar > e["best"]: e["best"] = ar; e["pt"] = pt
    items = []
    for e in sorted(recs.values(), key=lambda e: (e["code"], e["city"])):
        items.append([e["code"], e["pref"], e["city"], e["county"], e["sub"], round(e["pt"][0], 4), round(e["pt"][1], 4), round(e["area"], 1), e["n"]])
    doc = {"source": "国土数値情報 行政区域データ N03 v2.2 (2000-10-01, 平成12年) -- 国土交通省", "url": "https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N03-v2_2.html",
           "license": "公共データ利用規約(PDL1.0) / 出典: 国土交通省国土数値情報ダウンロードサイト", "note": "編集・加工: 市区町村ごとに名称・コード・所属・代表点(最大のポリゴンの重心。外側なら最長の水平弦の中点)・面積(km2)・ポリゴン数だけを抽出。境界ポリゴンは含まない。基準日の名称は国土数値情報の表記のままで、史実の1800年の行政区分ではない",
           "fields": ["code", "pref", "name", "county", "subPref", "lon", "lat", "areaKm2", "polygons"], "count": len(items), "items": items}
    os.makedirs(os.path.dirname(outp) or ".", exist_ok=True)
    json.dump(doc, open(outp, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":")); print("municipalities", len(items), "bytes", os.path.getsize(outp))
if __name__ == "__main__": main(sys.argv[1], sys.argv[2])
