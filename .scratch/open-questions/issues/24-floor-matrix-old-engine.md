# 24: 07 的"低于部署下限"格：用**旧版 Chromium**把它测掉（不必等真机）

**What to build:** 工单 07（浏览器下限矩阵）卡在 `ready-for-human` 的唯一原因是
"本机没有低于部署下限的引擎"。但下限那侧的引擎**可以下载**（本机有代理 `127.0.0.1:2080`，
一次性浏览器下载的落点是 `/mnt/hdd/crossbuild-tools/`）。本单 = 把那一侧补上，
把 07 从"人工阻塞"变成"判据齐备"。

**Blocked by:** None

**Status:** resolved

**Settling:** `FLOOR_ENGINES=old-chromium sh test/browser/run.sh test/browser/probe-browser-floor.mjs <站点>` —— rc=0 ⇒ 结算件成立、结论见该单 Answer；rc≠0 ⇒ 先修结算件（门没红＝没结案）。
—— 旧引擎（<137）上：① 页面仍 **ready**、② `eval('2+2')` 成立、③ **D9 门必须关**
（`__web_suspend_ok__`==0，因为 JSPI API 缺席）、④ lane 与 COI 一致；
两条反证（不存在的页面必须 404 / 不产结果）也要在。
**反向断言**：若旧引擎竟然**有** JSPI API（说明我装错了版本），本格必须**报红**而不是放行
（"版本没降下来"不许当通过）—— 把实际版本号打出来。

**Type:** task

## 已知

- 探针已交付并在三引擎上绿：`probe-browser-floor.mjs`（chromium 152 / pw-firefox 154.3 / webkit 2359
  ⇒ **12 PASS / 0 FAIL / 1 N/A**；N/A 是系统 firefox 140esr 起不来——juggler 与 ESR 不匹配）。
- 已知 `<137` 的 Chromium 缺 JSPI 的 JS API（NOTES-jspi 的约定：探针以 **exit 2** 如实说"未做判定"）。

## 交付标准

1. 旧引擎装到 `/mnt/hdd/crossbuild-tools/`（**别覆盖现役浏览器**；用户点名"别碰现有 chromium"）；
2. `probe-browser-floor.mjs` 的引擎表加一格 `old-chromium`（显式路径，走 env 传入，别写死默认）；
3. 跑出那张矩阵并把**实际版本号**写进输出（判"版本真的降下来了"）；
4. 结论回填 NOTES（jspi 或新建 NOTES-floor）+ 工单 07 的 Answer；07 若因此结案则置 `resolved`。

## 进度（2026-09-30）

**旧引擎已就位**：`/mnt/hdd/crossbuild-tools/pw-browsers/chromium-1117/chrome-linux/chrome`
—— **Chromium 125.0.6422.26**（部署下限 137 以下 ✓；由 playwright 1.44.1 配套的 revision 1117
解包而来；旧版 playwright 落在 `/mnt/hdd/crossbuild-tools/pw-old`，**没碰现役 chromium/firefox**）。
探针已加 `old-chromium` 格（显式 `executablePath`，可用 `FLOOR_OLD_CHROME` 覆盖）。

⚠️ 实测代价（记下来免得下一人重踩）：
- `npx playwright install chromium` 走代理**反复只下到 16MB 就停**（CDN 307 重定向）；
- **可行做法**：`curl -L -x http://127.0.0.1:2080` 直接取
  `https://playwright.azureedge.net/builds/chromium/1117/chromium-linux.zip`（156.8MB @ ~23MB/s），
  再手工 `unzip` 到 `pw-browsers/chromium-1117/`（zip 顶层就是 `chrome-linux/`）。

## Answer（2026-09-30）：实测完成 —— Chromium 125 上"低于下限必须优雅降级"成立

命令：`HARNESS=/mnt/hdd/crossbuild-tools/pw-old FLOOR_ENGINES=old-chromium sh test/browser/run.sh test/browser/probe-browser-floor.mjs http://127.0.0.1:8761/`

| 判据 | 实测 |
|---|---|
| ① 页面 ready（低于下限也必须优雅） | **ready=true** ✓ |
| ② `eval('2+2')` 成立 | evalOk=true ✓ |
| ③ **反证**：无 JSPI API ⇒ D9 门必须关 | `jspiApi=false`、`suspendOk=0` ✓（**没有**误报可挂起；若旧引擎竟有 JSPI API，本格会红） |
| ④ lane 与 COI 一致 | `coi=true lane=threads` ✓ |
| 附带 | `mem64=false`（125 不支持 memory64，与年龄一致） |

**4 PASS / 0 FAIL**。装法（复跑用）：`curl -L -x 代理 https://playwright.azureedge.net/builds/chromium/1117/chromium-linux.zip`
→ `unzip` 到 `/mnt/hdd/crossbuild-tools/pw-browsers/chromium-1117/`（zip 顶层就是 `chrome-linux/`），
配 playwright 1.44.1（`/mnt/hdd/crossbuild-tools/pw-old`）。**没碰现役 chromium/firefox。**
顺带修掉探针里已成假话的一句（"本机没有 <137 的 Chromium"）。
