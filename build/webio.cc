// Octave-Full-Wasm — 无 shell 环境下的压缩/归档内建（R6）
// Copyright (C) 2026 ArchivalEra
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 背景：Octave 自带的 zip/unzip/tar/untar/gunzip/bunzip2 都是 .m 包装，最终调
// `system("unzip …")` —— wasm 里没有 shell，必失败。这里用 zlib/libbz2（符号由主模块
// 在 dlopen 时解析，不重复打包）+ 自实现的 zip/tar 格式，提供进程内等价能力：
//
//   __web_unzip__  (zipfile[, outdir])  → cellstr 解出的文件
//   __web_zip__    (zipfile, files[, rootdir]) → cellstr 归档内名字
//   __web_untar__  (tarfile[, outdir])  → cellstr 解出的文件
//   __web_tar__    (tarfile, files[, rootdir]) → cellstr 归档内名字
//   __web_gunzip__ (file[, outdir])     → cellstr 解出的文件
//   __web_bunzip2__(file[, outdir])     → cellstr 解出的文件
//
// 上层的 .m 覆写（assets 里的 zip.m/unzip.m/…）负责保持与原函数的接口契约。
#include <octave/oct.h>

#include <bzlib.h>
#include <cstdio>
#include <cstring>
#include <dirent.h>
#include <string>
#include <sys/stat.h>
#include <sys/types.h>
#include <vector>
#include <zlib.h>

namespace {

bool read_file (const std::string& path, std::vector<unsigned char>& out)
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

bool write_file (const std::string& path, const unsigned char *data, size_t n)
{
  FILE *f = std::fopen (path.c_str (), "wb");
  if (! f) return false;
  if (n) std::fwrite (data, 1, n, f);
  std::fclose (f);
  return true;
}

void mkdir_p (const std::string& path)
{
  if (path.empty ()) return;
  std::string cur;
  for (size_t i = 0; i < path.size (); i++)
    {
      cur += path[i];
      if (path[i] == '/' || i + 1 == path.size ())
        {
          if (cur != "/" && ! cur.empty ())
            mkdir (cur.c_str (), 0777);
        }
    }
}

std::string dirname_of (const std::string& p)
{
  size_t s = p.rfind ('/');
  return s == std::string::npos ? std::string (".") : p.substr (0, s);
}

std::string basename_of (const std::string& p)
{
  size_t s = p.rfind ('/');
  return s == std::string::npos ? p : p.substr (s + 1);
}

std::string join (const std::string& a, const std::string& b)
{
  if (a.empty () || a == ".") return b;
  if (! a.empty () && a[a.size () - 1] == '/') return a + b;
  return a + "/" + b;
}

bool is_dir (const std::string& p)
{
  struct stat st;
  return stat (p.c_str (), &st) == 0 && S_ISDIR (st.st_mode);
}

bool is_file (const std::string& p)
{
  struct stat st;
  return stat (p.c_str (), &st) == 0 && S_ISREG (st.st_mode);
}

// 递归收集文件（tar/zip 的输入可以是目录）
void collect (const std::string& base, const std::string& rel,
              std::vector<std::pair<std::string, std::string> >& out)
{
  std::string full = rel.empty () ? base : join (base, rel);
  if (is_file (full)) { out.push_back (std::make_pair (full, rel)); return; }
  if (! is_dir (full)) return;
  DIR *d = opendir (full.c_str ());
  if (! d) return;
  struct dirent *e;
  while ((e = readdir (d)))
    {
      std::string n = e->d_name;
      if (n == "." || n == "..") continue;
      collect (base, rel.empty () ? n : rel + "/" + n, out);
    }
  closedir (d);
}

std::string arg_string (const octave_value_list& args, int i, const std::string& def = "")
{
  if (i >= args.length ()) return def;
  return args(i).string_value ();
}

// 注意：octave_value(string_vector) 会得到**字符矩阵**（等长填充），不是 cellstr。
// 上层 .m 的契约要的是 cellstr（numel == 文件数），所以必须显式造 Cell。
octave_value to_cellstr (const std::vector<std::string>& v)
{
  Cell c (dim_vector (v.size (), 1));
  for (size_t i = 0; i < v.size (); i++) c(i) = v[i];
  return octave_value (c);
}

// ---------------------------------------------------------------- gzip / bzip2

bool gunzip_to (const std::string& file, const std::string& out)
{
  gzFile g = gzopen (file.c_str (), "rb");
  if (! g) return false;
  mkdir_p (dirname_of (out));
  FILE *o = std::fopen (out.c_str (), "wb");
  if (! o) { gzclose (g); return false; }
  char buf[65536];
  int n;
  while ((n = gzread (g, buf, sizeof buf)) > 0) std::fwrite (buf, 1, n, o);
  std::fclose (o);
  gzclose (g);
  return true;
}

bool bunzip2_to (const std::string& file, const std::string& out)
{
  BZFILE *b = BZ2_bzopen (file.c_str (), "rb");
  if (! b) return false;
  mkdir_p (dirname_of (out));
  FILE *o = std::fopen (out.c_str (), "wb");
  if (! o) { BZ2_bzclose (b); return false; }
  char buf[65536];
  int n;
  while ((n = BZ2_bzread (b, buf, sizeof buf)) > 0) std::fwrite (buf, 1, n, o);
  std::fclose (o);
  BZ2_bzclose (b);
  return true;
}

// ---------------------------------------------------------------- zip 格式

void put16 (std::vector<unsigned char>& v, unsigned x)
{ v.push_back (x & 0xff); v.push_back ((x >> 8) & 0xff); }

void put32 (std::vector<unsigned char>& v, unsigned long x)
{
  for (int i = 0; i < 4; i++) v.push_back ((x >> (8 * i)) & 0xff);
}

unsigned long get32 (const unsigned char *p)
{
  return (unsigned long) p[0] | ((unsigned long) p[1] << 8)
         | ((unsigned long) p[2] << 16) | ((unsigned long) p[3] << 24);
}

unsigned get16 (const unsigned char *p) { return p[0] | (p[1] << 8); }

struct ZipEntry
{
  std::string name;
  unsigned long crc, csize, usize, offset;
  unsigned method;
};

bool deflate_raw (const unsigned char *in, size_t n, std::vector<unsigned char>& out)
{
  z_stream s;
  std::memset (&s, 0, sizeof s);
  if (deflateInit2 (&s, Z_DEFAULT_COMPRESSION, Z_DEFLATED, -MAX_WBITS, 8,
                    Z_DEFAULT_STRATEGY) != Z_OK)
    return false;
  out.resize (n + n / 1000 + 64);
  s.next_in = const_cast<Bytef *> (in);
  s.avail_in = n;
  s.next_out = out.data ();
  s.avail_out = out.size ();
  int r = deflate (&s, Z_FINISH);
  size_t produced = out.size () - s.avail_out;
  deflateEnd (&s);
  if (r != Z_STREAM_END) return false;
  out.resize (produced);
  return true;
}

bool inflate_raw (const unsigned char *in, size_t n, size_t usize,
                  std::vector<unsigned char>& out)
{
  z_stream s;
  std::memset (&s, 0, sizeof s);
  if (inflateInit2 (&s, -MAX_WBITS) != Z_OK) return false;
  out.resize (usize ? usize : 1);
  s.next_in = const_cast<Bytef *> (in);
  s.avail_in = n;
  s.next_out = out.data ();
  s.avail_out = out.size ();
  int r = inflate (&s, Z_FINISH);
  size_t produced = out.size () - s.avail_out;
  inflateEnd (&s);
  if (r != Z_STREAM_END && r != Z_OK && r != Z_BUF_ERROR) return false;
  out.resize (produced);
  return true;
}

}  // namespace

// ---------------------------------------------------------------- DEFUNs

DEFUN_DLD (__web_gunzip__, args, nargout,
           "gunzip in-process (no shell). Internal use.")
{
  if (args.length () < 1)
    error ("__web_gunzip__: need a file name");
  std::string file = args(0).string_value ();
  std::string outdir = arg_string (args, 1);      // 目录语义，与 gunzip(file, dir) 契约一致
  std::string b = basename_of (file);
  if (b.size () > 3 && b.compare (b.size () - 3, 3, ".gz") == 0)
    b = b.substr (0, b.size () - 3);
  else if (b.size () > 4 && b.compare (b.size () - 4, 4, ".tgz") == 0)
    b = b.substr (0, b.size () - 4) + ".tar";
  std::string out = outdir.empty () ? join (dirname_of (file), b) : join (outdir, b);
  if (! gunzip_to (file, out))
    error ("__web_gunzip__: failed to extract '%s'", file.c_str ());
  std::vector<std::string> r (1, out);
  return to_cellstr (r);
}

DEFUN_DLD (__web_bunzip2__, args, nargout,
           "bunzip2 in-process (no shell). Internal use.")
{
  if (args.length () < 1)
    error ("__web_bunzip2__: need a file name");
  std::string file = args(0).string_value ();
  std::string outdir = arg_string (args, 1);
  std::string b = basename_of (file);
  if (b.size () > 4 && b.compare (b.size () - 4, 4, ".bz2") == 0)
    b = b.substr (0, b.size () - 4);
  std::string out = outdir.empty () ? join (dirname_of (file), b) : join (outdir, b);
  if (! bunzip2_to (file, out))
    error ("__web_bunzip2__: failed to extract '%s'", file.c_str ());
  std::vector<std::string> r (1, out);
  return to_cellstr (r);
}

DEFUN_DLD (__web_zip__, args, nargout,
           "Create a zip archive in-process. Internal use.")
{
  if (args.length () < 2)
    error ("__web_zip__: need (zipfile, files)");
  std::string zf = args(0).string_value ();
  std::string root = arg_string (args, 2, ".");
  Cell files = args(1).cell_value ();

  std::vector<std::pair<std::string, std::string> > entries;
  for (octave_idx_type i = 0; i < files.numel (); i++)
    {
      std::string f = files(i).string_value ();
      if (is_dir (f))
        collect (f, "", entries);
      else
        entries.push_back (std::make_pair (f, basename_of (f)));
    }

  std::vector<unsigned char> out;
  std::vector<ZipEntry> dir;
  std::vector<std::string> names;

  for (size_t i = 0; i < entries.size (); i++)
    {
      std::vector<unsigned char> raw;
      if (! read_file (entries[i].first, raw)) continue;
      std::vector<unsigned char> comp;
      if (! deflate_raw (raw.data (), raw.size (), comp)) continue;

      ZipEntry e;
      e.name = entries[i].second;
      std::string arcname = root == "." ? e.name : join (root, e.name);
      e.name = arcname;
      e.crc = crc32 (0, raw.data (), raw.size ());
      e.csize = comp.size ();
      e.usize = raw.size ();
      e.method = 8;
      e.offset = out.size ();

      put32 (out, 0x04034b50);
      put16 (out, 20); put16 (out, 0); put16 (out, 8);
      put16 (out, 0); put16 (out, 0);
      put32 (out, e.crc); put32 (out, e.csize); put32 (out, e.usize);
      put16 (out, arcname.size ()); put16 (out, 0);
      out.insert (out.end (), arcname.begin (), arcname.end ());
      out.insert (out.end (), comp.begin (), comp.end ());
      dir.push_back (e);
      names.push_back (arcname);
    }

  unsigned long cd_start = out.size ();
  for (size_t i = 0; i < dir.size (); i++)
    {
      put32 (out, 0x02014b50);
      put16 (out, 20); put16 (out, 20);
      put16 (out, 0); put16 (out, 8);
      put16 (out, 0); put16 (out, 0);
      put32 (out, dir[i].crc);
      put32 (out, dir[i].csize); put32 (out, dir[i].usize);
      put16 (out, dir[i].name.size ()); put16 (out, 0); put16 (out, 0);
      put16 (out, 0); put16 (out, 0); put32 (out, 0);
      put32 (out, dir[i].offset);
      out.insert (out.end (), dir[i].name.begin (), dir[i].name.end ());
    }
  unsigned long cd_size = out.size () - cd_start;

  put32 (out, 0x06054b50);
  put16 (out, 0); put16 (out, 0);
  put16 (out, dir.size ()); put16 (out, dir.size ());
  put32 (out, cd_size); put32 (out, cd_start);
  put16 (out, 0);

  if (! write_file (zf, out.data (), out.size ()))
    error ("__web_zip__: cannot write '%s'", zf.c_str ());
  return to_cellstr (names);
}

DEFUN_DLD (__web_unzip__, args, nargout,
           "Extract a zip archive in-process. Internal use.")
{
  if (args.length () < 1)
    error ("__web_unzip__: need a zip file");
  std::string zf = args(0).string_value ();
  std::string outdir = arg_string (args, 1, ".");

  std::vector<unsigned char> buf;
  if (! read_file (zf, buf))
    error ("__web_unzip__: cannot read '%s'", zf.c_str ());

  // 从尾部找 EOCD
  long eocd = -1;
  long start = (long) buf.size () - 65557;
  if (start < 0) start = 0;
  for (long i = (long) buf.size () - 22; i >= start; i--)
    if (get32 (&buf[i]) == 0x06054b50UL) { eocd = i; break; }
  if (eocd < 0)
    error ("__web_unzip__: not a zip archive: '%s'", zf.c_str ());

  unsigned count = get16 (&buf[eocd + 10]);
  unsigned long cd = get32 (&buf[eocd + 16]);

  std::vector<std::string> written;
  unsigned long p = cd;
  for (unsigned k = 0; k < count && p + 46 <= buf.size (); k++)
    {
      if (get32 (&buf[p]) != 0x02014b50UL) break;
      unsigned method = get16 (&buf[p + 10]);
      unsigned long crc = get32 (&buf[p + 16]);
      unsigned long csize = get32 (&buf[p + 20]);
      unsigned long usize = get32 (&buf[p + 24]);
      unsigned nlen = get16 (&buf[p + 28]);
      unsigned elen = get16 (&buf[p + 30]);
      unsigned clen = get16 (&buf[p + 32]);
      unsigned long lho = get32 (&buf[p + 42]);
      std::string name ((const char *) &buf[p + 46], nlen);
      p += 46 + nlen + elen + clen;

      if (! name.empty () && name[name.size () - 1] == '/')
        { mkdir_p (join (outdir, name)); continue; }

      unsigned lnlen = get16 (&buf[lho + 26]);
      unsigned lelen = get16 (&buf[lho + 28]);
      unsigned long dstart = lho + 30 + lnlen + lelen;
      if (dstart + csize > buf.size ()) continue;

      std::vector<unsigned char> data;
      bool ok;
      if (method == 0)
        { data.assign (buf.begin () + dstart, buf.begin () + dstart + csize); ok = true; }
      else
        ok = inflate_raw (&buf[dstart], csize, usize, data);
      if (! ok) continue;

      std::string target = join (outdir, name);
      mkdir_p (dirname_of (target));
      if (write_file (target, data.data (), data.size ()))
        written.push_back (target);
      (void) crc;
    }

  return to_cellstr (written);
}

// ---------------------------------------------------------------- tar 格式

namespace {
const int TAR_BLOCK = 512;

void tar_header (std::vector<unsigned char>& out, const std::string& name,
                 unsigned long size, char typeflag)
{
  unsigned char h[TAR_BLOCK];
  std::memset (h, 0, sizeof h);
  std::string nm = name, prefix;
  if (nm.size () > 100)   // ustar prefix 分裂
    {
      size_t slash = nm.rfind ('/', 155);
      if (slash != std::string::npos && nm.size () - slash - 1 <= 100
          && slash <= 155)
        { prefix = nm.substr (0, slash); nm = nm.substr (slash + 1); }
      else
        nm = nm.substr (0, 100);
    }
  std::memcpy (h, nm.c_str (), nm.size ());
  std::snprintf ((char *) h + 100, 8, "%07lo", (unsigned long) (0644));
  std::snprintf ((char *) h + 108, 8, "%07o", 0UL);
  std::snprintf ((char *) h + 116, 8, "%07o", 0UL);
  std::snprintf ((char *) h + 124, 12, "%011lo", size);
  std::snprintf ((char *) h + 136, 12, "%011lo", 0UL);
  std::memset (h + 148, ' ', 8);          // 校验和先置空格
  h[156] = typeflag;
  std::memcpy (h + 257, "ustar", 5);
  h[263] = '0'; h[264] = '0';
  std::memcpy (h + 345, prefix.c_str (), prefix.size () > 155 ? 155 : prefix.size ());

  unsigned sum = 0;
  for (int i = 0; i < TAR_BLOCK; i++) sum += h[i];
  std::snprintf ((char *) h + 148, 8, "%06o", sum);
  h[154] = '\0'; h[155] = ' ';

  out.insert (out.end (), h, h + TAR_BLOCK);
}

void tar_pad (std::vector<unsigned char>& out)
{
  size_t rem = out.size () % TAR_BLOCK;
  if (rem) out.insert (out.end (), TAR_BLOCK - rem, 0);
}

unsigned long tar_octal (const unsigned char *p, int n)
{
  unsigned long v = 0;
  for (int i = 0; i < n; i++)
    {
      if (p[i] == ' ' || p[i] == '\0') continue;
      if (p[i] < '0' || p[i] > '7') continue;
      v = v * 8 + (p[i] - '0');
    }
  return v;
}
}  // namespace

DEFUN_DLD (__web_tar__, args, nargout,
           "Create a ustar archive in-process. Internal use.")
{
  if (args.length () < 2)
    error ("__web_tar__: need (tarfile, files)");
  std::string tf = args(0).string_value ();
  std::string root = arg_string (args, 2, ".");
  Cell files = args(1).cell_value ();

  std::vector<std::pair<std::string, std::string> > entries;
  for (octave_idx_type i = 0; i < files.numel (); i++)
    {
      std::string f = files(i).string_value ();
      if (is_dir (f)) collect (f, "", entries);
      else entries.push_back (std::make_pair (f, basename_of (f)));
    }

  std::vector<unsigned char> out;
  std::vector<std::string> names;
  for (size_t i = 0; i < entries.size (); i++)
    {
      std::vector<unsigned char> raw;
      if (! read_file (entries[i].first, raw)) continue;
      std::string arcname = root == "." ? entries[i].second
                                        : join (root, entries[i].second);
      tar_header (out, arcname, raw.size (), '0');
      out.insert (out.end (), raw.begin (), raw.end ());
      tar_pad (out);
      names.push_back (arcname);
    }
  out.insert (out.end (), 2 * TAR_BLOCK, 0);   // 结束标记

  if (! write_file (tf, out.data (), out.size ()))
    error ("__web_tar__: cannot write '%s'", tf.c_str ());
  return to_cellstr (names);
}

DEFUN_DLD (__web_untar__, args, nargout,
           "Extract a ustar archive in-process. Internal use.")
{
  if (args.length () < 1)
    error ("__web_untar__: need a tar file");
  std::string tf = args(0).string_value ();
  std::string outdir = arg_string (args, 1, ".");

  std::vector<unsigned char> buf;
  if (! read_file (tf, buf))
    error ("__web_untar__: cannot read '%s'", tf.c_str ());

  std::vector<std::string> written;
  size_t p = 0;
  std::string pending_long;
  while (p + TAR_BLOCK <= buf.size ())
    {
      const unsigned char *h = &buf[p];
      bool zero = true;
      for (int i = 0; i < TAR_BLOCK; i++) if (h[i]) { zero = false; break; }
      if (zero) break;

      std::string name ((const char *) h, strnlen ((const char *) h, 100));
      std::string prefix ((const char *) h + 345,
                          strnlen ((const char *) h + 345, 155));
      if (! prefix.empty ()) name = prefix + "/" + name;
      unsigned long size = tar_octal (h + 124, 12);
      char typeflag = (char) h[156];
      p += TAR_BLOCK;

      if (typeflag == 'L')   // GNU long name
        {
          pending_long.assign ((const char *) &buf[p], size);
          while (! pending_long.empty ()
                 && (pending_long[pending_long.size () - 1] == '\0'))
            pending_long.erase (pending_long.size () - 1);
          p += ((size + TAR_BLOCK - 1) / TAR_BLOCK) * TAR_BLOCK;
          continue;
        }
      if (! pending_long.empty ()) { name = pending_long; pending_long.clear (); }

      if (typeflag == '5')
        { mkdir_p (join (outdir, name)); continue; }
      if (typeflag != '0' && typeflag != '\0' && typeflag != '7')
        { p += ((size + TAR_BLOCK - 1) / TAR_BLOCK) * TAR_BLOCK; continue; }

      std::string target = join (outdir, name);
      mkdir_p (dirname_of (target));
      if (write_file (target, &buf[p], size))
        written.push_back (target);
      p += ((size + TAR_BLOCK - 1) / TAR_BLOCK) * TAR_BLOCK;
    }

  return to_cellstr (written);
}
