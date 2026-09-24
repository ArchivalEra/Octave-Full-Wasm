## 无 shell 覆写：走进程内 __web_tar__
function varargout = tar (tarfile, files, rootdir)
  if (nargin < 3 || isempty (rootdir)); rootdir = "."; endif
  if (ischar (files)); files = {files}; endif
  names = __web_tar__ (tarfile, files, rootdir);
  if (nargout > 0); varargout{1} = names; endif
endfunction
