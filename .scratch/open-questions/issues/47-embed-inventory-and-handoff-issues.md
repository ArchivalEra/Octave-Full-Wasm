# 47: **UI 交付前逐接口实测**：Embed API 对照 Octave Qt 接口逐条验证 + 出 UI/管理员两张 issue

**What to build:** 用户令（2026-10-03）："最后一个任务，UI 跟 octave qt 接口逐个测试是否可用，
没问题出 issue 给网站管理员和 UI 工作者各一张，接口细节详细往里写，用 gh cli 提交。"

**Blocked by:** None

**Status:** resolved （2026-10-03：逐接口 14/14 PASS + 修掉一个真缺陷（on.error 死订阅）+
两张 issue 已提 [#1](https://github.com/ArchivalEra/Octave-Full-Wasm/issues/1) UI 开工包 /
[#2](https://github.com/ArchivalEra/Octave-Full-Wasm/issues/2) 部署工单）

**Settling:** test/browser/probe-embed-inventory.mjs —— HARNESS=<harness> 跑：rc=0 ⇒ 结算件成立、结论见 Answer；rc≠0 ⇒ 先修结算件。
test/browser/probe-embed-inventory.mjs <部署了 embed-demo 的站点>` ⇒ 14/14 PASS；同站
`accept-embed-api` 13/0、`accept-embed-multi` 13/0。实验站 8865 留档可复跑。

## Answer

（2026-10-03 结案。）

- **逐接口盘点**：`test/browser/probe-embed-inventory.mjs` —— docs/embed-api.md 的每一行
  ✅e 变成一行浏览器实测（对照 `qt-interpreter-events.h`/`event-manager.h`），**14/14 PASS**
  （A 生命周期、1.1–1.9 事件九行、2.1–2.4 命令四行）；➖ 行（调试器/偏好/桌面壳/窗口管理）
  如实标 N/A。accept-embed-api 13/0、accept-embed-multi 13/0 同站复验。
- **实测抓出并修掉一个真缺陷**：`octave.on.error(cb)` 只能注册、**没有任何触发点**
  （死订阅）——接口表标 ✅e 但 Qt 的 `display_exception` 语义缺了回调这一半。修：
  `fireError()` 在 evalJSON 错误路径 + eval 非 0 返回码路径触发（bridge/octave-embed.js）。
  修后回调真拿到 Octave 异常消息（探针 1.2 实测）。
- **两条语义发现（写进 UI 单）**：① embed 是非交互会话，`eval` 进的命令**不进 history**
  ⇒ 命令历史面板需 UI 自维护；② GL 纹理边界（E6）确认仍在，UI 单明确"v1 不在 embed 页画图"。
- **两张 issue**（gh cli，本仓）：
  - **#1（UI 工作者）**：两行上手代码 + 14 行实测清单 + 用法片段 + 四条必知边界 +
    自验收命令 + "别改 bridge 契约、要接口开 issue"。
  - **#2（网站管理员）**：交付包（91MB tar.zst + sha256）+ 四车道整包上站（别手挑文件）+
    COI 双头（不带头 = 静默降级 7 倍慢，**不报错**）+ `application/wasm` MIME + 缓存 +
    五条部署后验收程序 + 回滚点。
- 实验站 8865（site-w64-embed，embed 三件 + 现役四格）留档可复跑。
