## 无 shell 覆写：走进程内 __web_gunzip__（zlib）
function varargout = gunzip (file, outdir)
  if (nargin < 2 || isempty (outdir))
    [d, b, e] = fileparts (file);
    outdir = d; if (isempty (outdir)); outdir = "."; endif
  endif
  files = __web_gunzip__ (file, fullfile (outdir, "")); 
  if (nargout > 0); varargout{1} = files; endif
endfunction
