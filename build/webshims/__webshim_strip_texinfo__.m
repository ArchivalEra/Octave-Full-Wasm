## __webshim_strip_texinfo__: 把 texinfo 标记降级成**人能读的纯文本**（无 shell 构建用）
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## ── 它是谁的工具 ────────────────────────────────────────────────────────────
## `build/webshims/__makeinfo__.m` 的纯函数内核。本构建**无 shell** ⇒ 上游
## `__makeinfo__` 里 `system("makeinfo …")` 那一步起不来子进程 ⇒ 由本函数**降级**：
## 丢标记、留内容。详见 `__makeinfo__.m` 的文件头（含工单 66 的现场）。
##
## ── 为什么单独一个文件（而不是当 __makeinfo__ 的 subfunction）──────────────
## Octave 的 **subfunction 不能被 `%!test` 直接调用**（实测：`test('__makeinfo__')`
## 里 `__webshim_strip_texinfo__` 报 undefined）⇒ 拆成独立文件，两半各跑自己的 `%!test`。
##
## ── 不追求与 makeinfo 等价（那是上游的活）──────────────────────────────────
## 只追求两条：① 人能读；② 不含 `@命令`。`@math{}`/复杂表格等**无法完美还原** ——
## 如实记在 `build/GAPS.md`（能力边界），**别宣称"help 完整"**。

function out = __webshim_strip_texinfo__ (text)

  if (! ischar (text))
    error ("__webshim_strip_texinfo__: TEXT must be a string");
  endif

  s = text;

  ## ① `@deftypefn` / `@deftypefnx` 行：整行删（描述签名；正文里通常另有重复）
  ##    ⚠️ 五个实测坑（2026-10-13，别改回去）——Octave 的 regexp 与 PCRE 有差：
  ##       a. **不用 `\s*`**：`\s` 会吃掉换行 ⇒ 删掉的是"上一行行尾 + 本行"，切了前一行；
  ##       b. **`(?m)` 在这里有害**：它让 `.*` **跨行贪婪**匹配到串尾（实测整串被删空）
  ##          ⇒ 改用 `[^\n]*`（天然止于行尾，且不需要 `(?m)`）；
  ##       c. **不用 `\b`**：`@deftypefn\b` 在 `n` 与空格之间**不匹配**（PCRE 会）⇒ 删不掉；
  ##       d. **不用行首锚 `^`**：实测 `^@end …` 在 `foo\n@end` 这种**非首行**上不匹配
  ##          （`^@deftypefn` 因为常在串首才显得"能用"——是位置巧合，不是写法对）；
  ##       e. ⇒ **靠"`@命令名 + 该行剩余内容`"这个形状**匹配（够独特，不会误伤）。
  s = regexprep (s, '@(deftypefn|deftypefnx|deftypevr|deftypevrx|ftypefn|ftypefnx)[^\n]*', '');

  ## ② `@end <块>`：整行删（同上，不加锚）
  s = regexprep (s, '@end [a-z]+[^\n]*', '');

  ## ③ `@seealso{a,b}` → `See also: a, b`（上游 __makeinfo__ 就是把它换成这句）
  s = regexprep (s, '@seealso\s*\{([^}]*)\}', 'See also: $1');
  s = regexprep (s, '@xseealso\s*\{([^}]*)\}', 'See also: $1');

  ## ④ 内联"单参数"标记：`@code{x}` → `x`（反复应用以处理嵌套）
  for k = 1:5
    prev = s;
    s = regexprep (s, '@(code|var|math|samp|file|dfn|emph|strong|kbd|key|option|env|command|asis|url|nospell|dots|w|sc)\s*\{([^{}]*)\}', '$2');
    if (strcmp (s, prev))
      break;
    endif
  endfor

  ## ⑤ `@ref{a}` / `@xref{a}` / `@pxref{a}` → `a`（带上 See/see 前缀的那两种）
  s = regexprep (s, '@xref\s*\{([^}]*)\}', 'See $1');
  s = regexprep (s, '@pxref\s*\{([^}]*)\}', 'see $1');
  s = regexprep (s, '@ref\s*\{([^}]*)\}', '$1');

  ## ⑥ 其它成对块标记 / 结构命令：整行删（同样不加锚、用 `[^\n]*`，理由见 ①）
  s = regexprep (s, '@(example|group|ifnottex|iftex|menu|item|itemx|noindent|comment|ignore|table|enumerate|itemize|titlepage|copying|macro|include|bye|setfilename|node|chapter|section|subsection|subsubsection|appendix|unnumbered|top|c |printindex|contents|shortcontents)[^\n]*', '');

  ## ⑦ 残留的孤立 `@word`（未成对的宏调用）去掉 `@` —— 但要**保住** `@@`（转义的 @）
  s = regexprep (s, '@@', "\x01");                 # 先保护转义的 @
  s = regexprep (s, '@([A-Za-z][A-Za-z0-9]*)', '$1');
  s = regexprep (s, "\x01", '@');                  # 还原

  ## ⑧ 压掉三个以上连续空行 → 一个；去首尾空白
  s = regexprep (s, '\n{3,}', '\n\n');
  s = strtrim (s);

  out = s;

endfunction


%!test
## 内联标记：丢标记留内容
%! assert (__webshim_strip_texinfo__ ("Return @code{true} if @var{x} is a @code{matrix}."),
%!         "Return true if x is a matrix.");

%!test
## `@seealso` → "See also:"
%! assert (__webshim_strip_texinfo__ ("@seealso{sin,cos}"), "See also: sin,cos");

%!test
## `@deftypefn` / `@end` 块标记整行删
## ⚠️ 必须用 sprintf 造**真换行**：`%!test` 里的 "...\n..." 是**两个字面字符**（反斜杠+n），
##    不是换行 ⇒ `(?m)^` 看不见行首、第 ① 步不生效（实测踩到，改前先看这条）。
%! s = sprintf ("@deftypefn {} {@var{y} =} foo (@var{x})\nThe foo function.\n@end deftypefn");
%! assert (__webshim_strip_texinfo__ (s), "The foo function.");

%!test
## ★ 反向：纯文本（没有标记）**原样返回**（不许把正常文本改坏）
%! assert (__webshim_strip_texinfo__ ("plain text, no markup"), "plain text, no markup");

%!test
## ★ 反向：`@` 不是命令时（孤立 @ 后不跟单词）不动它
%! assert (__webshim_strip_texinfo__ ("a @ b"), "a @ b");

%!test
## ★ 反向：转义的 `@@` 还原成 `@`（不许被第 ⑦ 步吃掉）
%! assert (__webshim_strip_texinfo__ ("mail me @@ home"), "mail me @ home");

%!test
## 真实片段（Octave 的 @code 用法）：可读、无残留 @命令
%! r = __webshim_strip_texinfo__ ("The @code{table} function is not yet implemented in Octave.");
%! assert (r, "The table function is not yet implemented in Octave.");
%! assert (isempty (regexp (r, '@[A-Za-z]', 'once')));
