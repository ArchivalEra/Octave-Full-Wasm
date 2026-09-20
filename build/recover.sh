#!/bin/sh
# Octave-Full-Wasm — 断电/重启后一键恢复
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# 2026-09-20 断过一次电，教训是：**宿主机 /tmp 是 tmpfs，站点和测试脚本放那儿必丢**。
# 现在所有可变状态都落在持久盘，这个脚本负责把"跑起来"的部分复原：
#
#   容器（docker restart 后是 Exited 状态）→ 站点目录 → 8761 静态服务 → 浏览器验收
#
# 幂等：重复跑不会破坏已有站点（只在站点缺失时才从容器里重建）。
# 用法：sh build/recover.sh [端口]      默认 8761
set -e
PORT=${1:-8761}
SITE=/mnt/hdd/octave-wasm-build/site
HARNESS=/mnt/hdd/octave-wasm-build/harness
REPO=/mnt/hdd/zcode-projects/Octave-Full-Wasm

echo "== 1) 起容器 =="
for c in obuild odld; do
  if sudo docker ps --format '{{.Names}}' | grep -qx "$c"; then
    echo "  $c 已在运行"
  else
    sudo docker start "$c" >/dev/null && echo "  $c 已启动"
  fi
done

echo "== 2) 站点目录 =="
if [ -f "$SITE/octave.wasm" ]; then
  echo "  $SITE 已在（$(du -sh "$SITE" | cut -f1)）"
else
  echo "  站点缺失，从 odld 容器重建…"
  mkdir -p "$SITE/oct" "$SITE/assets/oct" "$SITE/assets/m"
  D=/mnt/hdd/octave-wasm-build/dist/octave-full-wasm-site-20260920
  cp -a "$D"/gp "$D"/plotbridge "$D"/plotbridge.js "$D"/octplot.html "$D"/vendor "$SITE/" 2>/dev/null || true
  sudo docker cp odld:/usr/src/octave-wasm/src/web/octave.js "$SITE/"
  sudo docker cp odld:/usr/src/octave-wasm/src/web/octave.wasm "$SITE/"
  sudo docker cp odld:/usr/src/octave-wasm/src/web/octave.data "$SITE/"
  sudo docker cp odld:/octs/dldprobe.oct "$SITE/"
  sudo docker cp odld:/octs/gzip.oct "$SITE/oct/"
  sudo docker cp odld:/octs/convhulln.oct "$SITE/oct/"
  cp "$REPO/bridge/index.html" "$REPO/bridge/assets-loader.js" "$SITE/"
  sudo chown -R "$(id -u):$(id -g)" "$SITE"
fi

echo "== 3) 资产清单 =="
if [ -d "$SITE/assets" ]; then
  python3 "$REPO/build/assets.py" gen-manifest "$SITE" | head -3
fi

echo "== 4) 测试 harness =="
if [ ! -d "$HARNESS/node_modules/playwright-core" ]; then
  echo "  装 playwright-core…"
  mkdir -p "$HARNESS" && cd "$HARNESS"
  [ -f package.json ] || echo '{"name":"owasm-harness","private":true,"type":"module"}' > package.json
  npm install --silent playwright-core
fi
[ -f "$HARNESS/run.sh" ] || printf '#!/bin/sh\nset -e\nH=/mnt/hdd/octave-wasm-build/harness\ncp "$1" "$H/_run.mjs"\nshift\ncd "$H" && exec node _run.mjs "$@"\n' > "$HARNESS/run.sh"
chmod +x "$HARNESS/run.sh"

echo "== 5) 起静态服务（端口 $PORT）=="
if curl -s --noproxy '*' -o /dev/null "http://127.0.0.1:$PORT/" 2>/dev/null; then
  echo "  $PORT 已在服务"
else
  cd "$SITE" && setsid nohup python3 -m http.server "$PORT" --bind 127.0.0.1 --protocol HTTP/1.1 \
    > /mnt/hdd/octave-wasm-build/site-server.log 2>&1 &
  sleep 2
  curl -s --noproxy '*' -o /dev/null -w "  http=%{http_code}\n" "http://127.0.0.1:$PORT/"
fi

echo "== 6) 验收 =="
"$HARNESS/run.sh" "$REPO/test/browser/accept-full.mjs" "http://127.0.0.1:$PORT/" 2>&1 | tail -5
echo "RECOVER DONE"
