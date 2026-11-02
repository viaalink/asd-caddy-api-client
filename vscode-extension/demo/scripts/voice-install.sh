#!/usr/bin/env bash
# Put an English piper voice on this machine, once.
#
# Piper is a small local ONNX model, not a service: no key, nothing uploaded.
# The model lands in vscode-extension/local/piper/, which is git-ignored.
#
# Good English voices from rhasspy/piper-voices: en_US-lessac-high (default,
# clear and neutral), en_US-lessac-medium, en_US-ryan-high, en_GB-alan-medium,
# en_GB-northern_english_male-medium. Pick another with
# `just vscode-demo-voice-install <name>` and set CADDY_DEMO_VOICE to the .onnx.
#
# Ported from DigitaleKraamzorg/scripts/video-voice-install.sh.
set -euo pipefail

EXT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$EXT_ROOT"

VOICE="${1:-en_US-lessac-high}"
DIR="local/piper"

if ! command -v piper >/dev/null; then
  command -v uv >/dev/null || {
    echo "uv is missing — install it first, or install piper-tts yourself" >&2
    exit 1
  }
  echo "→ installing piper-tts"
  uv tool install piper-tts
fi

mkdir -p "$DIR"
if [[ -f "$DIR/$VOICE.onnx" ]]; then
  echo "$VOICE is already here"
else
  echo "→ downloading $VOICE"
  # The downloader ships inside the piper package rather than on its CLI, so it
  # is called through the interpreter uv installed it against.
  PIPER_PY="$(dirname "$(readlink -f "$(command -v piper)")")/python"
  "$PIPER_PY" -m piper.download_voices --download-dir "$DIR" "$VOICE"
fi

echo "→ sample"
echo "Caddy Configuration Tools brings IntelliSense to your Caddy config." |
  piper -m "$DIR/$VOICE.onnx" -f "$DIR/sample-$VOICE.wav"
ls -lh "$DIR/$VOICE.onnx" "$DIR/sample-$VOICE.wav"
echo "listen to the sample; another voice is one argument away"
