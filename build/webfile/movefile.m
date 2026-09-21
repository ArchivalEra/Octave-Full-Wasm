## -*- texinfo -*-
## @deftypefn  {} {} movefile @var{f1} @var{f2}
## @deftypefnx {} {} movefile @var{f1} @var{f2} f
## @deftypefnx {} {[@var{status}, @var{msg}, @var{msgid}] =} movefile (@var{f1}, @var{f2})
## Move the source file(s) or directory @var{f1} to the destination @var{f2}.
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
## @seealso{copyfile, rename, unlink, delete, glob}
## @end deftypefn

## Octave-Full-Wasm: in-process movefile (no shell).
##
## Same reason as copyfile: the stock implementation shells out to `mv`, which
## cannot start in this build.  `rename` is a real Octave primitive here and
## handles the move in-process.
##
## Two cases `rename` alone cannot cover, both handled below:
##
##   * **Cross-directory moves onto an existing file.**  `mv a b` replaces b;
##     `rename (a, b)` may refuse depending on the backend.  When rename fails
##     we fall back to copy-then-unlink, which is what `mv` effectively does in
##     that situation.
##   * **Multiple sources.**  A loop, with the same "F2 must be a directory"
##     precondition upstream enforces.
##
## The `'f'` flag is accepted and has nothing to do: there is no interactive
## prompt to suppress (same note as copyfile).

function [status, msg, msgid] = movefile (f1, f2, force)

  if (nargin < 1)
    print_usage ();
  endif

  status = false;
  msg = "";
  msgid = "";

  if (ischar (f1))
    srcs = cellstr (f1);
  elseif (iscellstr (f1))
    srcs = f1;
  else
    error ("movefile: F1 must be a string or a cell array of strings");
  endif

  if (nargin < 2)
    f2 = pwd ();
  elseif (! ischar (f2))
    error ("movefile: F2 must be a string");
  endif

  ## Upstream allows an empty source list to mean "nothing to do" only after
  ## globbing; before that an empty cell is a caller error.
  if (isempty (srcs))
    [status, msg, msgid] = __wf_fail__ ("movefile", "no files to move");
    return;
  endif

  ## Glob each element, the same way upstream does on non-Windows.
  expanded = {};
  for k = 1:numel (srcs)
    g = glob (srcs{k});
    if (isempty (g))
      ## No wildcard and no such file: glob gives back nothing, but cp/mv
      ## would have reported the name itself.  Keep it so the caller gets a
      ## concrete failure instead of a silent no-op.
      expanded{end+1} = srcs{k};
    else
      expanded = [expanded, g];
    endif
  endfor
  srcs = expanded;

  f2 = tilde_expand (f2);
  f2_is_dir = isfolder (f2);

  if (numel (srcs) > 1 && ! f2_is_dir)
    [status, msg, msgid] = __wf_fail__ ("movefile",
      "when copying multiple files, F2 must be a directory");
    return;
  endif

  for k = 1:numel (srcs)
    s = srcs{k};
    if (! exist (s, "file") && ! isfolder (s))
      [status, msg, msgid] = __wf_fail__ ("movefile",
        sprintf ("%s: No such file or directory", s));
      return;
    endif
    if (f2_is_dir)
      d = fullfile (f2, __wf_basename__ (s));
    else
      d = f2;
    endif

    ok = false;
    m = "";
    [rst, rm] = __wf_try_rename__ (s, d);
    if (rst)
      ok = true;
    else
      ## rename() can fail across directories or onto an existing file; a
      ## copy+unlink does the same job and is what mv falls back to as well.
      if (isfolder (s))
        [cok, cm] = __wf_copy_dir__ (s, d);
      else
        [cok, cm] = __wf_copy_file__ (s, d);
      endif
      if (cok)
        ## Only remove the source once the copy is confirmed complete; the
        ## other order loses data on a failed copy.
        [ust, um] = __wf_rmtree__ (s);
        if (ust)
          ok = true;
        else
          m = um;
        endif
      else
        m = cm;
        if (isempty (m))
          m = rm;
        endif
      endif
    endif

    if (! ok)
      [status, msg, msgid] = __wf_fail__ ("movefile", m);
      return;
    endif
  endfor

  status = true;

endfunction


%!test
%! ## Simple in-directory move: source gone, destination present.
%! d = tempname (); mkdir (d);
%! a = fullfile (d, "a.txt");
%! fid = fopen (a, "w"); fputs (fid, "hello"); fclose (fid);
%! b = fullfile (d, "b.txt");
%! [st, m] = movefile (a, b);
%! assert (st, true);
%! assert (m, "");
%! assert (exist (a, "file"), 0);
%! assert (exist (b, "file"), 2);

%!test
%! ## Content survives the move.
%! d = tempname (); mkdir (d);
%! a = fullfile (d, "c.txt");
%! fid = fopen (a, "w"); fputs (fid, "payload"); fclose (fid);
%! [st, ~] = movefile (a, fullfile (d, "d.txt"));
%! assert (st, true);
%! fid = fopen (fullfile (d, "d.txt"), "r"); got = fread (fid, Inf, "*char")'; fclose (fid);
%! assert (got, "payload");

%!test
%! ## Missing source is a reported failure, not a crash.
%! [st, m, id] = movefile ("/no/such/file.txt", "/tmp/x.txt");
%! assert (st, false);
%! assert (! isempty (m));
%! assert (id, "movefile");

%!test
%! ## Glob into a directory.
%! d = tempname (); mkdir (fullfile (d, "out"));
%! for k = 1:2
%!   fid = fopen (fullfile (d, sprintf ("q%d.txt", k)), "w"); fputs (fid, "z"); fclose (fid);
%! endfor
%! [st, ~] = movefile (fullfile (d, "q*.txt"), fullfile (d, "out"));
%! assert (st, true);
