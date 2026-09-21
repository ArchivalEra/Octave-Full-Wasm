## plot3 for the plot bridge (own code, repo license).
## SPDX-License-Identifier: AGPL-3.0-or-later
##
## plot3(X,Y,Z) | plot3(X,Y,Z,SPEC) | plot3(Y) | plot3(Z) | plot3(..., 'Property', val)
##
## The core plot3 opens a real 3D axes; this build has none.  The curve is
## projected to 2D here (see __pb_project3__) and handed to the normal line
## renderer, so both renderers work unchanged and print -dsvg covers 3D.
##
## Property/value pairs after the data are accepted and ignored (the ones that
## matter — color/marker/linestyle — come through the SPEC string, as in Octave).

function h = plot3 (varargin)

  s = __pstate__ ();
  if (! s.hold)
    s = __pb_clear_series__ (s);
  endif

  args = varargin;
  ## drop trailing property/value pairs: only data and one spec string matter
  while (numel (args) >= 2 && ischar (args{end - 1}) && ischar (args{end}))
    args(end - 1:end) = [];
  endwhile

  n = numel (args);
  i = 1;
  while (i <= n)
    a = args{i};
    if (ischar (a))
      ## stray spec — attach to the previous series
      if (! isempty (s.series))
        s.series{end}.title = s.series{end}.title;
      endif
      i += 1;
      continue;
    endif

    ## NOTE: the index guards must be checked before touching args{i+1} —
    ## `args{i+1}` with i+1 > n is an out-of-bound error, not a false value.
    if (i + 2 <= n && isnumeric (args{i + 1}) && isnumeric (args{i + 2}))
      x = args{i}; y = args{i + 1}; z = args{i + 2};
      i += 3;
    elseif (i + 1 <= n && isnumeric (args{i + 1}))
      x = args{i}; y = args{i + 1}; z = [];
      i += 2;
    else
      x = []; y = []; z = a;
      i += 1;
    endif

    ## accept a trailing spec for this triple
    spec = "";
    if (i <= n && ischar (args{i}))
      spec = args{i};
      i += 1;
    endif

    if (isempty (y) && isempty (x))
      ## single-arg form plot3(Z): x is the sample index, y is zero, z the data.
      ## NOTE: do not name this `n` — that is the argument count driving the
      ## while loop above, and shadowing it runs the loop off the end of args.
      nz = numel (z);
      y = zeros (nz, 1);
      x = (1:nz).';
    elseif (isempty (z))
      ## 2-arg form plot3(X,Y): lift the (x,y) line into 3D with z = y.
      ## Octave's own plot3 errors here, but plot3(x,y) in a script means
      ## "that line, viewed in 3D", so honour the intent.
      z = y;
    endif

    ## Octave accepts rows; make everything columns
    x = x(:); y = y(:); z = z(:);
    if (! (numel (x) == numel (y) && numel (y) == numel (z)))
      error ("plot3: X, Y and Z must have the same number of elements");
    endif

    [X, Y] = __pb_project3__ (x, y, z);
    s = __pb_add__ (s, X, Y, spec, "lines");
  endwhile

  __pstate__ (s);
  h = [];

endfunction
