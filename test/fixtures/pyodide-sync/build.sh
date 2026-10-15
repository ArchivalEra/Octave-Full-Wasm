#!/usr/bin/env sh
# 编"同步调 Pyodide"探针 + 组站点（probe-pyodide-sync.mjs 的前置）
# SPDX-License-Identifier: AGPL-3.0-or-later
# 用法：sh test/fixtures/pyodide-sync/build.sh
#   ⇒ /mnt/hdd/octave-wasm-build/pyodide-sync-probe/{probe.mjs,probe.wasm,pyodide/,index.html}
# 前置：已 provision Pyodide（build/113/provision-pyodide.sh fetch）
set -eu
REPO="$(cd "$(dirname "$0")/../../.." && pwd)"
CTR="${CTR:-o113}"
D="${PROBE_DIR:-/mnt/hdd/octave-wasm-build/pyodide-sync-probe}"
SITE="${SITE_DIR:-/mnt/hdd/octave-wasm-build/site}"

[ -f "$SITE/assets/pyodide/pyodide/pyodide.mjs" ] || { echo "FATAL: 先跑 provision-pyodide.sh fetch" >&2; exit 3; }

sudo docker cp "$REPO/test/fixtures/pyodide-sync/probe.c" "$CTR:/tmp/probe.c"
sudo docker exec "$CTR" bash -lc "cd /tmp && /emsdk/upstream/emscripten/emcc -O2 -sEXIT_RUNTIME=1 \
  -sEXPORTED_RUNTIME_METHODS=UTF8ToString,stringToUTF8 -o probe.mjs probe.c"
mkdir -p "$D"
sudo docker cp "$CTR:/tmp/probe.mjs" "$D/probe.mjs"
sudo docker cp "$CTR:/tmp/probe.wasm" "$D/probe.wasm"
cp -r "$SITE/assets/pyodide" "$D/pyodide"
sudo chown -R "$(id -u):$(id -g)" "$D"
cat > "$D/index.html" <<'HTML'
<!doctype html><meta charset="utf-8"><title>pyodide sync probe</title>
<script type="module">
import { loadPyodide } from './pyodide/pyodide.mjs';
window.__result = { phase: 'start' };
try {
  const t0 = performance.now();
  const pyodide = await loadPyodide({ indexURL: './pyodide/' });
  await pyodide.loadPackage(['sympy']);
  window.pyodide = pyodide;
  window.__result.pyodideReadyMs = Math.round(performance.now() - t0);
  const mod = await import('./probe.mjs');
  const inst = await mod.default();
  window.__result.rc = inst._main ? inst._main() : 0;
  window.__result.phase = 'done';
} catch (e) { window.__result = { phase: 'error', error: String(e).slice(0, 400) }; }
</script>
HTML
echo "探针站点就绪：$D"
