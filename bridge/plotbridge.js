// Octave plot-bridge spec -> gnuplot 6 script. Own code, repo license.
// Spec schema written by __pb_emit__.m. Dependency-free (testable in Node).

// Marker table for the gnuplot svg terminal, locked by visual showcase
// (pt 0-15, user-verified 2026-09-20):
// 0 dot, 1 +, 2 x, 3 *, 4 empty square, 5 filled square,
// 6 empty circle, 7 filled circle, 8 empty up-triangle, 9 filled up-triangle,
// 10 empty down-triangle, 11 filled down-triangle,
// 12 empty diamond, 13 filled diamond, 14 empty pentagon, 15 filled pentagon.
// svg terminal has no left/right triangles or hexagon:
// '>'/'<' fall back to up/down triangles, 'h' to filled pentagon.
export const MARKERS = {
  '+': 1, x: 2, '*': 3, s: 4, d: 12, o: 6, '.': 0,
  '^': 8, v: 10, '>': 8, '<': 10, p: 14, h: 15,
};

const LEGLOC = {
  north: 'top center', south: 'bottom center',
  east: 'right center', west: 'left center',
  northeast: 'top right', northwest: 'top left',
  southeast: 'bottom right', southwest: 'bottom left',
  northoutside: 'outside top center', southoutside: 'outside bottom center',
  eastoutside: 'outside right center', westoutside: 'outside left center',
  northeastoutside: 'outside top right', northwestoutside: 'outside top left',
  southeastoutside: 'outside bottom right', southwestoutside: 'outside bottom left',
};

const esc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const ptOf = (m) => MARKERS[m] ?? 6;

export function specToScript(spec) {
  const L = [];
  if (spec.title) L.push(`set title "${esc(spec.title)}"`);
  if (spec.xlabel) L.push(`set xlabel "${esc(spec.xlabel)}"`);
  if (spec.ylabel) L.push(`set ylabel "${esc(spec.ylabel)}"`);
  if (spec.xlim?.length === 2) L.push(`set xrange [${spec.xlim[0]}:${spec.xlim[1]}]`);
  if (spec.ylim?.length === 2) L.push(`set yrange [${spec.ylim[0]}:${spec.ylim[1]}]`);
  L.push(spec.grid ? 'set grid' : 'unset grid');
  if (spec.logx) L.push('set logscale x');
  if (spec.logy) L.push('set logscale y');

  const titles = spec.legend ?? [];
  if (titles.length || spec.legloc) {
    const loc = LEGLOC[String(spec.legloc ?? '').toLowerCase().replace(/\s+/g, '')];
    L.push(loc ? `set key ${loc}` : 'set key');
  } else {
    L.push('unset key');
  }

  const clauses = [];
  for (let i = 0; i < spec.series.length; i++) {
    const sr = spec.series[i];
    const t = titles[i] ?? sr.title ?? '';
    const title = t ? `title "${esc(t)}"` : 'notitle';
    const lc = `lc rgb "${sr.color ?? '#0072BD'}"`;
    const dt = sr.dt ? `dt ${sr.dt}` : '';
    const base = `"${sr.file}" using 1:2`;
    if (sr.style === 'lines') {
      clauses.push(`${base} with lines ${dt} ${lc} ${title}`.replace(/\s+/g, ' ').trim());
    } else if (sr.style === 'linespoints') {
      clauses.push(`${base} with linespoints ${dt} pt ${ptOf(sr.marker)} ps 1.2 ${lc} ${title}`.replace(/\s+/g, ' ').trim());
    } else if (sr.style === 'points') {
      clauses.push(`${base} with points pt ${ptOf(sr.marker)} ps 1.2 ${lc} ${title}`.replace(/\s+/g, ' ').trim());
    } else if (sr.style === 'stem') {
      const ptitle = t ? `title "${esc(t)}"` : 'notitle';
      clauses.push(`${base} with impulses ${lc} notitle`);
      clauses.push(`${base} with points pt ${ptOf(sr.marker === 'none' ? 'o' : sr.marker)} ps 1.0 ${lc} ${ptitle}`);
    } else if (sr.style === 'boxes') {
      clauses.push(`${base} with boxes fillstyle solid 0.5 ${lc} ${title}`);
    } else if (sr.style === 'hboxes') {
      // barh: Octave stored (category, length); the box runs along x, so swap
      // the columns and use the boxxyerrorbars style that spans a rectangle.
      clauses.push(`"${sr.file}" using 2:1:($2-$2):(1.4/2.0) with boxxyerrorbars fillstyle solid 0.5 ${lc} ${title}`.replace(/\s+/g, ' ').trim());
    } else if (sr.style === 'area') {
      // closed polygon (Octave emitted top edge then baseline back)
      clauses.push(`${base} with filledcurves closed fs solid 0.45 ${lc} ${title}`.replace(/\s+/g, ' ').trim());
    } else if (sr.style === 'ebars') {
      // triples (x,ylo) (x,y) (x,yhi) — one bar per triple, no legend entry
      clauses.push(`${base} with yerrorbars pt 0 ps 0 ${lc} notitle`.replace(/\s+/g, ' ').trim());
    } else if (sr.style === 'mesh') {
      // already projected to 2D by Octave; draw the cell outline
      clauses.push(`${base} with lines ${lc} notitle`.replace(/\s+/g, ' ').trim());
    } else if (sr.style === 'surf') {
      // projected 2D quad, filled; painter order comes from the series order
      clauses.push(`${base} with filledcurves closed fs solid 0.30 ${lc} notitle`.replace(/\s+/g, ' ').trim());
    }
  }

  // subplot panels: gnuplot's multiplot needs explicit size/origin per panel,
  // which the flat spec does not carry, so panels are rendered as separate
  // invocations by the page (see specToRender).
  L.push('plot ' + (clauses.length ? clauses.join(', \\\n     ') : 'NaN notitle'));
  return L.join('\n');
}

// Panels → one {script, data} per panel, for pages that want a multiplot grid.
export function specToPanelRenders(spec, readFile) {
  if (!spec.panels || spec.panels.length < 2) return [specToRender(spec, readFile)];
  return spec.panels.map((p) => specToRender(p, readFile));
}

// readFile: (octaveFsPath) -> text. data files live in octave's MEMFS.
export function specToRender(spec, readFile) {
  const data = {};
  for (const sr of spec.series) data[sr.file] = readFile('/tmp/' + sr.file);
  return { script: specToScript(spec), data };
}

// Marker showcase scripts (visual only).
export function markerShowcaseScript() {
  const blocks = [];
  for (let pt = 0; pt <= 15; pt++) blocks.push(`"pts.dat" using 1:${pt + 2} with points pt ${pt} ps 2.0 title "pt ${pt}"`);
  let dat = '';
  for (let x = 0; x < 5; x++) {
    const row = [x];
    for (let pt = 0; pt <= 15; pt++) row.push(x + pt * 10);
    dat += row.join(' ') + '\n';
  }
  const L2 = ['set title "pointtype showcase (svg terminal), y offset = pt*10"'];
  L2.push('plot ' + blocks.join(', '));
  const dts = ['-', '--', ':', '-.'].map((s, i) =>
    `"pts2.dat" using 1:${i + 2} with lines dt ${i + 1} lw 2 title "dt ${i + 1} (${s})"`);
  let dat2 = '';
  for (let x = 0; x <= 20; x++) dat2 += [x, x, x + 22, x + 44, x + 66].join(' ') + '\n';
  const L3 = ['set title "dashtype showcase"'];
  L3.push('plot ' + dts.join(', '));
  return [
    { script: L2.join('\n'), data: { 'pts.dat': dat } },
    { script: L3.join('\n'), data: { 'pts2.dat': dat2 } },
  ];
}
