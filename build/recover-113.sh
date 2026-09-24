#!/bin/sh
# Octave-Full-Wasm — 11.3.0 车道（8762）的断电/重启一键恢复
# Copyright (C) 2026 ArchivalEra
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# ── 这个脚本为什么存在（HISTORY §10.6 第 5 项的"拦路雷"）──────────────────
# 根目录的 `build/recover.sh` 是给 **8761（7.2 基线）** 用的：站点三大件它从
# **obench** 取（那是 7.2 的检查点）。等哪天把 8761 换成 11.3.0 时，
# 如果不改它，**下次断电恢复就会把 8761 悄悄打回 7.2**。
#
# 所以这里先把 11.3.0 车道的恢复单独做出来（8762 + o113），**绝不碰 8761**；
# 真正的换基线动作 = 把 recover.sh 的取值源从 obench 改成 o113、站点从 site 改成
# site113（见 §10.6 第 5 项的清单）。在那之前，这个脚本让 11.3.0 车道也能一键恢复。
#
# 幂等：只在三大件缺失时才从容器里取；资产目录与清单**一律不动**（那是持久盘上的
# 成果，重算反而可能覆盖 11.3.0 特有的挂载路径 —— 清单里 file 类资产的 mount 指向
# `<prefix>/share/octave/11.3.0/etc/`，是 11.3.0 专属的）。
#
# 用法：sh build/recover-113.sh [端口]      默认 8762
set -e
PORT=${1:-8762}
SITE=/mnt/hdd/octave-wasm-build/site113
HARNESS=/mnt/hdd/octave-wasm-build/harness
REPO=/mnt/hdd/zcode-projects/Octave-Full-Wasm

echo "== 1) 起容器（含 o113）=="
for c in obuild odld obench o113; do
  if sudo docker ps --format '{{.Names}}' | grep -qx "$c"; then
    echo "  $c 已在运行"
  else
    sudo docker start "$c" >/dev/null && echo "  $c 已启动"
  fi
done

echo "== 2) o113 体检 =="
if sudo docker exec o113 test -s /src/websrc/out/octave.wasm; then
  echo "  web 主 wasm: $(sudo docker exec o113 stat -c%s /src/websrc/out/octave.wasm) 字节"
else
  echo "  ⚠ 主 wasm 缺失 —— 从检查点另起："
  echo "     docker run -d --name o113b octave-build:113-assets-full sleep infinity"
  echo "     （然后重链：bash /src/link-web.sh，见 build/113/link-web.sh）"
fi
# 两个关键 prefix：主树安装树 与 SUNDIALS（只 __ode15__.oct 用）
for p in /src/work/octave-install /src/deps/sundials; do
  if sudo docker exec o113 test -d "$p"; then
    echo "  $p 在"
  else
    echo "  ⚠ 缺 $p"
  fi
done

echo "== 3) 站点三大件 =="
if [ -f "$SITE/octave.wasm" ]; then
  echo "  $SITE 已在（octave.wasm $(stat -c%s "$SITE/octave.wasm") 字节）"
else
  echo "  三大件缺失，从 o113 取回…"
  mkdir -p "$SITE"
  sudo docker cp o113:/src/websrc/out/octave.js   "$SITE/"
  sudo docker cp o113:/src/websrc/out/octave.wasm "$SITE/"
  sudo docker cp o113:/src/websrc/out/octave.data "$SITE/"
  cp "$REPO/bridge/index.html" "$REPO/bridge/assets-loader.js" \
     "$REPO/bridge/webaudio.js" "$REPO/bridge/webaudiorec.js" \
     "$REPO/bridge/webfilepick.js" \
     "$REPO/bridge/webnet.js" "$SITE/"
  sudo chown -R "$(id -u):$(id -g)" "$SITE"
  echo "  ⚠ 资产目录（assets/）需要另外补——见 HISTORY §10.4 的资产清单"
fi

echo "== 4) 资产清单完整性核对（**只读**，不重算）=="
# 为什么用 python 只读核对而不是 build/assets.py gen-manifest：
#   gen-manifest 是按 7.2 站点的目录约定重算的，对 site113 会把 file 类资产的
#   mount 路径（11.3.0 专属）算错。这里只验证"清单里写了 sha256 的资产，
#   磁盘上的文件是否还匹配"，不匹配就报出来，让人决定。
python3 - "$SITE" <<'PY'
import hashlib, json, os, sys
site = sys.argv[1]
mp = os.path.join(site, 'assets', 'manifest.json')
if not os.path.exists(mp):
    print('  没有 assets/manifest.json —— 跳过'); raise SystemExit(0)
m = json.load(open(mp, encoding='utf-8'))
bad = miss = okc = 0
for a in m.get('assets', []):
    url, want = a.get('url'), a.get('sha256')
    if a.get('kind') == 'octdir':
        base, files = a.get('base_url'), a.get('files') or []
        for f in files:
            p = os.path.join(site, base, f)
            if not os.path.exists(p): print(f'  缺文件: {base}/{f}'); miss += 1
        continue
    if not url or not want:
        continue
    p = os.path.join(site, url)
    if not os.path.exists(p): print(f'  缺文件: {url}'); miss += 1; continue
    h = hashlib.sha256(open(p, 'rb').read()).hexdigest()
    if h != want: print(f'  ✗ 摘要不符: {url}（清单 {want[:12]}… 实得 {h[:12]}…）'); bad += 1
    else: okc += 1
print(f'  摘要核对：一致 {okc}，不符 {bad}，缺文件 {miss}')
PY

echo "== 5) 测试 harness =="
[ -d "$HARNESS/node_modules/playwright-core" ] || { mkdir -p "$HARNESS" && cd "$HARNESS" && npm install --silent playwright-core; }

echo "== 6) 起静态服务（端口 $PORT）=="
if curl -s --noproxy '*' -o /dev/null "http://127.0.0.1:$PORT/" 2>/dev/null; then
  echo "  $PORT 已在服务"
else
  cd "$SITE" && setsid nohup python3 -m http.server "$PORT" --bind 127.0.0.1 --protocol HTTP/1.1 \
    > /mnt/hdd/octave-wasm-build/site113-server.log 2>&1 &
  sleep 2
  curl -s --noproxy '*' -o /dev/null -w "  http=%{http_code}\n" "http://127.0.0.1:$PORT/"
fi

echo "== 7) 起手体检：需求级一屏（R1–R10 + 架构护栏）=="
"$HARNESS/run.sh" "$REPO/test/browser/accept-requirements.mjs" "http://127.0.0.1:$PORT/" 2>&1 | tail -6
echo "RECOVER-113 DONE（8761/7.2 未被触碰）"
