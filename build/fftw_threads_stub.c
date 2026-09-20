/* Thread hooks for --disable-threads FFTW builds.
   Octave treats fftw_init_threads()==0 as fatal, so claim success (1);
   plans still execute serially (plan_with_nthreads is a no-op). */
int fftw_init_threads(void) { return 1; }
void fftw_plan_with_nthreads(int n) { (void) n; }
int fftwf_init_threads(void) { return 1; }
void fftwf_plan_with_nthreads(int n) { (void) n; }
