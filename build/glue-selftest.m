## Octave-Full-Wasm — 胶水层"自带测试"（%!test）的统一驱动
## Copyright (C) 2026 ArchivalEra
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## ── 为什么有这个东西 ────────────────────────────────────────────────────────
## 我们自己的胶水目录里本来就写着 `%!test`（webfile 10 个文件、pkgfix 5 个），
## 但**从来没有任何地方跑过它们** —— 全仓 `test/browser/*.mjs` 里没有一次调用 Octave 的
## `test`。也就是说：那些断言（`cp -r` 的嵌套规则、rename 回退、packinfo 布局…）
## 是"写了但不执行的债"。本驱动把**已有的接口**接通，不新写断言。
##
## ── 两个调用方，一份目标名单 ────────────────────────────────────────────────
##   宿主（秒级）：       `sh build/glue-selftest.sh`
##   浏览器（进 sweep）： `test/browser/accept-selftest.mjs` 把**本文件源码**读进去
##                        `eval_string` 执行（所以这里**不能有函数定义**，只能当脚本）
##
## ── 输出协议（两个调用方都按它解析）────────────────────────────────────────
##   RESULT <名字> pass=<n> total=<n>       每个目标一行
##   RESULT <名字> pass=0 total=0 error=<一句> 跑不起来（例如函数不在 path 上）
##   TOTAL pass=<n> total=<n> badfiles=<n>   最后一行
##
## ⚠️ **前置条件：胶水目录必须在 path 上**（浏览器侧由资产加载器 addpath，宿主侧由
##    `build/glue-selftest.sh` 负责）。本文件不自己 addpath —— 因为它在浏览器里是从
##    字符串 eval 进来的，`mfilename` 给不出宿主仓库路径。

targets = {"copyfile", "movefile", "ls", ...
           "__wf_basename__", "__wf_copy_dir__", "__wf_copy_file__", "__wf_fail__", ...
           "__wf_list_dir__", "__wf_rmtree__", "__wf_try_rename__", ...
           "__pkgfix_basename__", "__pkgfix_forge_root__", ...
           "__pkgfix_local_list__", "__pkgfix_make_packinfo__"};

## 说明：**不含** `build/forge-preload/*.m` 那 16 个文件 —— 它们是上游 Forge 的函数，
## 不是我们的胶水；它们的 `%!test` 是上游的，失败不欠我们的债（要跑另开一轮）。

logfile = "/tmp/glue-selftest.log";
total_pass = 0;
total_all = 0;
bad_files = 0;

for k = 1:numel (targets)
  nm = targets{k};
  try
    [n, nmax] = test (nm, "quiet", logfile);
  catch err
    msg = strrep (err.message, "\n", " ");
    printf ("RESULT %s pass=0 total=0 error=%s\n", nm, msg);
    bad_files++;
    continue;
  end
  total_pass += n;
  total_all  += nmax;
  if (n < nmax)
    bad_files++;
  endif
  printf ("RESULT %s pass=%d total=%d\n", nm, n, nmax);
end

printf ("TOTAL pass=%d total=%d badfiles=%d\n", total_pass, total_all, bad_files);
