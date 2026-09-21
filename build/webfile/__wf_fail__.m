## Octave-Full-Wasm — 统一的失败返回（纯 .m，无 shell）
## Copyright (C) 2026 ArchivalEra
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## Undocumented internal helper for the wasm file-operation overrides.

## Build the @code{[status, msg, msgid]} triple these file operations document,
## so every failure path in copyfile/movefile reports the same way.
##
## Having one place for this keeps the error contract honest: the callers all
## return three outputs, and a stray `msg = ""` in one branch is exactly the
## kind of thing that makes a caller's error message come out blank.

function [status, msg, msgid] = __wf_fail__ (func, text)

  status = false;
  msg = text;
  msgid = func;

endfunction


%!test
%! [st, m, id] = __wf_fail__ ("copyfile", "boom");
%! assert (st, false);
%! assert (m, "boom");
%! assert (id, "copyfile");
