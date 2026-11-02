#!/usr/bin/env bash
# Review a film without watching it: 9 evenly spaced frames in one 3×3 PNG.
# Ported from asd-manager/scripts/e2e/video-contact-sheet.sh.
#
# One look at the sheet costs a fraction of watching the film; each tile is
# stamped with its timestamp so a note can say "the 41.2s tile".
#
# Usage: contact-sheet.sh <input.mp4> [output.png]   (default: <input>.contact.png)
set -euo pipefail

IN="${1:?usage: contact-sheet.sh <input.mp4> [output.png]}"
OUT="${2:-${IN%.*}.contact.png}"

DURATION=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$IN")
[[ -n "$DURATION" && "$DURATION" != "0" ]] || { echo "error: no duration for $IN" >&2; exit 1; }

PCTS="0.03 0.15 0.27 0.39 0.51 0.63 0.75 0.87 0.98"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

i=0
for pct in $PCTS; do
  T=$(awk -v d="$DURATION" -v p="$pct" 'BEGIN{printf "%.2f", d*p}')
  ffmpeg -y -loglevel error -ss "$T" -i "$IN" -frames:v 1 \
    -vf "scale=640:360,drawtext=text='${T}s':x=10:y=10:fontsize=24:fontcolor=white:box=1:boxcolor=black@0.7:boxborderw=5" \
    "$WORK/$(printf '%02d' $i).png"
  i=$((i + 1))
done

ffmpeg -y -loglevel error \
  -i "$WORK/00.png" -i "$WORK/01.png" -i "$WORK/02.png" \
  -i "$WORK/03.png" -i "$WORK/04.png" -i "$WORK/05.png" \
  -i "$WORK/06.png" -i "$WORK/07.png" -i "$WORK/08.png" \
  -filter_complex "[0][1][2]hstack=3[t];[3][4][5]hstack=3[m];[6][7][8]hstack=3[b];[t][m][b]vstack=3" \
  "$OUT"

echo "$OUT  (${DURATION}s)"
