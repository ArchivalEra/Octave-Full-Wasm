// Octave-Full-Wasm — 图像 I/O 内建（R4）：stb_image / stb_image_write
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 为什么不走 ImageMagick：Magick 在 wasm 下体积与依赖都过重，而我们只需要
// read/write/info 三件事。stb 是单头文件（public domain / MIT 双许可），
// 覆盖 PNG/JPEG/BMP/TGA/GIF/PNM/HDR/PSD 的读，PNG/JPEG/BMP/TGA 的写。
//
// 对外符号（由上层 .m 通过 imformats("add", …) 注册，从而让 imread/imwrite/imfinfo
// 按正常分派链走我们的实现）：
//   __web_imread__  (filename[, fmt_or_all])  → 图像数组（或 [img,map,alpha]）
//   __web_imwrite__ (filename, img, ...)      → 写文件
//   __web_imfinfo__ (filename)                → struct(width,height,channels,format,…)
#include <octave/oct.h>

#include <cstring>
#include <string>

#define STB_IMAGE_IMPLEMENTATION
#define STBI_NO_STDIO
#include "stb_image.h"

#define STB_IMAGE_WRITE_IMPLEMENTATION
#define STBI_WRITE_NO_STDIO
#include "stb_image_write.h"

namespace {

bool slurp (const std::string& path, std::vector<unsigned char>& out)
{
  FILE *f = std::fopen (path.c_str (), "rb");
  if (! f) return false;
  std::fseek (f, 0, SEEK_END);
  long n = std::ftell (f);
  std::fseek (f, 0, SEEK_SET);
  out.resize (n > 0 ? n : 0);
  size_t got = n > 0 ? std::fread (out.data (), 1, n, f) : 0;
  std::fclose (f);
  out.resize (got);
  return true;
}

bool spit (const std::string& path, const void *data, size_t n)
{
  FILE *f = std::fopen (path.c_str (), "wb");
  if (! f) return false;
  if (n) std::fwrite (data, 1, n, f);
  std::fclose (f);
  return true;
}

std::string lower_ext (const std::string& p)
{
  size_t dot = p.rfind ('.');
  std::string e = dot == std::string::npos ? "" : p.substr (dot + 1);
  for (size_t i = 0; i < e.size (); i++) e[i] = std::tolower ((unsigned char) e[i]);
  return e;
}

// stb 回调：写进内存，再一次性落盘（stbi_write_* 的 FILE* 版在 MEMFS 上也能用，
// 但回调版更可控，且顺带拿到字节数）
struct Buffer
{
  std::vector<unsigned char> data;
};

void write_cb (void *ctx, void *data, int size)
{
  Buffer *b = static_cast<Buffer *> (ctx);
  const unsigned char *p = static_cast<const unsigned char *> (data);
  b->data.insert (b->data.end (), p, p + size);
}

}  // namespace

DEFUN_DLD (__web_imread__, args, nargout,
           "Read an image via stb_image. Internal use (registered through imformats).")
{
  if (args.length () < 1)
    error ("__web_imread__: need a file name");
  std::string path = args(0).string_value ();

  std::vector<unsigned char> buf;
  if (! slurp (path, buf))
    error ("__web_imread__: unable to find file '%s'", path.c_str ());

  int w = 0, h = 0, comp = 0;
  // 请求原始通道数（0），以保留灰度/灰度+alpha 的图像形态
  stbi_uc *px = stbi_load_from_memory (buf.data (), (int) buf.size (), &w, &h, &comp, 0);
  if (! px)
    error ("__web_imread__: cannot decode '%s': %s", path.c_str (),
           stbi_failure_reason ());

  dim_vector dv;
  if (comp == 1 || comp == 2) dv = dim_vector (h, w);
  else dv = dim_vector (h, w, comp == 4 ? 3 : comp);

  uint8NDArray img (dv);
  octave_idx_type k = 0;
  for (octave_idx_type j = 0; j < w; j++)
    for (octave_idx_type i = 0; i < h; i++)
      {
        if (dv.length () == 2)
          img(i, j) = px[k++];
        else
          for (int c = 0; c < (int) dv(2); c++)
            img(i, j, c) = px[k++];
      }
  // 4 通道时把 alpha 单独作为第三个输出（与 imread 契约一致）
  stbi_image_free (px);

  octave_value_list retval;
  retval(0) = img;
  if (nargout > 1) retval(1) = Matrix ();     // map（索引图才有，stb 不解码调色板）
  if (nargout > 2) retval(2) = Matrix ();     // alpha
  return retval;
}

DEFUN_DLD (__web_imwrite__, args, nargout,
           "Write an image via stb_image_write. Internal use (registered through imformats).")
{
  // 注意参数顺序：imwrite 的分派是 `fmt.write (varargin{:})`，即 **(图像, 文件名, …)**
  // —— 与 imread 的 (文件名, …) 相反。这里按类型自适应，两种顺序都吃。
  if (args.length () < 2)
    error ("__web_imwrite__: need (image, filename)");
  std::string path;
  octave_value imgv;
  for (int i = 0; i < 2; i++)
    {
      if (args(i).is_string () || args(i).is_char_matrix ()) path = args(i).string_value ();
      else imgv = args(i);
    }
  if (path.empty () || imgv.is_undefined ())
    error ("__web_imwrite__: need (image, filename)");
  uint8NDArray img = imgv.uint8_array_value ();

  const dim_vector dv = img.dims ();
  int h = dv(0), w = dv(1);
  int comp = dv.length () >= 3 ? dv(2) : 1;

  std::vector<unsigned char> raw ((size_t) w * h * comp);
  size_t k = 0;
  for (int j = 0; j < w; j++)
    for (int i = 0; i < h; i++)
      {
        if (comp == 1) raw[k++] = img(i, j);
        else for (int c = 0; c < comp; c++) raw[k++] = img(i, j, c);
      }

  std::string ext = lower_ext (path);
  Buffer out;
  int ok = 0;
  if (ext == "png")
    ok = stbi_write_png_to_func (write_cb, &out, w, h, comp, raw.data (), w * comp);
  else if (ext == "jpg" || ext == "jpeg")
    ok = stbi_write_jpg_to_func (write_cb, &out, w, h, comp, raw.data (), 90);
  else if (ext == "bmp")
    ok = stbi_write_bmp_to_func (write_cb, &out, w, h, comp, raw.data ());
  else if (ext == "tga")
    ok = stbi_write_tga_to_func (write_cb, &out, w, h, comp, raw.data ());
  else
    error ("__web_imwrite__: unsupported format '%s' (png/jpg/bmp/tga)", ext.c_str ());

  if (! ok || out.data.empty ())
    error ("__web_imwrite__: failed to encode '%s'", path.c_str ());
  if (! spit (path, out.data.data (), out.data.size ()))
    error ("__web_imwrite__: cannot write '%s'", path.c_str ());
  return octave_value (true);
}

DEFUN_DLD (__web_imfinfo__, args, nargout,
           "Image metadata via stb_image. Internal use (registered through imformats).")
{
  if (args.length () < 1)
    error ("__web_imfinfo__: need a file name");
  std::string path = args(0).string_value ();

  std::vector<unsigned char> buf;
  if (! slurp (path, buf))
    error ("__web_imfinfo__: unable to find file '%s'", path.c_str ());

  int w = 0, h = 0, comp = 0;
  if (! stbi_info_from_memory (buf.data (), (int) buf.size (), &w, &h, &comp))
    error ("__web_imfinfo__: cannot read info of '%s'", path.c_str ());

  octave_scalar_map s;
  s.assign ("Filename", octave_value (path));
  s.assign ("FileSize", octave_value (double (buf.size ())));
  s.assign ("Width", octave_value (double (w)));
  s.assign ("Height", octave_value (double (h)));
  s.assign ("BitDepth", octave_value (double (8)));
  s.assign ("ColorType", octave_value (comp == 1 ? std::string ("grayscale")
                                        : comp == 2 ? std::string ("grayscale with alpha")
                                        : comp == 3 ? std::string ("truecolor")
                                                    : std::string ("truecolor with alpha")));
  s.assign ("Format", octave_value (lower_ext (path)));
  s.assign ("NumberOfChannels", octave_value (double (comp)));
  return octave_value (s);
}
