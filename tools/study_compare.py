#!/usr/bin/env python3
"""Markdown comparison of two study runs (before / after): python3 tools/study_compare.py OLD NEW"""
import json, sys, os
O, N = sys.argv[1], sys.argv[2]
def L(d, n): return json.load(open(f"{d}/{n}.json"))
def at(r, y): return next((x for x in r["rows"] if x["year"] == y), r["rows"][-1])
def act(r, k): return sum(v for dd in r["dec"] for kk, v in dd.items() if kk != "year" and k in kk)
S = ["H-auto", "S-auto", "R-auto", "S-later1", "R-later1", "H-none", "H-road", "H-rail", "H-cap47"]
print("| 条件 | 年 | 道路km | 高規格km | 鉄道km | 地方鉄道km | 旅客の鉄道分担 | 貨物の鉄道分担 | 廃線km累計 | 廃道km累計 |\n|---|---|---|---|---|---|---|---|---|---|")
for n in S:
    o, nn = L(O, n), L(N, n)
    for y in (1990, 2050):
        a, b = at(o, y), at(nn, y)
        f = lambda k, p=0: f"{a[k]:.{p}f}→**{b[k]:.{p}f}**" if p else f"{a[k]}→**{b[k]}**"
        print(f"| {n} | {y} | {f('roadKm')} | {f('roadHigh')} | {f('railKm')} | {f('railRural')} | {f('paxRailShare', 2)} | {f('frRailShare', 2)} | {f('closedRailKm')} | {f('lostRoadKm')} |")
print("\n| 条件 | 道路新設 | 地方道・集落道 | バイパス | 改良 | 鉄道新線 | 赤字線廃止 | 工事凍結 | 未成化 |\n|---|---|---|---|---|---|---|---|---|")
for n in S:
    o, nn = L(O, n), L(N, n)
    c = lambda r, k: act(r, k)
    print(f"| {n} | {c(o,'road.new.open')}→**{c(nn,'road.new.open')}** | {c(o,'road.access.open')}→**{c(nn,'road.access.open')}** | {c(o,'road.bypass.open')}→**{c(nn,'road.bypass.open')}** | {c(o,'road.improve.open')}→**{c(nn,'road.improve.open')}** | {c(o,'rail.new.open')}→**{c(nn,'rail.new.open')}** | – | {c(o,'suspended')}→**{c(nn,'suspended')}** | {c(o,'unbuilt')}→**{c(nn,'unbuilt')}** |")
