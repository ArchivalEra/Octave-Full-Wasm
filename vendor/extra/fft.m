## Pure-M fallback FFT for builds without an FFTW backend (e.g. Octave-WASM).
## Written from scratch for this project (public domain / same license as repo).
## Supports fft (X), fft (X, N) and fft (X, N, DIM); vectors, matrices
## (column-wise, like the built-in) and N-D arrays along DIM.
## Radix-2 recursion for powers of two, direct DFT otherwise.

function y = fft (x, n, dim)

  if (nargin < 1)
    error ("fft: function called with too few input arguments.");
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

  ## Resize along DIM (pad with zeros / truncate), like the built-in.
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

  ## Move DIM to the front, transform each column, move back.
  order = 1:max (ndims (x), dim);
  order([1, dim]) = order([dim, 1]);
  xp = permute (x, order);
  yp = zeros (size (xp));
  for k = 1:numel (yp) / size (yp, 1)
    yp(:, k) = fft1 (xp(:, k));
  endfor
  y = ipermute (yp, order);

endfunction

function y = fft1 (v)

  n = numel (v);
  v = v(:);
  if (n <= 1)
    y = v;
  elseif (n == 2 ^ nextpow2 (n))
    e = fft1 (v(1:2:end));
    o = fft1 (v(2:2:end));
    w = exp (-2i * pi * (0:n/2-1).' / n);
    y = [e + w .* o; e - w .* o];
  else
    k = (0:n-1).';
    y = exp (-2i * pi * k * k.' / n) * v;
  endif

endfunction
