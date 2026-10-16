#!/usr/bin/env python3
"""Summarise tests/study output: key metrics at chosen years, decade activity, and the size of era vs policy effects."""
import json, sys, os, statistics as st
d = sys.argv[1]; names = sys.argv[2].split(",") if len(sys.argv) > 2 else sorted(f[:-5] for f in os.listdir(d) if f.endswith(".json"))
R = {n: json.load(open(f"{d}/{n}.json")) for n in names if os.path.exists(f"{d}/{n}.json")}
YEARS = [1970, 1990, 2010, 2050, 2100]
def at(r, y): return next((x for x in r["rows"] if x["year"] == y), r["rows"][-1])
def act(r, y0, y1, keys):
    s = 0
    for dd in r["dec"]:
        if y0 < dd["year"] <= y1: s += sum(v for k, v in dd.items() if k != "year" and any(k.endswith(x) or x in k for x in keys))
    return s
cols = [("roadKm", "道路km"), ("roadHigh", "高規格"), ("railKm", "鉄道km"), ("railRural", "地方鉄道"), ("railPriv", "私鉄km"), ("paxRailShare", "旅客鉄道"), ("frRailShare", "貨物鉄道"), ("lostRoadKm", "廃道km"), ("closedRailKm", "廃線km"), ("bypass", "BP"), ("unbuilt", "未成")]
for y in YEARS:
    print(f"\n== {y} ==")
    print("scen      " + " ".join(f"{c[1]:>7}" for c in cols))
    for n, r in R.items():
        x = at(r, y); print(f"{n:9} " + " ".join(f"{x[c[0]]:>7}" for c in cols))
print("\n== 1950-2100 activity (count of projects reaching the state) ==")
K = [("road.new.open", "道路新設"), ("road.access.open", "集落道"), ("road.bypass.open", "BP開通"), ("road.improve.open", "改良"), ("rail.new.open", "鉄道新線"), ("rail.electrify.open", "電化等"), ("rail.restore.open", "復活"), (".unbuilt", "未成化"), ("road.open>dormant", "道休止"), ("rail.open>dormant", "鉄休止"), ("closed>lost", "廃道/線化")]
print("scen      " + " ".join(f"{k[1]:>7}" for k in K) + "  wall maxMonthMs")
for n, r in R.items(): print(f"{n:9} " + " ".join(f"{act(r, 1950, 2100, [k[0]]):>7}" for k in K) + f"  {r['wallS']:>5} {r['maxMonthMs']:>5}")
def spread(group, key, y):
    v = [at(R[g], y)[key] for g in group if g in R]; return (max(v) - min(v)) if len(v) > 1 else 0
eraG, polG = ["H-auto", "S-auto", "R-auto"], ["H-auto", "H-none", "H-road", "H-rail"]
print("\n== era vs policy spread (max-min) ==")
for key in ["roadKm", "roadHigh", "railKm", "paxRailShare", "frRailShare", "closedRailKm"]:
    print(f"{key:13} " + " ".join(f"{y}: era {spread(eraG, key, y):>7.3g} / pol {spread(polG, key, y):>7.3g} |" for y in [1990, 2050, 2100]))
