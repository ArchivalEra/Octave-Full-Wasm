## -*- texinfo -*-
## @deftypefn  {} {} copyfile @var{f1} @var{f2}
## @deftypefnx {} {} copyfile @var{f1} @var{f2} f
## @deftypefnx {} {@var{status} =} copyfile (@dots{})
## @deftypefnx {} {[@var{status}, @var{msg}, @var{msgid}] =} copyfile (@dots{})
## Copy the source file(s) or directory @var{f1} to the destination @var{f2}.
##
## The name @var{f1} may contain globbing patterns, or may be a cell array of
## strings.  If @var{f1} expands to multiple filenames, @var{f2} must be a
## directory.
##
## When the force flag @qcode{'f'} is given any existing files will be
## overwritten without prompting.
##
## If successful, @var{status} is logical 1, and @var{msg}, @var{msgid} are
## empty character strings ("").  Otherwise, @var{status} is logical 0,
## @var{msg} contains a system-dependent error message, and @var{msgid}
## contains a unique message identifier.  Note that the status code is exactly
## opposite that of the @code{system} command.
## @seealso{movefile, rename, unlink, delete, glob}
## @end deftypefn

## Octave-Full-Wasm: in-process copyfile (no shell).
##
## Why this override exists
## ------------------------
## The stock implementation ends in
##
##     [err, msg] = system (sprintf ('cp -r %s"%s"', p1, p2));
##
## and this build has no subprocess support by design (HANDOFF §7), so *every*
## copyfile call fails with "unable to start subprocess for 'cp -r ...'".
## The browser has no `cp`; what it has is a filesystem Octave can already
## read and write through fopen/fread/fwrite — so the copy is done in-process.
##
## Scope and fidelity
## ------------------
## This keeps the documented contract above exactly: same argument forms, same
## three-output [status, msg, msgid] convention, same "status is opposite of
## system()" inversion.  Behavioural notes where the shell version and this one
## could differ:
##
##   * Glob expansion uses Octave's `glob`, as upstream does on non-Windows.
##   * Multiple sources require a directory destination — upstream errors there
##     and so do we, with the same message text.
##   * The `'f'` (force) flag is accepted.  Upstream it suppresses `cp`'s
##     interactive prompt, and a prompt cannot happen here at all, so the flag
##     is accepted and has nothing to do — same observable behaviour.
##   * Recursive directory copies are done by __wf_copy_dir__ with `cp -r`
##     semantics (contents into a new destination, basename nesting into an
##     existing one).
##
## Not implemented: preserving permissions/timestamps.  There is no POSIX mode
## in the browser filesystem to preserve, and nothing in this project's own
## flows (or Forge's) depends on it.

function [status, msg, msgid] = copyfile (f1, f2, force)

  if (nargin < 2)
    print_usage ();
  endif

  status = false;
  msg = "";
  msgid = "";

  if (nargin > 2 && ! ischar (force))
    error ("copyfile: FORCE must be a character string");
  endif

  ## Normalize the source list.  Upstream globs on non-Windows platforms and
  ## uses __wglob__ on Windows; there is no Windows here, so glob is the whole
  ## story.
  if (iscellstr (f1))
    srcs = f1;
  elseif (ischar (f1))
    srcs = glob (f1);
    if (isempty (srcs))
      ## glob() returns empty for a name with no wildcard when the file simply
      ## does not exist.  Upstream reports "no files to move" for that case;
      ## keep the same message so callers matching on it behave the same.
      [status, msg, msgid] = __wf_fail__ ("copyfile", "no files to move");
      return;
    endif
  else
    error ("copyfile: F1 must be a character string or cell array of strings");
  endif

  if (isempty (srcs))
    [status, msg, msgid] = __wf_fail__ ("copyfile", "no files to move");
    return;
  endif

  f2 = tilde_expand (f2);
  f2_is_dir = isfolder (f2);

  if (numel (srcs) > 1 && ! f2_is_dir)
    ## Upstream's wording, so scripts that match on it keep working.
    [status, msg, msgid] = __wf_fail__ ("copyfile",
      "when copying multiple files, F2 must be a directory");
    return;
  endif

  ## A single directory source: recurse.
  if (numel (srcs) == 1 && isfolder (srcs{1}))
    [ok, m] = __wf_copy_dir__ (srcs{1}, f2);
    if (! ok)
      [status, msg, msgid] = __wf_fail__ ("copyfile", m);
    else
      status = true;
    endif
    return;
  endif

  ## One or more regular files.
  for k = 1:numel (srcs)
    s = srcs{k};
    if (f2_is_dir)
      d = fullfile (f2, __wf_basename__ (s));
    else
      d = f2;
    endif
    [ok, m] = __wf_copy_file__ (s, d);
    if (! ok)
      [status, msg, msgid] = __wf_fail__ ("copyfile", m);
      return;
    endif
  endfor

  status = true;

endfunction


%!test
%! ## Single file.
%! d = tempname (); mkdir (d);
%! a = fullfile (d, "a.txt");
%! fid = fopen (a, "w"); fputs (fid, "hello"); fclose (fid);
%! [st, m] = copyfile (a, fullfile (d, "b.txt"));
%! assert (st, true);
%! assert (m, "");

%!test
%! ## Directory recursion, including a nested subdirectory.
%! d = tempname (); mkdir (fullfile (d, "src", "sub"));
%! fid = fopen (fullfile (d, "src", "x.txt"), "w"); fputs (fid, "X"); fclose (fid);
%! fid = fopen (fullfile (d, "src", "sub", "y.txt"), "w"); fputs (fid, "Y"); fclose (fid);
%! [st, m] = copyfile (fullfile (d, "src"), fullfile (d, "dst"));
%! assert (st, true);
%! assert (m, "");

%!test
%! ## Glob expansion into an existing directory.
%! d = tempname (); mkdir (d);
%! for k = 1:3
%!   fid = fopen (fullfile (d, sprintf ("g%d.txt", k)), "w"); fputs (fid, "z"); fclose (fid);
%! endfor
%! mkdir (fullfile (d, "out"));
%! [st, ~] = copyfile (fullfile (d, "g*.txt"), fullfile (d, "out"));
%! assert (st, true);

%!test
%! ## Missing source reports failure through the documented outputs, not an error.
%! [st, m, id] = copyfile ("/definitely/not/here.txt", "/tmp/whatever.txt");
%! assert (st, false);
%! assert (! isempty (m));
%! assert (id, "copyfile");

%!test
%! ## Multiple sources need a directory destination.
%! d = tempname (); mkdir (d);
%! a = fullfile (d, "m1.txt"); fid = fopen (a, "w"); fputs (fid, "1"); fclose (fid);
%! b = fullfile (d, "m2.txt"); fid = fopen (b, "w"); fputs (fid, "2"); fclose (fid);
%! [st, m] = copyfile ({a, b}, fullfile (d, "notadir.txt"));
%! assert (st, false);
%! assert (! isempty (strfind (m, "must be a directory")));
