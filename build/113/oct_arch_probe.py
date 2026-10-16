#!/usr/bin/env python3
# 薄包装：把 `oct-arch.py`（文件名带横线，不能直接 import）里**纯函数**导出来给装配器用。
# 只导出，不加逻辑 —— 判据的唯一产地在 oct-arch.py。
import importlib.util as _iu, os as _os
_p = _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "oct-arch.py")
_spec = _iu.spec_from_file_location("_oct_arch", _p)
_mod = _iu.module_from_spec(_spec)
_spec.loader.exec_module(_mod)
arch_of_bytes = _mod.arch_of_bytes
arch_of_file = _mod.arch_of_file
