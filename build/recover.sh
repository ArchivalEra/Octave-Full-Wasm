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

echo "== 2) 工具链体检（断电后容器内最近写入可能损坏）=="
CMAKE_TGZ=/mnt/hdd/octave-wasm-build/third_party/cmake-3.27.9-linux-x86_64.tar.gz
if sudo docker exec odld /usr/local/bin/cmake --version >/dev/null 2>&1; then
  echo "  cmake: $(sudo docker exec odld /usr/local/bin/cmake --version | head -1)"
else
  echo "  cmake 不可用（可能是 exec format error），从持久包重装…"
  [ -f "$CMAKE_TGZ" ] || { echo "  缺 $CMAKE_TGZ —— 需先下载（见 HANDOFF §3.6 代理）"; exit 1; }
  sudo docker cp "$CMAKE_TGZ" odld:/tmp/cmake.tgz
  sudo docker exec odld bash -c 'rm -rf /opt/cmake-3.27.9-linux-x86_64 /opt/cmake /usr/local/bin/cmake && \
    tar xzf /tmp/cmake.tgz -C /opt && ln -sfn /opt/cmake-3.27.9-linux-x86_64 /opt/cmake && \
    ln -sfn /opt/cmake/bin/cmake /usr/local/bin/cmake && rm -f /tmp/cmake.tgz'
  sudo docker exec odld /usr/local/bin/cmake --version | head -1
fi
# 主产物是否还在（不在说明容器层受损，需从镜像检查点另起容器）
if sudo docker exec odld test -s /usr/src/octave-wasm/src/web/octave.wasm; then
  echo "  主 wasm: $(sudo docker exec odld stat -c%s /usr/src/octave-wasm/src/web/octave.wasm) 字节"
else
  echo "  ⚠ 主 wasm 缺失 —— 从检查点另起：docker run -d --name odld2 octave-build:pic-oct2 sleep infinity"
fi

echo "== 3) 站点目录 =="
# 注意：站点必须从**检查点镜像对应的容器**重建才有意义。dldfcn 核心组
# （convhulln/gzip/… 7 个 .oct）现在走 assets/oct/ 的懒加载车道，所以这里
# 只要把三大件拿回来；资产目录整体从持久盘已有的 site/ 复制即可。
# 旧的 site/oct/ 影子目录（早期 dlopen 实验的遗留）已废弃——那批 .oct 现在
# 在 assets/oct/ 里、由 manifest 管理（批次 13）。
if [ -f "$SITE/octave.wasm" ]; then
  echo "  $SITE 已在（$(du -sh "$SITE" | cut -f1)）"
else
  echo "  站点缺失，从容器重建（三大件 + 桥 + 资产）…"
  mkdir -p "$SITE/assets/oct" "$SITE/assets/m" "$SITE/assets/pkg" "$SITE/assets/data"
  D=/mnt/hdd/octave-wasm-build/dist/octave-full-wasm-site-20260920
  cp -a "$D"/gp "$D"/plotbridge "$D"/plotbridge.js "$D"/octplot.html "$D"/vendor "$SITE/" 2>/dev/null || true
  # 三大件从 **obench**（-O1 检查点，当前基线）取；odld 仍是 -O0 的库
  sudo docker cp obench:/usr/src/octave-wasm/src/web/octave.js "$SITE/"
  sudo docker cp obench:/usr/src/octave-wasm/src/web/octave.wasm "$SITE/"
  sudo docker cp obench:/usr/src/octave-wasm/src/web/octave.data "$SITE/"
  cp "$REPO/bridge/index.html" "$REPO/bridge/assets-loader.js" "$REPO/bridge/webaudio.js" "$REPO/bridge/webnet.js" "$SITE/"
  sudo chown -R "$(id -u):$(id -g)" "$SITE"
fi

echo "== 4) 资产清单 =="
if [ -d "$SITE/assets" ]; then
  python3 "$REPO/build/assets.py" gen-manifest "$SITE" | head -3
fi

echo "== 5) 测试 harness =="
if [ ! -d "$HARNESS/node_modules/playwright-core" ]; then
  echo "  装 playwright-core…"
  mkdir -p "$HARNESS" && cd "$HARNESS"
  [ -f package.json ] || echo '{"name":"owasm-harness","private":true,"type":"module"}' > package.json
  npm install --silent playwright-core
fi
[ -f "$HARNESS/run.sh" ] || printf '#!/bin/sh\nset -e\nH=/mnt/hdd/octave-wasm-build/harness\ncp "$1" "$H/_run.mjs"\nshift\ncd "$H" && exec node _run.mjs "$@"\n' > "$HARNESS/run.sh"
chmod +x "$HARNESS/run.sh"

echo "== 6) 起静态服务（端口 $PORT）=="
if curl -s --noproxy '*' -o /dev/null "http://127.0.0.1:$PORT/" 2>/dev/null; then
  echo "  $PORT 已在服务"
else
  cd "$SITE" && setsid nohup python3 -m http.server "$PORT" --bind 127.0.0.1 --protocol HTTP/1.1 \
    > /mnt/hdd/octave-wasm-build/site-server.log 2>&1 &
  sleep 2
  curl -s --noproxy '*' -o /dev/null -w "  http=%{http_code}\n" "http://127.0.0.1:$PORT/"
fi

echo "== 7) 验收 =="
"$HARNESS/run.sh" "$REPO/test/browser/accept-full.mjs" "http://127.0.0.1:$PORT/" 2>&1 | tail -5
echo "RECOVER DONE"
