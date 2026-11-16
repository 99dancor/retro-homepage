#!/bin/sh
# Holt den melonDS-Kern (libretro, WebAssembly, aus dem EmulatorJS-Projekt, GPL-3.0) nach public/ds-core.
# Das Dockerfile macht dasselbe im Image; beim Entwickeln: npm run ds-core (braucht 7z, z. B. apt install 7zip).
set -e
SEVENZ="$(command -v 7z || command -v 7zz || command -v 7za || true)"
[ -n "$SEVENZ" ] || { echo "7z fehlt (apt install 7zip / apk add 7zip)" >&2; exit 1; }
VERSION="${DS_CORE_VERSION:-4.2.3}"
OUT="$(cd "$(dirname "$0")/.." && pwd)/public/ds-core"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cd "$TMP"
npm pack "@emulatorjs/core-melonds@$VERSION" --silent >/dev/null
tar xzf emulatorjs-core-melonds-"$VERSION".tgz
mkdir -p "$OUT"
"$SEVENZ" x -y -o"$OUT" package/melonds-wasm.data melonds_libretro.js melonds_libretro.wasm license.txt >/dev/null
cat > "$OUT/QUELLE.txt" <<EOT
melonDS als libretro-Kern für den Browser, aus @emulatorjs/core-melonds $VERSION (npm).
Lizenz: GPL-3.0 (license.txt). Quelltext: https://github.com/EmulatorJS/melonDS und https://github.com/EmulatorJS/RetroArch
EOT
echo "DS-Kern $VERSION in $OUT"
