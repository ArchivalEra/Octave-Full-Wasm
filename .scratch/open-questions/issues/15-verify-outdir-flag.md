# 15: `relink.sh verify --out <副本>` 假红，并把 verdict 写成 rejected

**What to build:** 让"验证一个产物的副本"这件事**真的能用**。
现在它必然假红，而且会**污染那个副本的身份证** —— 于是一次验证动作本身销毁了被验证的东西。

**Blocked by:** None (can start immediately)

**Status:** resolved

**Settling:** `cp -a <产物> /tmp/vcopy && E2_OPENBLAS=… relink.sh verify threads --out /tmp/vcopy` —— rc=0 ⇒ 修好（副本能验）；rc≠0 且副本 verdict 变成 `rejected` ⇒ 未修（反向断言：坏副本必须仍红）
`cp -a /mnt/hdd/octave-wasm-build/e2-artifacts/single /tmp/vcopy && E2_OPENBLAS=/src/work/e2-openblas-lib-s bash build/113/relink.sh verify threads --out /tmp/vcopy`
—— **rc=0 ⇒ 修好了**（副本能验）；rc≠0 且 `/tmp/vcopy/octave.build.json` 的 verdict 变成 `rejected` ⇒ 未修（当前的实测行为）。
反向断言：验一个**真的坏**副本（例：改一个字节）必须仍然红。

**Type:** task

## 根因（已定位，含行号）

- `build/113/check-build-manifest.py:207`：`d = out_dir or (man.get("build") or {}).get("out")`
  ⇒ 配对检查按**身份证里记录的构建目录**找三个大件，而不是按身份证所在目录。
- `build/113/relink.sh` 的 `cmd_verify` 调它时**不转发 `--out-dir`**
  ⇒ 验**副本**时 `d` 退化成 `/src/websrc/e2-ob-s-out` 这类**容器内路径**，
  在宿主上必然 "octave.wasm 不存在"，然后 `--write` 把 `verdict=rejected` 写回副本。

**判据**：验原位 ⇒ 绿（现在就是）；验副本 ⇒ **也必须绿**；验坏副本 ⇒ 必须红。
`relink.sh --selfcheck` / `--selftest` 保持全绿。

**Type:** task

- [x] `cmd_verify` 补 `--out-dir "$out"`
- [x] 在 `check-build-manifest.py --selftest` 里加"副本也能验"与"坏副本必须红"两条用例
- [x] 改完 `docker cp` 进容器并比两侧 sha（49e4bd0c / 334649f4 两侧一致）
- [x] 本仓的 `HISTORY.md` 记一笔（§5.68-3）（这是一处"闸门在错的地方判成假红并污染产物"的实例）

## Answer（2026-09-29，无人值守批次）

- 配对检查抽成纯函数 `check-build-manifest.py::pairing_problems(man, out_dir)`；
  `cmd_verify` 转发 `--out-dir "$out"`（relink.sh）。
- 自证 19/0（新增三条：副本绿 / 坏副本红 / **老假红形状不许复活**）。
- 结算三连（2026-09-29 宿主实测，命令即本单 Settling 所写）：
  - 副本：`cp -a e2-artifacts/single /tmp/vcopy && E2_OPENBLAS=/src/work/e2-openblas-lib-s
    relink.sh verify threads --out /tmp/vcopy` ⇒ **rc=0**，副本 verdict 保持 `ok`；
  - 坏副本（改一字节）⇒ **rc=3**，点名 `octave.wasm 的 sha 不符：清单 e570905e… 实测 a97f34f8…`；
  - 原位验证 ⇒ 仍 **rc=0**。
- 夹具教训记 HISTORY §5.68：第一版坏副本夹具把清单 sha 记成篡改后的内容（自己比自己，恒绿），
  自证当场抓住。
