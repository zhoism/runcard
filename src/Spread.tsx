import type { IndexEntry, Owners } from "./lib/types";

const fmt = (n: number) => n.toFixed(2);
const PALETTE = [{ fill: "var(--navy)", word: "navy" }, { fill: "var(--warn)", word: "amber" }, { fill: "var(--pass)", word: "green" }];

/** The spread as an object: one dot per run on the ΔG axis, the band is mean ± run-to-run SD, the ring marks the run
    the page starts from. Every dot is an index entry (a number read from that run's mmgbsa.dat); mean and SD are the
    cohort's, computed from the same entries. Nothing is drawn that is not one of those numbers. */
export function Spread({ runs, mean, sd, own, ringId, ringWhy }: { runs: IndexEntry[]; mean: number | null; sd: number | null; own?: Owners | null; ringId?: string | null; ringWhy?: string }) {
  const xs = runs.filter(r => r.delta_g != null);
  if (xs.length < 2 || mean == null) return null;
  const vals = xs.map(r => r.delta_g as number);
  const min = Math.min(...vals), max = Math.max(...vals);
  const pad = Math.max((max - min) * 0.12, 0.05); const lo = min - pad, hi = max + pad;
  const X = (v: number) => 3 + ((v - lo) / (hi - lo)) * 94; // percent of the drawing width
  // Owners in order of how many runs they have here, so the majority owner takes the first colour.
  const count = (o: string) => xs.filter(r => (r.owner ?? "") === o).length;
  const owners = [...new Set(xs.map(r => r.owner ?? ""))].sort((a, b) => count(b) - count(a));
  const swatch = (o: string) => PALETTE[owners.indexOf(o)] ?? { fill: "var(--muted)", word: "grey" };
  const nameOf = (o: string) => own?.profiles[o]?.name ?? o;
  // Lanes: sorted by ΔG, a dot drops a lane when it would touch the previous dot in its lane.
  const sorted = [...xs].sort((a, b) => (a.delta_g as number) - (b.delta_g as number));
  const laneX: number[] = []; const lane = new Map<string, number>();
  for (const r of sorted) { const x = X(r.delta_g as number); let l = 0; while (l < laneX.length && x - laneX[l] < 3.6) l++; laneX[l] = x; lane.set(r.id, l); }
  const lanes = laneX.length; const top = 14, step = 17, axis = top + lanes * step + 4, H = axis + 22;
  const cy = (l: number) => top + l * step;
  const ring = ringId && xs.some(r => r.id === ringId) ? ringId : null;
  return <figure className="spread" style={{ minWidth: 0, overflow: 'hidden' }}>
    <svg width="100%" height={H} role="img" aria-label={`ΔG of ${xs.length} runs: ${fmt(min)} to ${fmt(max)} kcal/mol, mean ${fmt(mean)}`}>
      {sd != null && <rect x={`${X(mean - sd)}%`} y={2} width={`${X(mean + sd) - X(mean - sd)}%`} height={axis - 2} rx={5} fill="var(--navy)" opacity={0.08} />}
      <line x1={`${X(mean)}%`} x2={`${X(mean)}%`} y1={2} y2={axis} stroke="var(--navy)" strokeWidth={1.5} strokeDasharray="3 3" />
      <line x1="3%" x2="97%" y1={axis} y2={axis} stroke="var(--line)" strokeWidth={1.5} />
      {sorted.map(r => { const dg = r.delta_g as number; const isRing = r.id === ring; return <a key={r.id} href={`#/run/${r.id}`}>
        <title>{`${r.id} · ${fmt(dg)} kcal/mol · ${r.production_ps} ps · ${r.engine}${r.owner ? ` · ${nameOf(r.owner)}` : ""}`}</title>
        {isRing && <circle cx={`${X(dg)}%`} cy={cy(lane.get(r.id) as number)} r={10.5} fill="none" stroke="var(--navy)" strokeWidth={1.5} />}
        <circle cx={`${X(dg)}%`} cy={cy(lane.get(r.id) as number)} r={6} fill={swatch(r.owner ?? "").fill} stroke="#fff" strokeWidth={1.5} />
      </a>; })}
      <text x="3%" y={H - 4}>{fmt(min)}</text>
      <text x="97%" y={H - 4} textAnchor="end">{fmt(max)}</text>
    </svg>
    <figcaption>One dot per run, ΔG in kcal/mol: {owners.map((o, i) => <span key={o}>{i ? " · " : ""}<span className="sw" style={{ background: swatch(o).fill }} aria-hidden="true" />{nameOf(o)}</span>)}{sd != null ? " · dashed line: mean · band: ± run-to-run SD" : " · dashed line: mean"}{ring ? <> · ring: <span className="mono">{ring}</span>{ringWhy ? `, ${ringWhy}` : ""}</> : null}</figcaption>
  </figure>;
}
