#!/usr/bin/env bash
# Stage 43 trial: assemble ONE site from three builds and refuse unless the live Stage 41 root and /stage42/ stay byte-identical.
# usage: tools/stage43-assemble.sh <stage41 dist> <stage42 dist> <stage43 dist> <out dir>
#  - Stage 41 at the root and Stage 42 at /stage42/ must reproduce EVERY file the live site lists in its own deployed-sha256.txt (the live site is
#    first checked against that list, read-only GET); nothing outside /stage43/ may be added or changed; the two record files at the root are kept as they are live.
#  - The Stage 43 bundle must carry its own storage names (stage43trial) and no bare ones; neither older index.html may refer to /stage43/.
#  - The record of this deployment goes to /stage43/deployed-sha256.txt and /stage43/deployed-note.txt.
set -euo pipefail
S41=$1; S42=$2; S43=$3; OUT=$4; LIVE=https://gusk2020.github.io/kudo-fudo-miseisen
rm -rf "$OUT"; mkdir -p "$OUT/stage42" "$OUT/stage43"; tmp=$(mktemp -d)
curl -fsS --max-time 60 -o "$tmp/live-sha256.txt" "$LIVE/deployed-sha256.txt"; curl -fsS --max-time 60 -o "$tmp/live-note.txt" "$LIVE/deployed-note.txt"
echo "live record: $(wc -l < "$tmp/live-sha256.txt") files; $(cat "$tmp/live-note.txt")"
# 1. the live site equals its own record
bad=0; n=0; while read -r h f; do f=${f#./}; l=$(curl -fsS --max-time 60 "$LIVE/$f" | sha256sum | cut -d' ' -f1) || l=none; n=$((n+1)); [ "$l" = "$h" ] || { echo "::error::live file differs from the live record: $f"; bad=$((bad+1)); }; done < "$tmp/live-sha256.txt"
echo "live vs its record: $n files, $bad different"; test "$bad" -eq 0
# 2. assemble
cp -a "$S41/." "$OUT/"; cp -a "$S42/." "$OUT/stage42/"; cp -a "$S43/." "$OUT/stage43/"
cp "$tmp/live-sha256.txt" "$OUT/deployed-sha256.txt"; cp "$tmp/live-note.txt" "$OUT/deployed-note.txt"
# 3. every live file is reproduced byte for byte, and nothing else exists outside /stage43/
bad=0; while read -r h f; do m=$(sha256sum "$OUT/${f#./}" 2>/dev/null | cut -d' ' -f1) || m=none; [ "$m" = "$h" ] || { echo "::error::rebuilt file differs from live: $f"; bad=$((bad+1)); }; done < "$tmp/live-sha256.txt"
expected=$( (sed 's|^[0-9a-f]*  \./||' "$tmp/live-sha256.txt"; echo deployed-sha256.txt; echo deployed-note.txt) | sort)
actual=$(cd "$OUT" && find . -type f -not -path './stage43/*' | sed 's|^\./||' | sort)
if [ "$expected" != "$actual" ]; then echo "::error::files outside /stage43/ differ from the live list"; diff <(echo "$expected") <(echo "$actual") || true; bad=$((bad+1)); fi
echo "Stage 41 root + /stage42/ vs live: $bad problems"; test "$bad" -eq 0
# 4. references and storage names
if grep -q '/kudo-fudo-miseisen/stage43/' "$OUT/index.html" "$OUT/stage42/index.html"; then echo "::error::an older index.html refers to /stage43/"; exit 1; fi
grep -q '/kudo-fudo-miseisen/stage43/' "$OUT/stage43/index.html"
grep -rlq 'stage43trial' "$OUT/stage43/assets/" || { echo "::error::Stage 43 storage names missing"; exit 1; }
if grep -rEq 'localStorage\.(get|set|remove)Item\("kfm' "$OUT/stage43/assets"; then echo "::error::a bare storage key in Stage 43"; exit 1; fi
if grep -rEq 'indexedDB\.open\("kfm-stage1"' "$OUT/stage43/assets"; then echo "::error::the real game's database name in Stage 43"; exit 1; fi
# 5. the record of this deployment, under /stage43/ only
(cd "$OUT" && find . -type f -not -name 'deployed-*.txt' -print0 | sort -z | xargs -0 sha256sum) > "$tmp/all.txt"; cp "$tmp/all.txt" "$OUT/stage43/deployed-sha256.txt"
echo "Stage 43 trial source: ${STAGE43_SHA:-unknown}; Stage 42: 2fc9922dc4297238efa32f79dce4247aeedae466; Stage 41 root: 9e0a8c805f29af18e8cf018254832d79573aa5c7" > "$OUT/stage43/deployed-note.txt"
echo "assembled OK: $(cd "$OUT" && find . -type f | wc -l) files"
