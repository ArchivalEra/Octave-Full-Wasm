# AGENTS.md · Octave-Full-Wasm

## 路径铁律（最重要）
只在本路径工作：

- 仓库：`/mnt/hdd/zcode-projects/Octave-Full-Wasm`（**唯一**可改的 git 仓）
- 构建容器：docker `obuild`（源码在容器内 `/usr/src/octave-wasm/`）
- 第三方源码/产物：`/mnt/hdd/octave-wasm-build/`、`/tmp/opencode/`

**禁止**碰课程仓 `/mnt/hdd/zcode-projects/GONGCHENGSHUXUE20260917`
（Octave 相关内容已刻意移出，与本项目无关）。

详见 **`HANDOFF.md`**（AI 接续说明：环境、构建命令、血泪坑、下阶段计划）。
C 库配方与坑详见 **`build/CLIBS.md`**。

## 三条不可违背
1. **纯客户端计算**：Octave 恒跑在浏览器 wasm 内，禁止任何服务端执行代码的端点。
2. **不 force-push / 不删 git 对象 / 不改历史**；**禁用 `--no-verify`**。
3. **白名单仓库**：新增文件必须同步 `!路径` 进 `.gitignore`，否则 pre-commit 拒提交。

## 验收底线
`http://127.0.0.1:8761/` 永远是**最近一次通过浏览器实测**的构建。
新实验失败不许让它退化；失败就回滚镜像、记录、继续下一批。

## 文档自更新（HANDOFF 是本项目唯一活文档，别让它烂）
- **机器维护的数字别手写**：HANDOFF 文末 `AUTO:STATE` 区块（部署件 sha、raw/gz 体积、
  最近一次**全绿**回归的套件数与项数、交付包、资产条目）由
  `.githooks/update-handoff.py` 从**持久盘产物**重算；pre-commit 会刷新并 `git add`。**别手改那个区块。**
- **活状态断言必须与产物一致**：头部 + §0–§4 / §6–§8 是活状态，那里的 sha/套件数/体积
  一旦与产物矛盾，`.githooks/check-handoff.py` 直接拦提交。
  **§5.x / §9 / §10 是历史记录（append-only）**，里面的数字不必与今天一致。
- 活状态里要引用旧值，就在**那一行**写清 `历史` / `退役` / `之前` —— 检查器认这个标记。
- 一段活干完（尤其是 promote / 跑完 sweep 之后），跑一次
  `python3 .githooks/update-handoff.py`；ZCode 的 `Stop` hook 也会自动跑（`.zcode/config.json`）。

## 提交前
```bash
python3 .githooks/update-readme.py --check   # README 的 AUTO:FILES 要新鲜（pre-commit 会自动重算并 git add）
python3 .githooks/update-handoff.py          # HANDOFF 的 AUTO:STATE 机器块（pre-commit 也会重算）
python3 .githooks/check-handoff.py           # 活状态断言不得与产物矛盾（§5/§9/§10 是历史记录，不查）
python3 .githooks/check-whitelist.py         # 白名单覆盖
```
