// 实验③夹具：真抛/真接异常，验证 Wasm EH 能否跨 dlopen 边界工作
#include <octave/oct.h>
DEFUN_DLD (minithrow, args, nargout,
           "minithrow (mode) - 抛异常并用 try/catch 接住（验证 Wasm EH 跨 dlopen）。")
{
  int mode = (args.length () > 0) ? (int) args(0).double_value () : 0;
  int caught = 0;
  std::string tag = "none";
  try
    {
      if (mode == 1)
        throw std::runtime_error ("thrown-from-oct");
      else if (mode == 2)
        error ("octave-error-from-oct");     // Octave 的 error() 也走异常路径
      else
        tag = "no-throw";
    }
  catch (const std::exception& e)
    {
      caught = 1;
      tag = std::string ("caught:") + e.what ();
    }
  octave_value_list retval (nargout > 0 ? 1 : 0);
  if (nargout > 0)
    retval(0) = octave_value (std::string (tag) + "|caught=" + (caught ? "1" : "0"));
  return retval;
}
