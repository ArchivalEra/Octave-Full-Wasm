## Minimal one-sample / paired t-test for Octave builds whose core MEAN/STD
## predate the 'omitnan' flag (core < 9) — e.g. Octave-WASM 7.2.
## Written from scratch for this project (same license as the repo).
## API subset: [H, P] = ttest (X, M) / ttest (X, Y) with Name-Value pairs
## 'alpha', 'tail' ('both'|'right'|'left'), 'dim'.  NaNs are stripped
## ('omitnan' semantics).  P-values/quantiles delegate to tcdf/tinv.

function [h, pval, ci, stats] = ttest (x, m, varargin)

  alpha = 0.05;
  tail = "both";
  dim = find (size (x) != 1, 1);
  if (isempty (dim))
    dim = 1;
  endif

  if (nargin < 2 || isempty (m))
    m = 0;
  endif

  i = 1;
  while (i <= numel (varargin))
    key = lower (varargin{i});
    if (strcmp (key, "alpha"))
      alpha = varargin{i+1};
    elseif (strcmp (key, "tail"))
      tail = lower (varargin{i+1});
    elseif (strcmp (key, "dim"))
      dim = varargin{i+1};
    else
      error ("ttest: invalid Name argument '%s'.", varargin{i});
    endif
    i += 2;
  endwhile

  if (! (isscalar (alpha) && alpha > 0 && alpha < 1))
    error ("ttest: ALPHA must be a scalar between 0 and 1.");
  endif
  if (! any (strcmp (tail, {"both", "right", "left"})))
    error ("ttest: TAIL must be 'both', 'right' or 'left'.");
  endif

  ## Paired test: second arg is a data vector, not a hypothesised mean.
  if (! isscalar (m))
    if (! isequal (size (x), size (m)))
      error ("ttest: paired samples X and Y must have the same size.");
    endif
    x = x - m;
    m = 0;
  endif
  x = x - m;

  ## Work along DIM: move it front, one column per test.
  nd = max (ndims (x), dim);
  order = 1:nd;
  order([1, dim]) = order([dim, 1]);
  xp = permute (x, order);
  nr = size (xp, 1);
  rest = size (xp)(2:end);
  if (isempty (rest))
    rest = 1;
  endif
  xp = reshape (xp, nr, prod (rest));

  h = NaN (1, columns (xp));
  pval = NaN (1, columns (xp));
  ci = NaN (2, columns (xp));
  stats.tstat = NaN (1, columns (xp));
  stats.df = NaN (1, columns (xp));
  stats.sd = NaN (1, columns (xp));

  for k = 1:columns (xp)
    col = xp(:, k);
    col = col(! isnan (col));
    nn = numel (col);
    if (nn < 2)
      continue;
    endif
    xb = mean (col);
    s = std (col);
    se = s / sqrt (nn);
    t = xb / se;
    df = nn - 1;
    stats.tstat(k) = t;
    stats.df(k) = df;
    stats.sd(k) = s;
    switch (tail)
      case "both"
        pval(k) = 2 * tcdf (-abs (t), df);
        crit = tinv (1 - alpha / 2, df);
        ci(:, k) = xb + [-crit; crit] * se;
      case "right"
        pval(k) = 1 - tcdf (t, df);
        crit = tinv (1 - alpha, df);
        ci(:, k) = [xb - crit * se; Inf];
      case "left"
        pval(k) = tcdf (t, df);
        crit = tinv (1 - alpha, df);
        ci(:, k) = [-Inf; xb + crit * se];
    endswitch
    h(k) = pval(k) < alpha;
  endfor

  outsz = size (x);
  outsz(dim) = 1;
  h = reshape (h, outsz);
  pval = reshape (pval, outsz);
  stats.tstat = reshape (stats.tstat, outsz);
  stats.df = reshape (stats.df, outsz);
  stats.sd = reshape (stats.sd, outsz);
  cisz = outsz;
  cisz(dim) = 2;
  ci = reshape (ipermute (reshape (ci, [2, rest]), order), cisz);

endfunction
