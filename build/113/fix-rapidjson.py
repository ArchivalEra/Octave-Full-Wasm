#!/usr/bin/env python3
# rapidjson 1.1.0 与新 clang 的不兼容补丁
#
# 现象（实测编译 Octave 11.3.0 的 jsondecode.cc 时）：
#   /src/deps/rapidjson/include/rapidjson/document.h:319:82:
#   error: cannot assign to non-static data member 'length'
#          with const-qualified type 'const SizeType' (aka 'const unsigned int')
#
# 原因：GenericStringRef 的两个成员**本来就是 const**
#   const Ch* const s;   const SizeType length;
# 而它的拷贝赋值运算符却去写这两个成员 —— 语义上只能是个 no-op。
# 旧版 clang 放过了，新 clang 直接报错。
#
# 处置：按上游做法把那个运算符改成 no-op（而不是删掉——删掉会让依赖该运算符
# 存在的代码在编译期失败；改成 no-op 与原语义等价，因为成员本就不可变）。
#
# 用法：fix-rapidjson.py <document.h 路径>
import io
import sys

OLD = ("GenericStringRef& operator=(const GenericStringRef& rhs) "
       "{ s = rhs.s; length = rhs.length; }")
NEW = ("GenericStringRef& operator=(const GenericStringRef& rhs) "
       "{ (void) rhs; return *this; }  "
       "/* [Octave-Full-Wasm 补丁] 成员皆 const，原实现写 const 成员，新 clang 报错 */")


def main():
    if len(sys.argv) != 2:
        sys.exit("用法: fix-rapidjson.py <document.h>")
    path = sys.argv[1]
    try:
        text = io.open(path, encoding="utf-8").read()
    except OSError as e:
        sys.exit("FATAL: 打不开 %s: %s" % (path, e))

    if "Octave-Full-Wasm 补丁" in text:
        print("   （rapidjson 补丁已在）")
        return
    if OLD not in text:
        sys.exit("FATAL: 在 %s 里找不到待修的那一行，需人工核对（版本变了？）" % path)

    io.open(path, "w", encoding="utf-8").write(text.replace(OLD, NEW))
    print("   （已给 rapidjson 打 const 赋值补丁）")


if __name__ == "__main__":
    main()
