# Copyright 2018-2022 Richard Lincoln. All rights reserved.

#MKOCTFILE = mkoctfile
#OCTAVE_VER = 4.4.1
OCTAVE_VER = 7.2.0

CXX = em++
#CPPFLAGS += `$(MKOCTFILE) -p ALL_CXXFLAGS` `$(MKOCTFILE) -p XTRA_CXXFLAGS`
#CXXFLAGS += -Wall -std=c++11
#CXXFLAGS += -I. -I$(PGV)
#LDFLAGS += -L/usr/local/lib \
#           -Wl,--no-as-needed -Wl,--as-needed\
#           -ldl\
#	   -Wall -std=c++11 -pthread -fopenmp -g -O0 -rdynamic -fPIC -Wl,-Bsymbolic-functions -Wl,-z,relro\
#	   `$(MKOCTFILE) -p LFLAGS` `$(MKOCTFILE) -p OCTAVE_LIBS` -lre2

PREFIX = ../target

MFILE_PATH ?= $(PREFIX)/share/octave/$(OCTAVE_VER)/m

#EM_CFLAGS = -O0 -g -Wall -std=c++11 -fwasm-exceptions
EM_CFLAGS = -O2 -Wall -std=c++11 -fwasm-exceptions
#EM_CFLAGS = -O0 -Wall -std=c++11
#EM_CFLAGS = -O2 --closure 1 -Wall -std=c++11 -fwasm-exceptions
#EM_CFLAGS = -O3 --closure 1 -Wall -std=c++11 -fwasm-exceptions
EM_CXXFLAGS = -I. -I$(PREFIX)/include -I$(PREFIX)/include/octave-$(OCTAVE_VER)/octave/.. -I$(PREFIX)/include/octave-$(OCTAVE_VER)/octave
EM_LDFLAGS = -L$(PREFIX)/lib -L$(PREFIX)/lib/octave/$(OCTAVE_VER) -lf2c -lrefblas -lclapack -lpcre \
-lsuitesparseconfig -lcxsparse -lamd -lcamd -lcolamd -lcholmod -lumfpack -loctave -loctinterp \
-lqrupdate -larpack -lfftw3 -lfftw3f -lqhull_r -lglpk -lf2c -lm \
/usr/src/octave-wasm/target/lib/fftw_threads_stub.o \
/usr/src/octave-wasm/target/lib/__delaunayn__.o \
/usr/src/octave-wasm/target/lib/__glpk__.o \
/usr/src/octave-wasm/target/lib/__voronoi__.o
EM_SFLAGS = -s WASM=1 -s ERROR_ON_UNDEFINED_SYMBOLS=0 -s INITIAL_MEMORY=128MB -s ALLOW_MEMORY_GROWTH=1 \
-s FS_DEBUG=0

CPPFLAGS = $(EM_CFLAGS) $(EM_CXXFLAGS) $(EM_SFLAGS)
LDFLAGS = $(EM_LDFLAGS)

#EXCEPTION_CATCHING_WHITELIST = '["__Z5fevalNSt3__212basic_stringIcNS_11char_traitsIcEENS_9allocatorIcEEEEN10emscripten3valEi", "_main"]'
#-s EXCEPTION_CATCHING_WHITELIST=$(EXCEPTION_CATCHING_WHITELIST) \

all: web/octave.js worker/octave.js node/octave.js

#*.o: *.cc
#	em++ -s EXPORT_ALL=1 $(EM_SFLAGS) $(EM_CXXFLAGS) $(EM_CFLAGS) -o $@ $<


octave.o:
#	em++ $(EM_CXXFLAGS) $(EM_CFLAGS) -c main.cc -o $@
	em++ $(EM_CXXFLAGS) $(EM_CFLAGS) -enable-emscripten-cxx-exceptions -c main.cc -o $@

web/octave.js: octave.o
	mkdir -p web
	em++ --bind $(EM_SFLAGS) -s EXPORTED_FUNCTIONS='["_main"]' -s EXPORTED_RUNTIME_METHODS='["FS","MEMFS"]' \
	-s DEMANGLE_SUPPORT=0 \
	--preload-file $(MFILE_PATH)/help@/usr/src/octave/m/help \
	--preload-file $(MFILE_PATH)/general@/usr/src/octave/m/general \
	--preload-file $(MFILE_PATH)/set@/usr/src/octave/m/set \
	--preload-file $(MFILE_PATH)/miscellaneous@/usr/src/octave/m/miscellaneous \
	--preload-file $(MFILE_PATH)/strings@/usr/src/octave/m/strings \
	--preload-file $(MFILE_PATH)/sparse@/usr/src/octave/m/sparse \
	--preload-file $(MFILE_PATH)/statistics@/usr/src/octave/m/statistics \
	--preload-file $(MFILE_PATH)/elfun@/usr/src/octave/m/elfun \
	--preload-file $(MFILE_PATH)/path@/usr/src/octave/m/path \
	--preload-file $(MFILE_PATH)/io@/usr/src/octave/m/io \
	--preload-file $(MFILE_PATH)/polynomial@/usr/src/octave/m/polynomial \
	--preload-file $(MFILE_PATH)/pkg@/usr/src/octave/m/pkg \
	--preload-file $(MFILE_PATH)/time@/usr/src/octave/m/time \
	--preload-file $(MFILE_PATH)/specfun@/usr/src/octave/m/specfun \
	--preload-file $(MFILE_PATH)/linear-algebra@/usr/src/octave/m/linear-algebra \
	--preload-file $(MFILE_PATH)/legacy@/usr/src/octave/m/legacy \
	--preload-file $(MFILE_PATH)/audio@/usr/src/octave/m/audio \
	--preload-file $(MFILE_PATH)/deprecated@/usr/src/octave/m/deprecated \
	--preload-file $(MFILE_PATH)/geometry@/usr/src/octave/m/geometry \
	--preload-file $(MFILE_PATH)/gui@/usr/src/octave/m/gui \
	--preload-file $(MFILE_PATH)/image@/usr/src/octave/m/image \
	--preload-file $(MFILE_PATH)/java@/usr/src/octave/m/java \
	--preload-file $(MFILE_PATH)/ode@/usr/src/octave/m/ode \
	--preload-file $(MFILE_PATH)/optimization@/usr/src/octave/m/optimization \
	--preload-file $(MFILE_PATH)/plot@/usr/src/octave/m/plot \
	--preload-file $(MFILE_PATH)/prefs@/usr/src/octave/m/prefs \
	--preload-file $(MFILE_PATH)/profiler@/usr/src/octave/m/profiler \
	--preload-file $(MFILE_PATH)/signal@/usr/src/octave/m/signal \
	--preload-file $(MFILE_PATH)/special-matrix@/usr/src/octave/m/special-matrix \
	--preload-file $(MFILE_PATH)/startup@/usr/src/octave/m/startup \
	--preload-file $(MFILE_PATH)/testfun@/usr/src/octave/m/testfun \
	--preload-file $(MFILE_PATH)/web@/usr/src/octave/m/web \
	--preload-file $(MFILE_PATH)/+containers@/usr/src/octave/m/+containers \
	--preload-file $(MFILE_PATH)/+matlab@/usr/src/octave/m/+matlab \
	--preload-file forge@/usr/src/octave/m/forge \
	--preload-file plotbridge@/usr/src/octave/m/plotbridge \
	--preload-file $(MFILE_PATH)/../etc/macros.texi@/usr/src/octave-wasm/target/share/octave/7.2.0/etc/macros.texi \
	-s MODULARIZE=1 -s EXPORT_NAME=OCTAVE -s ENVIRONMENT="web" \
	-s EXPORT_ES6=0 --post-js post.js \
	$(EM_CFLAGS) $(EM_LDFLAGS) -o $@ $^

worker/octave.js: octave.o
	mkdir -p worker
	em++ --bind $(EM_SFLAGS) -s EXPORTED_FUNCTIONS='["_main"]' -s EXPORTED_RUNTIME_METHODS='["FS","MEMFS"]' \
	-s DEMANGLE_SUPPORT=0 \
	--embed-file $(MFILE_PATH)/help@/usr/src/octave/m/help \
	--embed-file $(MFILE_PATH)/general@/usr/src/octave/m/general \
	--embed-file $(MFILE_PATH)/set@/usr/src/octave/m/set \
	--embed-file $(MFILE_PATH)/miscellaneous@/usr/src/octave/m/miscellaneous \
	--embed-file $(MFILE_PATH)/strings@/usr/src/octave/m/strings \
	--embed-file $(MFILE_PATH)/sparse@/usr/src/octave/m/sparse \
	--embed-file $(MFILE_PATH)/statistics@/usr/src/octave/m/statistics \
	--embed-file $(MFILE_PATH)/elfun@/usr/src/octave/m/elfun \
	--embed-file $(MFILE_PATH)/path@/usr/src/octave/m/path \
	--embed-file $(MFILE_PATH)/io@/usr/src/octave/m/io \
	--embed-file $(MFILE_PATH)/polynomial@/usr/src/octave/m/polynomial \
	--embed-file $(MFILE_PATH)/pkg@/usr/src/octave/m/pkg \
	--embed-file $(MFILE_PATH)/time@/usr/src/octave/m/time \
	--embed-file $(MFILE_PATH)/specfun@/usr/src/octave/m/specfun \
	--embed-file $(MFILE_PATH)/linear-algebra@/usr/src/octave/m/linear-algebra \
	--embed-file $(MFILE_PATH)/legacy@/usr/src/octave/m/legacy \
	-s MODULARIZE=1 -s EXPORT_NAME=OCTAVE -s ENVIRONMENT="worker" \
	-s EXPORT_ES6=1 -s SINGLE_FILE=1 \
	--post-js post.js \
	$(EM_CFLAGS) $(EM_LDFLAGS) -o $@ $^

node/octave.js: octave.o
	mkdir -p node
	em++ --bind $(EM_SFLAGS) -s EXPORTED_FUNCTIONS='["_main"]' \
	-s DEMANGLE_SUPPORT=0 \
	--embed-file $(MFILE_PATH)/help@/usr/src/octave/m/help \
	--embed-file $(MFILE_PATH)/general@/usr/src/octave/m/general \
	--embed-file $(MFILE_PATH)/set@/usr/src/octave/m/set \
	--embed-file $(MFILE_PATH)/miscellaneous@/usr/src/octave/m/miscellaneous \
	--embed-file $(MFILE_PATH)/strings@/usr/src/octave/m/strings \
	--embed-file $(MFILE_PATH)/sparse@/usr/src/octave/m/sparse \
	--embed-file $(MFILE_PATH)/statistics@/usr/src/octave/m/statistics \
	--embed-file $(MFILE_PATH)/elfun@/usr/src/octave/m/elfun \
	--embed-file $(MFILE_PATH)/path@/usr/src/octave/m/path \
	--embed-file $(MFILE_PATH)/io@/usr/src/octave/m/io \
	--embed-file $(MFILE_PATH)/polynomial@/usr/src/octave/m/polynomial \
	--embed-file $(MFILE_PATH)/pkg@/usr/src/octave/m/pkg \
	--embed-file $(MFILE_PATH)/time@/usr/src/octave/m/time \
	--embed-file $(MFILE_PATH)/specfun@/usr/src/octave/m/specfun \
	--embed-file $(MFILE_PATH)/linear-algebra@/usr/src/octave/m/linear-algebra \
	--embed-file $(MFILE_PATH)/legacy@/usr/src/octave/m/legacy \
	-s MODULARIZE=1 -s EXPORT_NAME=OCTAVE -s ENVIRONMENT="node" \
	-s EXPORT_ES6=0 --post-js post.js \
	$(EM_CFLAGS) $(EM_LDFLAGS) -o $@ $^

clean:
	rm -f octave.o worker/octave.js node/octave.js build.log
