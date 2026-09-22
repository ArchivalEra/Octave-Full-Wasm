// __fltk_uigetfile__ 的浏览器实现（T8 / 缺口清单 H2）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ── 为什么需要它 ────────────────────────────────────────────────────────────
// `uigetfile` 的调用链是（11.3.0 实测）：
//     uigetfile.m → __get_funcname__ → __uigetfile_fltk__（m/gui/private/ 下的 .m）
//       → __fltk_uigetfile__（dldfcn 的 .oct，本构建没有）
// 而 `__uigetfile_fltk__.m` 开头就是
//     if (exist ("__fltk_uigetfile__") != 3) error ("uigetfile: fltk graphics toolkit required");
// —— **要求 exist == 3**，也就是**必须是个 .oct**。所以纯 .m 覆写满足不了这道门禁，
// 这正是本文件存在的唯一理由：一个把浏览器文件选择器接进官方缝的薄 .oct。
//
// ── 为什么是"两步"（这是设计，不是缺陷）────────────────────────────────────
// 文件选择框是**异步**的，而 Octave 是同步的，且**它一阻塞页面就停摆**
// （实测：`pause(1)` 期间浏览器定时器 0 次触发 —— 见 NOTES-t6-t7-hostlayer.md 坑 1）。
// 所以"一次调用里等用户选完"在本架构下做不到（Asyncify 也已实测排除，见 NOTES-asyncify.md）。
// 于是采用**与播放/录音同构的队列协议**：
//     第一次调用：把请求写进队列（页面弹出选择框），然后**明确报错**告诉用户
//                 "选好后请再执行一次"；
//     第二次调用：读页面写下的结果 —— 选好了就把文件复制进 Octave 的当前目录并返回
//                 `[name, pwd, idx]`；取消了返回 `[0, "", 0]`；还没选则继续报错。
// **与 MATLAB 语义的差异如实记在 HANDOFF §7**：`uigetfile` 要多调一次。
//
// ── 协议（与 build/webaudiorec 同一套路，页面侧是 bridge/webfilepick.js）────
//   请求： `/tmp/ufp_queue.txt` 追加 `<accept>\t<multiple>\t<title>`
//   结果： `/tmp/ufp_status.txt`  `key<TAB>value` 若干行
//            state	none|pending|done|cancelled
//            count	<n>
//            name0	原文件名        （可重复 nameK，K 从 0 起）
//   字节： `/tmp/ufp_picked/<原文件名>`（页面把选中的文件内容写在这里）

#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>

#include "Cell.h"
#include "defun-dld.h"
#include "error.h"
#include "oct-env.h"
#include "ov.h"
#include "ovl.h"
#include "ov-struct.h"

namespace
{

std::string
read_file (const std::string& fn)
{
  std::FILE *f = std::fopen (fn.c_str (), "rb");
  if (! f)
    return "";
  std::string s;
  char buf[4096];
  std::size_t n;
  while ((n = std::fread (buf, 1, sizeof (buf), f)) > 0)
    s.append (buf, n);
  std::fclose (f);
  return s;
}

void
write_file (const std::string& fn, const std::string& data)
{
  std::FILE *f = std::fopen (fn.c_str (), "wb");
  if (! f)
    return;
  if (! data.empty ())
    std::fwrite (data.data (), 1, data.size (), f);
  std::fclose (f);
}

// 读 `/tmp/ufp_status.txt` 里的某一个 key（`key<TAB>value` 行）
std::string
status_value (const std::string& txt, const std::string& key)
{
  std::size_t pos = 0;
  while (pos < txt.size ())
    {
      std::size_t eol = txt.find ('\n', pos);
      if (eol == std::string::npos)
        eol = txt.size ();
      std::string line = txt.substr (pos, eol - pos);
      std::size_t tab = line.find ('\t');
      if (tab != std::string::npos && line.compare (0, tab, key) == 0
          && tab == key.size ())
        return line.substr (tab + 1);
      pos = eol + 1;
    }
  return "";
}

std::vector<std::string>
status_names (const std::string& txt, long count)
{
  std::vector<std::string> out;
  for (long k = 0; k < count; k++)
    {
      std::string key = "name" + std::to_string (k);
      std::string v = status_value (txt, key);
      if (! v.empty ())
        out.push_back (v);
    }
  return out;
}

// 队列行是**制表符分隔**的，而 FLTK 过滤器串里**自带制表符**
// （`__fltk_file_filter__` 就是用 \t 把多个过滤器拼起来的，见 m/gui/private/）
// ⇒ 入队前必须把 \t / \n / \r 换成空格，否则一条请求会被拆成好几段。
std::string
sanitize (const std::string& s)
{
  std::string out = s;
  for (char& c : out)
    if (c == '\t' || c == '\n' || c == '\r')
      c = ' ';
  return out;
}

}  // namespace

DEFUN_DLD (__fltk_uigetfile__, args, nargout,
           "-*- texinfo -*-\n\
@deftypefn {} {[@var{fname}, @var{fpath}, @var{fltidx}] =} __fltk_uigetfile__ (@var{filters}, @var{title}, @var{defname}, @var{multiselect})\n\
Browser implementation of the FLTK file chooser hook that @code{uigetfile} calls.\n\
\n\
The file chooser is asynchronous while Octave is synchronous, so this is a\n\
**two-step** protocol: the first call opens the picker and reports that the\n\
user should ask again once a file has been chosen; the second call returns the\n\
selection (and copies the bytes into Octave's current directory).\n\
@end deftypefn")
{
  if (args.length () < 1)
    print_usage ();

  const std::string STATUS = "/tmp/ufp_status.txt";
  const std::string QUEUE = "/tmp/ufp_queue.txt";

  octave_value filters = args(0);
  std::string title = (args.length () > 1 && args(1).is_string ())
                        ? args(1).string_value () : "Select a file";
  std::string defname = (args.length () > 2 && args(2).is_string ())
                        ? args(2).string_value () : "";
  // 注意：MultiSelect 从上游传过来是**字符串** "on"/"off"（uigetfile.m 里
  // `outargs{4} = lower (val)`），不是逻辑值 —— 第一版按 bool_value() 判断，
  // 结果多选永远失效。两种形式都收下。
  bool multi = false;
  if (args.length () > 3)
    {
      octave_value a3 = args(3);
      if (a3.is_string ())
        {
          std::string s = a3.string_value ();
          multi = (s == "on" || s == "1" || s == "true");
        }
      else if (a3.is_scalar_type ())
        multi = a3.bool_value ();
    }

  std::string txt = read_file (STATUS);
  std::string state = status_value (txt, "state");
  if (state.empty ())
    state = "none";
  long count = std::strtol (status_value (txt, "count").c_str (), nullptr, 10);

  if (state == "done")
    {
      std::vector<std::string> names = status_names (txt, count);
      // 消费掉：把结果清成 none，免得下一次 uigetfile 又拿到同一份
      write_file (STATUS, "state\tnone\ncount\t0\n");

      if (names.empty ())
        return ovl (octave_value (0.0), octave_value (""), octave_value (0.0));

      // 把页面写下的字节复制进当前目录 —— 这样调用者拿到路径后能直接 fopen
      std::string cwd = octave::sys::env::get_current_directory ();
      for (const std::string& nm : names)
        {
          std::string src = "/tmp/ufp_picked/" + nm;
          std::string dst = cwd + "/" + nm;
          std::string bytes = read_file (src);
          write_file (dst, bytes);
        }

      std::string path = cwd + "/";
      if (multi)
        {
          Cell c (dim_vector (1, static_cast<octave_idx_type> (names.size ())));
          for (std::size_t k = 0; k < names.size (); k++)
            c(k) = names[k];
          return ovl (octave_value (c), octave_value (path), octave_value (1.0));
        }
      return ovl (octave_value (names[0]), octave_value (path), octave_value (1.0));
    }

  if (state == "cancelled")
    {
      write_file (STATUS, "state\tnone\ncount\t0\n");
      return ovl (octave_value (0.0), octave_value (""), octave_value (0.0));
    }

  if (state != "pending")
    {
      // 还没有请求过 → 请求一次（页面会弹出选择框）
      std::string accept;
      if (filters.iscell ())
        {
          Cell fc = filters.cell_value ();
          for (octave_idx_type k = 0; k < fc.numel (); k++)
            if (fc(k).is_string ())
              {
                if (! accept.empty ()) accept += ",";
                accept += fc(k).string_value ();
              }
        }
      else if (filters.is_string ())
        accept = filters.string_value ();

      std::string req = sanitize (accept) + "\t" + (multi ? "1" : "0") + "\t" + sanitize (title) + "\n";
      std::FILE *f = std::fopen (QUEUE.c_str (), "ab");
      if (f) { std::fwrite (req.data (), 1, req.size (), f); std::fclose (f); }
      write_file (STATUS, "state\tpending\ncount\t0\n");
    }

  error ("uigetfile: the file chooser has been opened in the page; choose a file "
         "(or cancel) and then run uigetfile again to collect the result");
}

/*
%!test
%! ## 只验"这个 .oct 装得上、名字是 __fltk_uigetfile__"——
%! ## 真正的行为验收在 test/browser/accept-t8-uigetfile.mjs（要浏览器配合）
%! assert (exist ("__fltk_uigetfile__"), 3);
*/
