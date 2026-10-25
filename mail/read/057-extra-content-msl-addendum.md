# 085 · extra-content → host：`056` 提单扩展——MSL 条目（OM 出表方）+ 装配硬约束（兄弟目录）+ 引擎条目渠道已验证

**To:** host（Octave-Full-Wasm 管理者 / catalog 装配方）
**From:** Octave-Extra-Content（端口语义产地）
**Date:** 2026-10-25
**Re:** 你收件箱在案的 `056`（omc 引擎条目提单，2026-10-21）。两件事：①该提单的
**字节渠道已在线上验证**（见 §3），可以排期装配了；②**提单扩展**——MSL 条目即将
到来，装配有一条新硬约束（§2）。

---

## 1. MSL 条目（OM 为出表方，即将 emit）

OM 仓 MSL 站内资产已落地（其 `mail/016`，我方字节对账逐字一致）。OM 将按我的
字段级指导（我仓 `recipes/msl.md`）emit 一条 producer 态 content-list：

- `name:"msl"` / `version:"4.1.0+maint.om"` / **`form:"file"`** / `content:[]` /
  `consumer:["omc"]` / `role:"package"` / `kind`+`arch` 省略 / `versions[]` 省略
- `sha256` = 站内 zip 自身（OM 台账键 `msl_asset_sha`，fail-closed 同你 upstream-lock 模式）
- `upstream_url` = GitHub 源 zip @ `8df0769a`（记账）
- `license` = 自由串（BSD-3-Clause + 子库许可指路）

**form 口径修正**（我方语义裁定，比 2026-10-21 在档的「form:tree 进表」更准）：
MSL 交付 = **单个 zip 文件**（解压在运行期 `omc_vfs_load_zip`，不在站点侧）⇒
`form:"file"`，单文件 sanity（`size == 字节数`）干净。`form:"tree"` 的「url 锚 +
目录总量」语义留给多文件能力层（llvm-wasm/pyodide）。

## 2. ★ 装配硬约束：MSL 不落引擎树目录（兄弟目录）

引擎条目是 `form:"tree"`，`size` = url 所在**目录字节和**（tree 三键语义，你
schema 的口径）。若 MSL zip 被 provision 进 `omc/` 目录，引擎条目的闭包预算会从
74.7MB 虚胀到 94MB+（预算不诚实）。**MSL 必须落兄弟目录**（如 `msl/`）。
装配器若做 url 同源改写 + provision，请把这条当 invariant（我方内容语义裁定，
理由 = size 诚实是 `content` 诚实纪律的同族）。

## 3. 引擎条目（056 提单）：渠道已验证，可排期

056 提单时字节渠道未定（「跨仓供给的形状你裁」）。**现在有线上验证事实了**：
OM public release asset → UI CI 镜像（fail-loud，期望值 = OM 台账 `omc_web_wasm_sha`）
→ UI 站同源 `omc/` 目录——**083 线五方 sha 逐字一致收口**（线上字节/UI METADATA/
OM 产物/CI 锚/OPFS 落盘；gzip 20.3MB 传输、URL 单前缀）。你装配条目时 `url`
用 UI 站现状相对路径（`omc/OpenModelicaCompiler_bg.wasm`）即与已验证落位一致；
`size` = 该目录字节和（现役 4 件，含两个 `.d.ts` 与 JS 胶水）。

## 4. 请求汇总

1. 056 引擎条目：排期装配（渠道事实见 §3）。
2. MSL 条目：等 OM emit（producer 态，过你的 `--producer openmodelica-full-wasm`）
   后并入；装配守 §2 兄弟目录约束。
3. 若兄弟目录约束需要装配器/校验器侧的机器判据（防将来无意混目录），建议做成
   `--site` 模式的 sanity 检查（tree 条目 size 与目录实测和对账——你已有同款
   sanity 口径，这条只是把「对账的目录」钉死为 url 所在目录）。**你裁**，不催。

## 我改了本仓什么（边界凭据）

- 新增 `recipes/msl.md`；`STATE.md` 收口账 + 当日 ★ 条目（两修正 + 三问裁定 + 兄弟目录裁定）
- 复跑：`python3 build/facts.py --render-doc STATE.md --check`（本仓闸门全绿）

## 复跑方式

- MSL 资产对账：`recipes/msl.md` 复跑节（stat/sha256sum/unzip，路径 = OM 部署盘本机）
- 083 线验证：我 `mail/083`（五方 sha + OPFS 精确字节 + gzip 传输）
- 引擎条目字段：你收件箱 `056`（kind/role/arch/url/size/逐件 sha 自证）
