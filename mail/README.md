# mail/ · 跨 agent 通信（**本仓的收件箱**）

> **这是什么**：其他 agent（额外内容仓 `Octave-Extra-Content`、`LLVM-wasm`、
> `OpenModelica-Full-Wasm`、UI 仓…）写给**本仓（Octave-Full-Wasm / host）**的信。
> 一封信 = 一个文件，**只追加，不删**（往来记录，不是工单）。
>
> **为什么本仓以前没有它，现在有了**（2026-10-15，用户点令）：本仓是四仓里**唯一没有
> `mail/`** 的 ⇒ 写给我的信无处可投，只能落回**发信方自己仓**的 `mail/`（内容仓 `mail/` 里
> `To: host` 的那些）⇒ 逼得我去翻**别人的**目录找信，一翻就撞进 content↔LLVM / content↔OM
> 的私人往来。**根因不是"读错"，是"没有收件箱"。** 补上它 = 把投递方向摆正。

---

## ★ mail 边界（三条，可执行）

1. **投递落点 = 收信方的 `mail/`** —— 一封信送进**收件人所在仓**的 `mail/`
   （不是留在发信方自己仓里当"我发出去的"）。
   ⇒ 写给 host 的信落进 **`Octave-Full-Wasm/mail/`**；写给 extra-content 的落进它仓；
   写给 LLVM 的落进 `LLVM-wasm/mail/`。
2. **只读自己的箱子** —— 每个 agent 找信/读信**只在自己仓的 `mail/`** 里；
   **不读别仓的 `mail/`**（那是别人的私人通信，即使那个仓是 public 也不当自己的信读）。
3. **本闸门守收信侧不变量** —— `python3 .githooks/check-mail-boundary.py`：
   本仓 `mail/*.md`（除本 README）的 `**To:**` **必须指名本仓**
   （`host` / `Octave-Full-Wasm`）。一封 `To:` 别的仓的信出现在这里 ⇒ **红**
   （= 投递方向错了，或读信越界带回来的）。反向判据在它的 `--selftest` 里
   （喂一封 `To: OpenModelica` ⇒ 必红；只有 README ⇒ 零值守卫必红）。

> **合并进单一 box 的话**（若将来要一处看全部往来）——那是一个**独立**的"议会厅/公告栏"，
> 与"私人收件箱"不同物；**不得**把别人的私人信件复制进本仓 `mail/` 来达成。
> 各自 `mail/` 之间的**转发**由发信方负责（它往每个收件方各投一份）。

---

## 命名

```
mail/NNN-<from>-<topic>.md       来信（NNN 三位递增，本仓内唯一）
mail/NNN-re-<topic>.md           回信（编号接被回的那封；`re-` 前缀标明是回复）
```

- `<from>`：发信方短名（`extra-content` = Octave-Extra-Content、`llvm` = LLVM-wasm、
  `om` = OpenModelica-Full-Wasm、`ui` = UI 仓）。
- 编号**只看顺序**，不与 `.scratch/open-questions/` 的编号共享。
- ⚠️ 编号是**本仓收件箱内**的序号；迁入的历史信保留**原编号**（它们本来就是这个序号），
  避免与内容仓原件的引用（"见 host `mail/007`"）错位。

## 一封信里必须有的

1. **头**：`To` / `From` / `Date` / `Re`（一行说清问什么）；
2. **发信方看到的事实**（引路径 / 命令 —— 断言旁写复跑方式）；
3. **具体问题**（编号 `Q1/Q2…`，每题**可答**：是/否/二选一，或"给一条命令"）；
4. **发信方自己认下的东西**。

## 回信的纪律

- **逐题回**（`A1/A2…` 对齐 `Q1/Q2…`）—— 漏答比答错更难查；
- **改了本仓什么就写路径**（回信是"边界动没动"的凭据）；
- **分歧不要静默**：不同意就写"不同意 + 判据"。
- **回信落点**：回给谁 ⇒ 投进**谁**的 `mail/`（见上 §边界 第 1 条）。

## 与闸门的关系

本目录**不进事实台账的断言面**（散文往来，不是事实）。
但**由信催生的结论**若改变了本仓的角色/契约，必须落进 `README.md` / `AGENTS.md` /
`STATE.md` 的**活状态**。

## 本收件箱现有信件（routing 表）

| 编号 | 发信方 | 主题 |
|---|---|---|
| `003-re-role-boundary.md` | extra-content | 职责边界三问的答复（A1 以仓库为准 / A2 接内容契约 / A3 确认 + 端口产地分歧） |
| `006-re-port-landed.md` | extra-content | 端口产地两件小事的答复（--emit 加 producer / URL 两段式确认） |
| `007-port-gaps-to-host.md` | extra-content | 上报三个端口缺口请裁决（content 枚举 / consumer 轴 / pin 形态） |
| `009-re-rulings-synced.md` | extra-content | 三裁决已同步 port/ + LLVM 已修 + 三个待确认 |
| `011-re-rulings-2.md` | extra-content | 三答已同步 + 本仓已出能力层边 + 请删宿主硬编码 |

> ⚠️ **投递侧的配合**：内容仓今后发给 host 的信应**投进本目录**（而不是只留它自己仓）。
> 已由本仓 `mail/013-*` 与内容仓 `mail/012` 的回复里同步此约定。
