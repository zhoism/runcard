import { useLayoutEffect, useRef, useState } from "react";
import type { IndexEntry, Owners } from "./lib/types";

const fmt = (n: number) => n.toFixed(2);
const PALETTE = [{ fill: "var(--navy)", word: "navy" }, { fill: "var(--warn)", word: "amber" }, { fill: "var(--pass)", word: "green" }];

/** The spread as an object: one dot per run on the ΔG axis, the band is mean ± SD across these runs, a dispersion, the ring marks the run
    the page starts from. Every dot is an index entry (a number read from that run's mmgbsa.dat); mean and SD are the
    cohort's, computed from the same entries. Nothing is drawn that is not one of those numbers. */
export function Spread({ runs, mean, sd, own, ringId, ringWhy }: { runs: IndexEntry[]; mean: number | null; sd: number | null; own?: Owners | null; ringId?: string | null; ringWhy?: string }) {
  // The drawn width decides how close two dots may sit: measured, so a phone gets more lanes rather than overlapping dots.
  const ref = useRef<SVGSVGElement>(null); const [width, setWidth] = useState(600);
  // Hover or focus names one run: its dot grows, the others fade, a label sits above it. Nothing here is a new number.
  const [hover, setHover] = useState<string | null>(null);
  useLayoutEffect(() => { const el = ref.current; if (!el) return; const read = () => setWidth(el.clientWidth || 600); read(); const ro = new ResizeObserver(read); ro.observe(el); return () => ro.disconnect(); }, []);
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
  const gap = Math.max(3.6, (16 / width) * 100); // ≥ 16 px between dot centres in any lane
  for (const r of sorted) { const x = X(r.delta_g as number); let l = 0; while (l < laneX.length && x - laneX[l] < gap) l++; laneX[l] = x; lane.set(r.id, l); }
  const lanes = laneX.length; const top = 14, step = 17, axis = top + lanes * step + 4, H = axis + 22;
  const cy = (l: number) => top + l * step;
  const ring = ringId && xs.some(r => r.id === ringId) ? ringId : null;
  const hov = hover ? sorted.find(r => r.id === hover) : null;
  const hx = hov ? X(hov.delta_g as number) : 0;
  return <figure className={`spread ${hover ? "hovering" : ""}`}>
    {hov && <div className={`spread-tip ${hx < 18 ? "left" : hx > 82 ? "right" : ""}`} style={{ left: `${hx}%`, top: cy(lane.get(hov.id) as number) - 12 }} role="presentation">
      <b className="mono">{hov.id}</b> <span>{fmt(hov.delta_g as number)} kcal/mol</span>
      <div className="dim">{hov.production_ps} ps · {hov.engine}{hov.owner ? ` · ${nameOf(hov.owner)}` : ""}{hov.id === ring ? ` · ${ringWhy ?? "start here"}` : ""}</div>
    </div>}
    <svg ref={ref} width="100%" height={H} role="group" aria-label={`ΔG of ${xs.length} runs: ${fmt(min)} to ${fmt(max)} kcal/mol, mean ${fmt(mean)}`}>
      {sd != null && <rect x={`${X(mean - sd)}%`} y={2} width={`${X(mean + sd) - X(mean - sd)}%`} height={axis - 2} rx={5} fill="var(--navy)" opacity={0.08} />}
      <line x1={`${X(mean)}%`} x2={`${X(mean)}%`} y1={2} y2={axis} stroke="var(--navy)" strokeWidth={1.5} strokeDasharray="3 3" />
      <line x1="3%" x2="97%" y1={axis} y2={axis} stroke="var(--line)" strokeWidth={1.5} />
      {sorted.map(r => { const dg = r.delta_g as number; const isRing = r.id === ring; return <a key={r.id} href={`#/run/${r.id}`} className={hover === r.id ? "on" : undefined} aria-label={`${r.id} · ${fmt(dg)} kcal/mol · ${r.production_ps} ps · ${r.engine}${r.owner ? ` · ${nameOf(r.owner)}` : ""}`}
        onMouseEnter={() => setHover(r.id)} onMouseLeave={() => setHover(h => h === r.id ? null : h)} onFocus={() => setHover(r.id)} onBlur={() => setHover(h => h === r.id ? null : h)}>
        <circle cx={`${X(dg)}%`} cy={cy(lane.get(r.id) as number)} r={12} fill="transparent" />
        {isRing && <circle cx={`${X(dg)}%`} cy={cy(lane.get(r.id) as number)} r={10.5} fill="none" stroke="var(--navy)" strokeWidth={1.5} />}
        <circle className="dot" cx={`${X(dg)}%`} cy={cy(lane.get(r.id) as number)} r={6} fill={swatch(r.owner ?? "").fill} stroke="#fff" strokeWidth={1.5} />
      </a>; })}
      <text x={`${X(min)}%`} y={H - 4} textAnchor="middle">{fmt(min)}</text>
      <text x={`${X(max)}%`} y={H - 4} textAnchor="middle">{fmt(max)}</text>
    </svg>
    <figcaption>One dot per run, ΔG in kcal/mol: {owners.map((o, i) => <span key={o}>{i ? " · " : ""}<span className="sw" style={{ background: swatch(o).fill }} aria-hidden="true" />{nameOf(o)}</span>)}{sd != null ? " · dashed line: mean · band: mean ± SD across these runs, a dispersion" : " · dashed line: mean"}{ring ? <> · ring: <span className="mono">{ring}</span>{ringWhy ? `, ${ringWhy}` : ""}</> : null}</figcaption>
  </figure>;
}
