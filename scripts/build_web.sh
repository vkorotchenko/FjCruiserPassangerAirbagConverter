#!/usr/bin/env bash
# Gzip the SPA from web/ into data_esp/ for the ESP32 LittleFS image.
# AsyncWebServer serves the .gz variants transparently (Content-Encoding: gzip).
#
# Usage:
#   scripts/build_web.sh
#   pio run -e esp32 -t uploadfs     # flash the image to the ESP32
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/web"
OUT="$ROOT/data_esp"

mkdir -p "$OUT"
rm -f "$OUT"/*.gz

for f in index.html app.css app.js; do
  gzip -9 -c "$SRC/$f" > "$OUT/$f.gz"
  printf '  %-12s %6d -> %6d bytes\n' "$f" "$(wc -c < "$SRC/$f")" "$(wc -c < "$OUT/$f.gz")"
done

echo "Wrote gzipped assets to data_esp/. Flash with: pio run -e esp32 -t uploadfs"
