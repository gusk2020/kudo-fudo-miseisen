import sys, glob, os, json
from fontTools.ttLib import TTFont
from fontTools import subset
cps = [int(x,16) for x in "963F 2668 2200 5143 1D11E 16A0 2318 592A 10380 A000 1F702 2665 2325 3090 2202 2C00 1D122 203B 0531 ABC0 10A71 A9C5 263F 5700 2660 2203 11005 269B 10D0 20BF 10280 21A04 232C 13A1 26E9 10900 263E 9741 0905 1700 10000 A800 1B001 130C0 2756 0294 17F07 260A 169B 309F 521D 3091 AC00 221E A66E 59CB 3105".split()]
root = sys.argv[1]; out = sys.argv[2]; os.makedirs(out, exist_ok=True)
# every 400-weight normal woff2 file of every package, with its cmap
files = sorted(glob.glob(root + "/node_modules/@fontsource/*/files/*-400-normal.woff2"))
need = set(cps); by_file = {}
order = ["noto-sans-jp","noto-sans-symbols","noto-sans-symbols-2","noto-sans-math","noto-music"]
def rank(f):
    pkg = f.split("/@fontsource/")[1].split("/")[0]
    return (order.index(pkg) if pkg in order else 99, f)
files.sort(key=rank)
for f in files:
    if not need: break
    try: cm = TTFont(f, lazy=True).getBestCmap()
    except Exception as e: continue
    got = [c for c in need if c in cm]
    if got: by_file[f] = got; need -= set(got)
print("missing:", [hex(c) for c in sorted(need)])
css = []; total = 0; rep = {}
for f, got in by_file.items():
    pkg = f.split("/@fontsource/")[1].split("/")[0]; name = "kfm-sym-" + pkg + "-" + "_".join("%x" % c for c in sorted(got))[:40] + ".woff2"
    opt = subset.Options(); opt.flavor = "woff2"; opt.layout_features = []; opt.name_IDs = [1,2]; opt.notdef_outline = False; opt.glyph_names = False; opt.hinting = False; opt.desubroutinize = True
    font = subset.load_font(f, opt); s = subset.Subsetter(opt); s.populate(unicodes=got); s.subset(font); subset.save_font(font, os.path.join(out, name), opt)
    sz = os.path.getsize(os.path.join(out, name)); total += sz; rep.setdefault(pkg, []).extend(got)
    css.append((name, sorted(got)))
json.dump({"files": css, "bytes": total, "missing": sorted(need), "packages": {k: ["U+%04X" % c for c in sorted(v)] for k, v in rep.items()}}, open(os.path.join(out, "report.json"), "w"), indent=1)
print(len(css), "files", total, "bytes"); print({k: len(v) for k, v in rep.items()})
