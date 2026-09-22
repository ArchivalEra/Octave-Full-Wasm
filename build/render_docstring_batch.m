## 批量渲染 docstring（构建期用；在**宿主** Octave 上跑）
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## 为什么走这条路：`__makeinfo__.m` 里对文本有一整套变换（去掉每行一个前导空格、
## `@end tex` 缩进、`@seealso`→`@xseealso` 并转义 `@`、`@ref/@xref/@pxref`、
## 以及收尾的 ` -- : `），**逐条复刻极易漂**。宿主 Octave 就是**同版 11.3.0**，
## 而且 `texi_macros_file()` 与站点发的 macros.texi **逐字节相同**（已实测），
## 所以直接用官方这个函数渲染，等于把"与桌面一致"这件事做成**构造性成立**。
##
## 用法：
##   octave-cli --norc --no-init-file --eval "render_docstring_batch ('/tmp/manifest.tsv')"
##
## manifest 每行： `<输入 txt 路径>\t<输出 txt 路径>`
## 输入内容 = **Octave 会交给 __makeinfo__ 的那段**，即 docstring 从**第一个换行符起**
## 的剩余部分（`looks_like_texinfo` 是 `text.erase(0, p1)`，p1 是第一个 `\n` 的下标，
## 所以标记行的**换行符**会留下 —— 正因为这样 `text(2) == " "` 那个守卫才会成立、
## "每行去掉一个前导空格"那步才会执行）。
##
## 输出：每个输入写一个 .txt；失败的在 stdout 打 `FAIL<TAB><输入路径>`。

function render_docstring_batch (manifest)

  fid = fopen (manifest, "r");
  if (fid < 0)
    error ("render_docstring_batch: 打不开 %s", manifest);
  endif
  unwind_protect
    n = 0; bad = 0;
    while (true)
      line = fgetl (fid);
      if (! ischar (line)), break; endif
      if (isempty (line)), continue; endif
      parts = strsplit (line, "\t");
      if (numel (parts) < 2)
        warning ("跳过坏行: %s", line);
        continue;
      endif
      inpath = parts{1};
      outpath = parts{2};
      try
        text = fileread (inpath);
        [out, status] = __makeinfo__ (text, "plain text");
        of = fopen (outpath, "w");
        if (of < 0)
          error ("写不了 %s", outpath);
        endif
        fwrite (of, out);
        fclose (of);
        n++;
        if (status)
          printf ("STATUS\t%s\n", inpath);
          bad++;
        endif
      catch err
        printf ("FAIL\t%s\t%s\n", inpath, err.message);
        bad++;
      end_try_catch
    endwhile
    printf ("== 渲染 %d 个，其中非零状态/失败 %d 个\n", n, bad);
  unwind_protect_cleanup
    fclose (fid);
  end_unwind_protect

endfunction
