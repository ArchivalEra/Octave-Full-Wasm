## Pure-M fallback IFFT, companion to fft.m (same project, same license).
## ifft (X) = conj (fft (conj (X))) / N, with fft (X, N [, DIM]) support.

function y = ifft (x, n, dim)

  if (nargin < 1)
    error ("ifft: function called with too few input arguments.");
  endif

  if (nargin < 3 || isempty (dim))
    dim = find (size (x) > 1, 1);
    if (isempty (dim))
      dim = 1;
    endif
  endif
  if (nargin < 2 || isempty (n))
    n = size (x, dim);
  endif

  if (size (x, dim) < n)
    sz = ones (1, max (ndims (x), dim));
    for k = 1:numel (sz)
      sz(k) = size (x, k);
    endfor
    sz(dim) = n - size (x, dim);
    x = cat (dim, x, zeros (sz));
  elseif (size (x, dim) > n)
    idx.type = "()";
    idx.subs = repmat ({":"}, 1, max (ndims (x), dim));
    idx.subs{dim} = 1:n;
    x = subsref (x, idx);
  endif

  y = conj (fft (conj (x), [], dim)) / n;

endfunction
