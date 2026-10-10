// 测试：side module 用 libc++ 的模板/STL，宿主（Octave）是否导出这些实现？
#include <octave/oct.h>
#include <vector>
#include <map>
#include <string>
#include <sstream>
DEFUN_DLD (needlib, args, nargout, "needlib - 用 STL 模板，看符号从哪来")
{
  std::vector<double> v;
  for (int i = 0; i < 5; i++) v.push_back (i * 1.5);
  std::map<std::string,double> m;
  m["a"] = v[0]; m["b"] = v[4];
  std::ostringstream os;
  os << "sum=" << (m["a"] + m["b"]) << " n=" << v.size ();
  octave_value_list retval (nargout > 0 ? 1 : 0);
  if (nargout > 0) retval(0) = octave_value (os.str ());
  return retval;
}
