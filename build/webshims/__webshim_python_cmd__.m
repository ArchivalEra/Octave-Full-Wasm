## __webshim_python_cmd__ —— `system.m` 的纯函数内核（2026-10-15，symbolic 的 IPC 缝）
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## 为什么独立成文件（照 `__webshim_strip_texinfo__` 的先例）：`system.m` 里的 subfunction
## **外部不可见**，而它的判据（"是不是 python 调用" + **转义精确互逆**）必须能被 `%!test`
## 单独钉住 —— 那是本接缝**唯一容易错**的地方。
##
## ⚠️ 反转义必须与上游 `python_ipc_system.m` 的转义**精确互逆**（它两步：
##    `\`→`\\` 然后 `"`→`\"`）。逆序 = **先** `\"`→`"`，**再** `\\`→`\`。
##    顺序换不得：`a\"b` 若先还原反斜杠会变成 `a"b`，与原文不符（%!test 第三类就钉这个）。
function [is_py, code] = __webshim_python_cmd__ (command)

  is_py = false;
  code = "";
  if (! ischar (command) || isempty (command))
    return;
  endif
  ## 形如：<python 可执行路径/名> -c "<……>"（dotall：源码里有多行）
  tok = regexp (command, '^\S*python[\d.]*(\.exe)?[ ]+-c[ ]+"(.*)"$', ...
                'tokens', 'once', 'ignorecase', 'dotall');
  if (isempty (tok))
    return;
  endif
  is_py = true;
  s = tok{1};
  s = strrep (s, '\"', '"');    # 反转义第一步（顺序不可换）：两个字符 \ + " ⇒ 一个 "
  s = strrep (s, '\\', '\');    # 反转义第二步：两个 \ ⇒ 一个 \
  code = s;
endfunction

%!test  ## 正常：典型 `python3 -c "..."` ⇒ 命中且剥壳
%! [hit, code] = __webshim_python_cmd__ ([char('python3') ' -c ' char(34) 'print(42)' char(34)]);
%! assert (hit);
%! assert (code, 'print(42)');

%!test  ## 正常：多行源码（dotall：`.` 要匹配换行）
%! BS = char (92); DQ = char (34);
%! body = sprintf ('a = 1\nb = 2\nprint(a + b)');
%! bigs = strrep (body, BS, [BS BS]); bigs = strrep (bigs, DQ, [BS DQ]);
%! [hit, code] = __webshim_python_cmd__ ([char('python3') ' -c ' DQ bigs DQ]);
%! assert (hit);
%! assert (code, body);

%!test  ## ★ 转义往返（**最关键**）：上游两步转义 ⇒ 本 shim 两步反转义，逐字符还原
%! ##   三类输入齐备（**字符码构造**，杜绝单引号字面量歧义）：
%! ##     a) 含单个反斜杠  b) 含双引号  c) 含「反斜杠+引号」两字符组合
%! BS = char (92); DQ = char (34);
%! cases = { ['c:' BS 'tmp' BS 'x'], ['print(' DQ 'hi' DQ ')'], ...
%!           ['x = ' DQ 'a' BS DQ 'b' DQ] };
%! for k = 1:numel (cases)
%!   body = cases{k};
%!   bigs = strrep (body, BS, [BS BS]); bigs = strrep (bigs, DQ, [BS DQ]);
%!   [hit, code] = __webshim_python_cmd__ ([char('python3') ' -c ' DQ bigs DQ]);
%!   assert (hit);
%!   assert (code, body, sprintf ('第 %d 类往返不符', k));
%! endfor

%!test  ## 该报的：非 python 命令 ⇒ **不命中**（落回旧行为：清晰报错，不静默拦）
%! [hit, code] = __webshim_python_cmd__ ('ls -la');
%! assert (! hit);
%! assert (code, "");

%!test  ## 空输入守卫：空串 / 只有前缀没内容 ⇒ 都不命中
%! [hit, ~] = __webshim_python_cmd__ ("");
%! assert (! hit);
%! [hit, ~] = __webshim_python_cmd__ (char('python3'));
%! assert (! hit);
%! [hit, ~] = __webshim_python_cmd__ ([char('python3') ' -c']);
%! assert (! hit);
