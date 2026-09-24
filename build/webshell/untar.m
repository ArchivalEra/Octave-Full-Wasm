## 无 shell 覆写：走进程内 __web_untar__
function varargout = untar (tarfile, outdir)
  if (nargin < 2 || isempty (outdir)); outdir = "."; endif
  files = __web_untar__ (tarfile, outdir);
  if (nargout > 0); varargout{1} = files; endif
endfunction
