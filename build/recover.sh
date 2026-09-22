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
# ══════════════════════════════════════════════════════════════════════════════
# ★ 2026-09-22 换基线：8761 现在是 **Octave 11.3.0**，不再是 7.2。
#   这个脚本的取值源因此整体搬了家 —— 这正是"换基线必须同时改 recover.sh"的原因：
#   不改的话，下次断电恢复会把 8761 **悄悄打回 7.2**。
#     三大件来源   obench:/usr/src/octave-wasm/src/web/  →  **o113:/src/websrc/out/**
#     站点内容来源 现场拼装                                →  **site113/**（已组装好的 11.3.0 站点）
#     清单处理     重新 gen-manifest                       →  **只读核对摘要**（不再重算）
#   回退到 7.2（两条路都在盘上，随时可用）：
#     cp -a /mnt/hdd/octave-wasm-build/site-72bak/. /mnt/hdd/octave-wasm-build/site/
#     （7.2 的三大件仍在 obench 里；旧版脚本见本文件的 git 历史）
# ══════════════════════════════════════════════════════════════════════════════
#
# 幂等：站点三大件存在且已是 11.3.0 就不动；资产目录只在缺失时补。
# 用法：sh build/recover.sh [端口]      默认 8761
set -e
PORT=${1:-8761}
SITE=/mnt/hdd/octave-wasm-build/site
SRC_SITE=/mnt/hdd/octave-wasm-build/site113
HARNESS=/mnt/hdd/octave-wasm-build/harness
REPO=/mnt/hdd/zcode-projects/Octave-Full-Wasm

echo "== 1) 起容器 =="
for c in obuild odld obench o113; do
  if sudo docker ps --format '{{.Names}}' | grep -qx "$c"; then
    echo "  $c 已在运行"
  else
    sudo docker start "$c" >/dev/null && echo "  $c 已启动"
  fi
done

echo "== 2) o113 体检（11.3.0 的构建容器）=="
if sudo docker exec o113 /usr/bin/cmake --version >/dev/null 2>&1; then
  echo "  cmake: $(sudo docker exec o113 /usr/bin/cmake --version | head -1)"
else
  echo "  ⚠ o113 的 cmake 不可用（Ubuntu 自带包，重装：apt-get install -y cmake）"
fi
if sudo docker exec o113 test -s /src/websrc/out/octave.wasm; then
  echo "  主 wasm: $(sudo docker exec o113 stat -c%s /src/websrc/out/octave.wasm) 字节"
else
  echo "  ⚠ 主 wasm 缺失 —— 从检查点另起并重链："
  echo "     docker run -d --name o113b octave-build:113-assets-full sleep infinity"
  echo "     docker exec o113b bash -c 'cd /src/bin && PATH=/src/bin:\$PATH bash link-web.sh'"
fi
for p in /src/work/octave-install /src/deps/sundials /src/deps/suitesparse; do
  if sudo docker exec o113 test -d "$p"; then echo "  $p 在"; else echo "  ⚠ 缺 $p"; fi
done

echo "== 3) 站点目录（8761 = 11.3.0）=="
if [ -f "$SITE/octave.wasm" ] && [ -f "$SITE/VERSION" ] && grep -q "11\.3\.0" "$SITE/VERSION" 2>/dev/null; then
  echo "  $SITE 已是 11.3.0（$(du -sh "$SITE" | cut -f1)）"
else
  echo "  站点缺失或仍是旧内容，重新组装…"
  [ -d "$SRC_SITE" ] || { echo "  FATAL: 连 $SRC_SITE 都没有，无法组装" >&2; exit 1; }
  mkdir -p "$SITE"
  # 资产/桥/fixture 全从 site113 搬（它含 minioct/dldprobe/vendor/lanetest 等）
  cp -a "$SRC_SITE"/. "$SITE"/
  # 三大件以**容器里的当前链接**为准（site113 里的可能滞后）
  sudo docker cp o113:/src/websrc/out/octave.js   "$SITE/"
  sudo docker cp o113:/src/websrc/out/octave.wasm "$SITE/"
  sudo docker cp o113:/src/websrc/out/octave.data "$SITE/"
  # 桥从仓库取当前版本（仓库是这些文件的唯一真相源）
  cp "$REPO/bridge/index.html" "$REPO/bridge/assets-loader.js" \
     "$REPO/bridge/webaudio.js" "$REPO/bridge/webaudiorec.js" \
     "$REPO/bridge/webfilepick.js" \
     "$REPO/bridge/webnet.js" "$SITE/"
  echo "octave-11.3.0" > "$SITE/VERSION"
  sudo chown -R "$(id -u):$(id -g)" "$SITE"
fi

echo "== 4) 资产清单完整性核对（**只读**，不再 gen-manifest）=="
# 为什么不重算：site113 清单里 file 类资产的 mount 指向
# `<prefix>/share/octave/11.3.0/etc/`，是 11.3.0 专属路径；拿 7.2 时代的
# build/assets.py gen-manifest 重算会把它们算错。这里只验证摘要是否还匹配。
python3 - "$SITE" <<'PY'
import hashlib, json, os, sys
site = sys.argv[1]
mp = os.path.join(site, 'assets', 'manifest.json')
if not os.path.exists(mp):
    print('  没有 assets/manifest.json —— 跳过'); raise SystemExit(0)
m = json.load(open(mp, encoding='utf-8'))
bad = miss = okc = 0
for a in m.get('assets', []):
    if a.get('kind') == 'octdir':
        base, files = a.get('base_url'), a.get('files') or []
        for f in files:
            if not os.path.exists(os.path.join(site, base, f)):
                print(f'  缺文件: {base}/{f}'); miss += 1
        continue
    url, want = a.get('url'), a.get('sha256')
    if not url or not want: continue
    p = os.path.join(site, url)
    if not os.path.exists(p): print(f'  缺文件: {url}'); miss += 1; continue
    h = hashlib.sha256(open(p, 'rb').read()).hexdigest()
    if h != want: print(f'  ✗ 摘要不符: {url}（清单 {want[:12]}… 实得 {h[:12]}…）'); bad += 1
    else: okc += 1
print(f'  摘要核对：一致 {okc}，不符 {bad}，缺文件 {miss}')
PY

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

echo "== 7) 起手体检 =="
echo "  —— 需求级（一屏看全 R1–R10 + 架构护栏）"
"$HARNESS/run.sh" "$REPO/test/browser/accept-requirements.mjs" "http://127.0.0.1:$PORT/" 2>&1 | tail -4
echo "  —— 核心回归（批次类）"
"$HARNESS/run.sh" "$REPO/test/browser/accept-full.mjs" "http://127.0.0.1:$PORT/" 2>&1 | tail -3
echo "RECOVER DONE（8761 = Octave 11.3.0；回退办法见本脚本头部注释）"
