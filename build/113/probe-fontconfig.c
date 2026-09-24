/* Octave-Full-Wasm — 闸门：静态 fontconfig 在 wasm/MEMFS 里到底能不能用？
 * Copyright (C) 2026 ArchivalEra
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * 为什么先做这个（R3 的机制闸门，照 build/113/probe-side-module.sh 的先例）：
 * 接 fontconfig 要**重配 + 全量重编 + 重链**（十几分钟），而"编得过"与"在 MEMFS 里
 * 真能列出/匹配字体"是两件事。这个探针只做后者，30 秒出结论：
 *   · FcInit 能不能起来（无 pthread、无 fontconfig 系统目录的构建）；
 *   · 配置文件从哪来（`--sysconfdir=/` 的编译期默认 vs `FONTCONFIG_FILE`）；
 *   · `FcFontList` 能不能列出预载进 MEMFS 的那 4 个 FreeSans；
 *   · `FcFontMatch` 拿 family/style 能不能**指向具体文件**（Octave 的 `fontname` 就靠它）；
 *   · cache 目录不存在时会不会炸（我们的缓存目录在 MEMFS 里要么不存在、要么可写）。
 *
 * 用法（容器内）：sh probe-fontconfig.sh
 */

#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <fontconfig/fontconfig.h>

int main (int argc, char **argv)
{
  printf ("--- fontconfig 探针 ---\n");
  /* ⚠️ 实测两条（2026-09-24）：
   * ① node 的环境变量**不会**进到 wasm 的 ENV 里（`FONTCONFIG_FILE=(unset)` 恒成立），
   *    所以"用 shell 设环境变量再跑"这条在这里是无效的 —— 必须在**进程内** setenv。
   * ② `--sysconfdir=/` 编译出来的默认配置路径是 **`//fonts/fonts.conf`**（双斜杠），
   *    Emscripten 的 FS 解析不到它 ⇒ 不显式给 FONTCONFIG_FILE 时 FcFontList 是 **0 个 face**
   *    （看着像"字体没装"，其实是"配置没读到"）。所以站点侧**必须**显式设这个变量。
   */
  /* 配置路径：argv[3] 优先（**反证要用它** —— node 的环境变量进不来，见上面的 ①） */
  const char *conf = (argc > 3) ? argv[3] : "/fonts/fonts.conf";
  printf ("setenv FONTCONFIG_FILE=%s -> %d\n", conf, setenv ("FONTCONFIG_FILE", conf, 1));
  printf ("FONTCONFIG_FILE=%s\n", getenv ("FONTCONFIG_FILE") ? getenv ("FONTCONFIG_FILE") : "(unset)");

  if (! FcInit ())
    { printf ("FAIL: FcInit() == 0\n"); return 1; }
  printf ("FcInit OK (version %d)\n", FcGetVersion ());

  FcConfig *cfg = FcConfigGetCurrent ();
  printf ("config file = %s\n",
          FcConfigGetFilename (cfg, NULL) ? FcConfigGetFilename (cfg, NULL) : "(null)");

  FcPattern *pat = FcPatternCreate ();
  FcObjectSet *os = FcObjectSetBuild (FC_FAMILY, FC_STYLE, FC_WEIGHT, FC_FILE, NULL);
  FcFontSet *fs = FcFontList (cfg, pat, os);
  printf ("FcFontList: %d 个 face\n", fs ? fs->nfont : -1);
  if (fs)
    for (int i = 0; i < fs->nfont; i++)
      {
        FcChar8 *fam = NULL, *sty = NULL, *file = NULL;
        FcPatternGetString (fs->fonts[i], FC_FAMILY, 0, &fam);
        FcPatternGetString (fs->fonts[i], FC_STYLE, 0, &sty);
        FcPatternGetString (fs->fonts[i], FC_FILE, 0, &file);
        printf ("  [%d] family=%s style=%s file=%s\n", i,
                fam ? (char *) fam : "?", sty ? (char *) sty : "?",
                file ? (char *) file : "?");
      }
  if (fs) FcFontSetDestroy (fs);
  FcObjectSetDestroy (os);
  FcPatternDestroy (pat);

  /* 关键：Octave 的 fontname 就走这条 —— family/style → 具体文件 */
  const char *want_fam = (argc > 1) ? argv[1] : "FreeSans";
  const char *want_sty = (argc > 2) ? argv[2] : NULL;
  FcPattern *q = FcPatternCreate ();
  FcPatternAddString (q, FC_FAMILY, (const FcChar8 *) want_fam);
  if (want_sty) FcPatternAddString (q, FC_STYLE, (const FcChar8 *) want_sty);
  FcConfigSubstitute (cfg, q, FcMatchPattern);
  FcDefaultSubstitute (q);
  FcResult res = FcResultNoMatch;
  FcPattern *m = FcFontMatch (cfg, q, &res);
  FcChar8 *mfile = NULL, *mfam = NULL, *msty = NULL;
  if (m)
    {
      FcPatternGetString (m, FC_FILE, 0, &mfile);
      FcPatternGetString (m, FC_FAMILY, 0, &mfam);
      FcPatternGetString (m, FC_STYLE, 0, &msty);
    }
  printf ("FcFontMatch(%s%s%s) -> result=%d family=%s style=%s file=%s\n",
          want_fam, want_sty ? " / " : "", want_sty ? want_sty : "", res,
          mfam ? (char *) mfam : "?", msty ? (char *) msty : "?",
          mfile ? (char *) mfile : "?");

  int ok = (fs && fs->nfont > 0 && mfile != NULL);
  if (m) FcPatternDestroy (m);
  FcPatternDestroy (q);
  FcFini ();
  printf ("%s\n", ok ? "PROBE OK" : "PROBE FAIL");
  return ok ? 0 : 2;
}
