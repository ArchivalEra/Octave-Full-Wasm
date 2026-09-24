## 无 shell 覆写：走进程内 __web_unzip__（原版调 system("unzip …") 在 wasm 里必失败）
function varargout = unzip (zipfile, outdir)
  if (nargin < 2 || isempty (outdir)); outdir = "."; endif
  files = __web_unzip__ (zipfile, outdir);
  if (nargout > 0); varargout{1} = files; endif
endfunction
