#!/usr/bin/env bash
# Speak the storyboard, film it, cut it, and lay out a contact sheet.
# Ported from DigitaleKraamzorg/scripts/video-bundle.sh.
#
#   1. voice    piper speaks every line and writes down how long each took
#   2. record   Playwright walks the storyboard in code-server, holding each
#               step at least that long, and films it at 1920×1080
#   3. render   ffmpeg trims the leader, burns captions, adds cards and voice
#   4. review   3×3 contact sheet (+ steps.png from the render stage)
#
# The order is the point: the picture is cut to the words.
#
# Usage: video.sh [promo|qa]
#   CADDY_DEMO_SILENT=1      captions only, no voice
#   CADDY_DEMO_REUSE_VSIX=1  do not rebuild the extension first
#   CADDY_DEMO_VOICE=…onnx   another piper voice
#   CADDY_DEMO_CLONE=kelvin  cloned voice (needs VOICE_CLONE_SAY=…/packages/voice-clone/bin/say.ts)
#
# Output: vscode-extension/local/video/caddy-tools/<variant>/caddy-tools-<variant>.mp4
set -euo pipefail

EXT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$EXT_ROOT"

VARIANT="${1:-promo}"
NAME="caddy-tools"
case "$VARIANT" in
  promo) PACE=1 ;;
  # qa is for checking each feature step by step: slower, numbered captions.
  qa) PACE=1.6 ;;
  *)
    echo "variant must be promo or qa" >&2
    exit 1
    ;;
esac

command -v ffmpeg >/dev/null || { echo "ffmpeg is required" >&2; exit 1; }
export PATH="$HOME/.local/bin:$PATH"

OUT_DIR="local/video/$NAME/$VARIANT"
mkdir -p "$OUT_DIR"

echo "→ 1/4 voice"
bun run demo/scripts/voice.ts "$VARIANT"

echo "→ 2/4 record"
DEMO_VARIANT="$VARIANT" DEMO_PACE="$PACE" DEMO_VOICE="$OUT_DIR/voice/voice.json" \
  npx playwright test -c demo/playwright.config.ts

echo "→ 3/4 render"
FILM="$(bun run demo/scripts/render.ts "$NAME" "$VARIANT" | tail -1)"

echo "→ 4/4 review"
bash demo/scripts/contact-sheet.sh "$FILM"
DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$FILM")
echo
echo "film:    $FILM  (${DUR}s)"
echo "captions: ${FILM%.mp4}.srt"
echo "sheets:  ${FILM%.mp4}.contact.png  $EXT_ROOT/$OUT_DIR/steps.png"
