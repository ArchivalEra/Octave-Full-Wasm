## -*- texinfo -*-
## @deftypefn  {} {} ls
## @deftypefnx {} {} ls @var{filenames}
## @deftypefnx {} {} ls @var{options} @var{filenames}
## @deftypefnx {} {@var{list} =} ls (@dots{})
## List directory contents.
##
## The @code{ls} command is implemented by calling the shell's @code{ls}
## program.  Options may be passed to that program, although this is not
## supported on Windows.
##
## When called with output arguments, return the list as a character matrix
## rather than printing it.
## @seealso{dir, glob, what, stat}
## @end deftypefn

## Octave-Full-Wasm: in-process ls (no shell).
##
## The stock implementation builds a shell command and runs it through
## `system`.  This build has no subprocess support, so `ls` failed outright --
## including the `list = ls(...)` form, which is the one Forge code actually
## uses.  Here the listing comes from Octave's own `dir`/`glob` instead.
##
## Fidelity notes (documented rather than silently different):
##
##   * **Options are not implemented.** The shell `ls` accepted things like
##     "-l" and "-R"; there is no shell here to pass them to.  Rather than
##     silently ignoring an option and returning something that looks fine but
##     is not what was asked for, any argument starting with "-" raises a clear
##     error naming the limitation.
##   * **The no-output form prints names one per line**, not in shell `ls`'s
##     multi-column layout.  Column layout is cosmetic and the pager does not
##     exist here; a stable one-per-line list is more useful and is what the
##     `-1` form produced upstream anyway.
##   * Glob patterns are expanded by Octave's `glob`, so `ls *.txt` works.
##   * With no arguments the listing is of the current directory, as upstream.

function retval = ls (varargin)

  if (! iscellstr (varargin))
    error ("ls: all arguments must be character strings");
  endif

  names = {};

  if (nargin == 0)
    names = __wf_list_dir__ (pwd ());
  else
    args = tilde_expand (varargin);
    for k = 1:numel (args)
      arg = args{k};
      if (! isempty (arg) && arg(1) == "-")
        ## Continuation needs "..." or Octave sees two statements.
        error ("ls: options are not supported in this build (no shell); ...", ...
               "call ls with a filename or glob pattern instead");
      endif
      ## One argument may itself be several space-separated names (upstream
      ## accepts `ls ("-l /usr/bin")`).  Split on whitespace so that form keeps
      ## working for the parts that are not options.
      parts = ostrsplit (strtrim (arg), " ");
      parts = parts(! cellfun (@isempty, parts));
      for j = 1:numel (parts)
        p = parts{j};
        if (isfolder (p))
          names = [names, __wf_list_dir__(p)];
        else
          ## Glob matches keep the form the caller asked for: `ls /tmp/*.txt`
          ## shows qualified paths, `ls *.txt` shows bare names.  That is what
          ## the shell does, and it costs nothing to keep here.
          g = glob (p);
          if (! isempty (g))
            names = [names, g];
          elseif (exist (p, "file"))
            names{end+1} = p;
          endif
          ## A pattern that matches nothing contributes nothing.
        endif
      endfor
    endfor
  endif

  if (nargout > 0)
    if (isempty (names))
      retval = "";
    else
      ## Upstream returned a character matrix (strvcat); keep that shape so
      ## callers doing size(retval)/indexing keep working.
      retval = strvcat (names{:});
    endif
  elseif (isempty (names))
    ## nothing to print
  else
    ## One per line, newline-terminated: the form that stays readable without
    ## a pager and matches what `ls -1` produced.
    for k = 1:numel (names)
      printf ("%s\n", names{k});
    endfor
  endif

endfunction


%!test
%! ## Listing a directory returns something indexable.
%! d = tempname (); mkdir (d);
%! fid = fopen (fullfile (d, "one.txt"), "w"); fputs (fid, "1"); fclose (fid);
%! r = ls (d);
%! assert (ischar (r));
%! assert (! isempty (strfind (strjoin (cellstr (r), " "), "one.txt")));

%!test
%! ## Glob form.  NOTE: the result is a char MATRIX (strvcat shape, as
%! ## upstream returned), so a naive strfind(r, "q1.txt") searches column-wise
%! ## and can miss.  Join the rows before asserting.
%! d = tempname (); mkdir (d);
%! fid = fopen (fullfile (d, "q1.txt"), "w"); fputs (fid, "1"); fclose (fid);
%! fid = fopen (fullfile (d, "q2.txt"), "w"); fputs (fid, "2"); fclose (fid);
%! r = ls (fullfile (d, "q*.txt"));
%! joined = strjoin (cellstr (r), " ");
%! assert (! isempty (strfind (joined, "q1.txt")));
%! assert (! isempty (strfind (joined, "q2.txt")));

%!test
%! ## Options are refused with a clear message rather than silently ignored.
%! try
%!   ls ("-l");
%!   error ("expected an error for the -l option");
%! catch err
%!   assert (! isempty (strfind (err.message, "not supported")));
%! end_try_catch

%!test
%! ## No arguments lists the current directory (must not error).
%! r = ls ();
%! assert (ischar (r));
