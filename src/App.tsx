import { useEffect, useRef, useState } from "react";
import type { Manifest, IndexEntry } from "./lib/types";
import { loadIndex, loadRun, validateStage, ensemble, diffRuns, zipBundle, uncertaintyFromFrames, verdictOf, confidenceLadderFull, internalResidual } from "./lib/runs";
import { runningMean } from "./lib/stats";
import type { Report } from "./lib/amberCheck";
import { useStore, navigate, setProposalStatus, set } from "./store";
import { TOOLS, callTool } from "./webmcp";
import { Viewer, Boundary } from "./Viewer";

/** "run_id=1l2y-regression stage=product" — the call's arguments, readable at a glance. */
const fmtArgs = (input: unknown) => input && typeof input === "object" && !Array.isArray(input) ? Object.entries(input as Record<string, unknown>).map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`).join(" ") : input == null ? "" : JSON.stringify(input);
const show = (v: unknown) => Array.isArray(v) ? v.join(" ") : v == null ? "—" : String(v);
const fmt = (n: number | null | undefined, d = 2) => n == null ? "—" : n.toFixed(d);
/** PASS is deliberately uncoloured: the validator is a sanity check of the input file, not evidence of physical validity. WARN/FAIL are coloured because they need attention. */
const Verdict = ({ r }: { r: Report }) => { const v = verdictOf(r); return <span className={`badge ${v === "PASS" ? "" : v.toLowerCase()}`}>{v}</span>; };
/** Visually hidden, read by screen readers. Inline so it survives a stylesheet swap. */
const srOnly = { position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" } as const;

export default function App() {
  const route = useStore(s => s.route);
  const [idx, setIdx] = useState<IndexEntry[]>([]);
  const [idxErr, setIdxErr] = useState<string | null>(null);
  useEffect(() => { loadIndex().then(setIdx, e => setIdxErr(String(e?.message ?? e))); }, []);
  const parts = route.split("/").filter(Boolean);
  return (
    <div className="app">
      <Header />
      <main>
        {idxErr && <div className="interp warn" role="alert">{idxErr} — reload the page to try again.</div>}
        <Boundary label="Page">{parts[0] === "run" && parts[1] ? <RunPage key={parts[1]} id={parts[1]} idx={idx} /> :
         parts[0] === "compare" && parts[2] ? <ComparePage a={parts[1]} b={parts[2]} idx={idx} /> :
         <Home idx={idx} />}</Boundary>
      </main>
      <Sidebar />
    </div>
  );
}

function Header() {
  const st = useStore(s => s.webmcp);
  return (
    <header>
      <a href="#/" className="brand">runcard</a>
      <span className="tag">validated simulation records</span>
      {st === "registered" ? <span className="webmcp registered" title="Tools registered with navigator.modelContext">WebMCP: registered · {TOOLS.length} tools</span>
       : st === "error" ? <span className="webmcp error" title="registerTool threw; see console">WebMCP: registration failed</span>
       : <a className="webmcp" href="#tool-console" onClick={e => { e.preventDefault(); document.getElementById("tool-console")?.scrollIntoView({ behavior: "smooth", block: "start" }); }} title="This browser does not expose WebMCP. Chrome: chrome://flags/#enable-webmcp-testing. The Tool Console calls the same tools by hand.">no WebMCP here — use the Tool Console ↓</a>}
    </header>
  );
}

function Home({ idx }: { idx: IndexEntry[] }) {
  useEffect(() => { document.title = "runcard"; }, []);
  return (
    <section>
      <h1>Simulation runs</h1>
      <p className="lede">Each row is a molecular-dynamics run rendered from its artifacts: stages, parameters, seeds, results, environment. Open one and ask your agent about it — the page registers WebMCP tools (<code>navigator.modelContext</code>) to validate stages, compare runs, explain uncertainty, and build a rerun bundle.</p>
      <div className="tablewrap"><table className="runs">
        <thead><tr><th>run</th><th>ligand</th><th>protein atoms</th><th>production</th><th>ΔG MM-GBSA <span className="dim">kcal/mol</span></th><th>PLIP</th></tr></thead>
        <tbody>{idx.map(r => <tr key={r.id} onClick={() => navigate(`/run/${r.id}`)}><td><a href={`#/run/${r.id}`}>{r.title}</a><div className="dim">{r.id}</div></td><td>{r.ligand}</td><td>{r.protein_atoms}</td><td>{r.production_ps} ps</td><td className="num">{fmt(r.delta_g)}</td><td>{r.plip ? "✓" : ""}</td></tr>)}</tbody>
      </table></div>
    </section>
  );
}

/** Settled load failure: the message names the run and the cause; the reader can go back or retry (the loader evicts failed loads, so retry refetches). */
function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <section>
    <div className="interp warn" role="alert">{message}</div>
    <p><a href="#/">← back to the run list</a> <button className="ghost" onClick={onRetry}>retry</button></p>
  </section>;
}
function RunPage({ id, idx }: { id: string; idx: IndexEntry[] }) {
  const [m, setM] = useState<Manifest | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const re = useStore(s => s.reanalysis);
  useEffect(() => {
    let live = true; setM(null); setErr(null);
    loadRun(id).then(x => { if (live) setM(x); }, e => { if (live) setErr(String(e?.message ?? e)); });
    return () => { live = false; };
  }, [id, attempt]);
  useEffect(() => { document.title = m ? `${m.title} · runcard` : "runcard"; }, [m]);
  if (err) return <LoadError message={err} onRetry={() => setAttempt(a => a + 1)} />;
  if (!m) return <p className="dim" role="status">loading {id}…</p>;
  const ens = idx.length ? ensemble(idx, id) : null;
  const mm = m.results.mmgbsa; const prod = m.stages.find(s => s.role === "production");
  const reports = Object.fromEntries(m.stages.map(s => [s.name, validateStage(m, s.name)]));
  const overall = verdictOf({ hasFail: Object.values(reports).some(r => r.hasFail), hasWarn: Object.values(reports).some(r => r.hasWarn) });
  const others = idx.filter(r => r.id !== id);
  const netCharge = m.system.ligand.net_charge;
  const u = mm?.per_frame ? uncertaintyFromFrames(mm.per_frame, prod?.length_ps ?? null) : null;
  const resid = mm?.per_frame ? internalResidual(mm.per_frame, mm.delta_total_kcal_mol) : null;
  const spreadSd = ens && ens.all.n > 1 ? ens.all.sd : null;
  return (
    <section className="run">
      <div className="titlebar"><h1>{m.title}</h1><span className="dim">{m.id}</span>
        <select value="" aria-label="compare this run with" onChange={e => e.target.value && navigate(`/compare/${id}/${e.target.value}`)}><option value="">compare with…</option>{others.map(r => <option key={r.id} value={r.id}>{r.title}</option>)}</select></div>

      <div className={m.results.plip ? "grid2" : ""}>
        <div className="card">
          <h2>Binding free energy <span className="dim">MM-GBSA, single trajectory{mm?.params?.entropy === "0" ? ", no entropy term" : ""}</span></h2>
          {mm ? <>
            {/* Headline: this run's ΔG with the uncertainty the page argues for (run-to-run SD), then the rows in order of what matters; the mechanics are one disclosure away. */}
            <div className="big">{fmt(mm.delta_total_kcal_mol)}{spreadSd != null && <> ± {fmt(spreadSd)}</>} <span className="unit">kcal/mol</span>{u && u.verdict !== "no drift detected" && <> <span className="badge warn" title="halves test within the archived window">{u.verdict}</span></>}</div>
            <p className="dim small">{spreadSd != null
              ? <>± is the run-to-run SD over n={ens!.all.n} independent runs at {[...new Set(ens!.all.runs.map(r => r.production_ps))].sort((x, y) => x - y).join(", ")} ps — the uncertainty to quote; the within-run SEM is not.</>
              : u ? <>single run of this system: the within-run corrected SEM below does not estimate run-to-run uncertainty — no spread can be quoted until three independent runs exist.</> : null}</p>
            <dl>
              {ens && ens.all.n > 1 && <><dt>run-to-run</dt><dd><b>n={ens.all.n}</b>: mean {fmt(ens.all.mean)}, SD {fmt(ens.all.sd)}, range {fmt(ens.all.min)} … {fmt(ens.all.max)}
                {ens.long.n > 0 && ens.long.n < ens.all.n && <><br /><b>n={ens.long.n}</b> runs ≥ {ens.long.min_ps} ps: mean {fmt(ens.long.mean)}, SD {fmt(ens.long.sd)}, range {fmt(ens.long.min)} … {fmt(ens.long.max)}</>}
                <span className="dim"> — seed-to-seed variation over 2–30 ps from one prepared start; production lengths differ across runs</span></dd></>}
              {u && <><dt>within run</dt><dd>corrected SEM <b>{fmt(u.corrected_sem, 3)}</b> (g = {u.statistical_inefficiency_g}, N<sub>eff</sub> ≈ {u.n_eff}) · halves {fmt(u.halves.first)} → {fmt(u.halves.second)} · <b>{u.verdict}</b> <span className="dim">(halves test over {prod?.length_ps ?? "?"} ps)</span></dd></>}
              {re && re.run === m.id && <><dt>agent reanalysis</dt><dd>frames {re.start_frame}–{re.end_frame}{re.interval > 1 ? ` every ${re.interval}th` : ""} ({re.frames_used} frames{re.start_ps != null ? `, ${re.start_ps}–${re.end_ps} ps` : ""}) → <b>{fmt(re.mean)} ± {fmt(re.corrected_sem)}</b>, {re.verdict} <span className="dim">(recomputed in the browser from the archived per-frame energies; ± is the corrected SEM; the archived value above is unchanged)</span></dd></>}
              <dt>method</dt><dd>MM-GBSA igb={mm.igb}, saltcon={mm.saltcon} · computed {mm.run_on}</dd></dl>
            {mm.per_frame && <Sparkline x={mm.per_frame.delta_total} lengthPs={prod?.length_ps ?? null} window={re && re.run === m.id ? { start: re.start_frame, end: re.end_frame } : undefined} />}
            <details className="small"><summary className="dim">how these numbers were computed</summary>
              <p className="dim">Per-frame: population SD {fmt(mm.frame_std)}, naive SEM {fmt(mm.frame_sem, 3)} over {mm.frames} frames (every {mm.params?.interval ?? "?"}th of {mm.params?.endframe ?? "?"}); frames are correlated, so the naive SEM understates the within-run uncertainty.{mm.frames_header_text && mm.frames_header_text !== String(mm.frames) ? ` The mmgbsa.dat header prints "${mm.frames_header_text}" — (endframe−startframe)/interval+1 un-floored; the count here is from the per-frame blocks.` : ""}</p>
              {u && <p className="dim">Corrected SEM = SD·√(g/N) with g = 1 + 2Σ(1−t/N)C(t) (τ = {u.integrated_autocorrelation_time_frames} frames); drift verdict: {u.thresholds.drifting_if}; too short if {u.thresholds.too_short_if}. Reconstructed from the per-frame mdout files; the full window reproduces mmgbsa.dat exactly.</p>}
            </details>
            {mm.warnings.map((w, i) => { const quiet = resid != null && resid.fraction_of_delta_g < 1e-3; return <div key={i} className={`warnbox ${quiet ? "quiet" : ""}`}>⚠ {w}
              <div className="dim">Recorded verbatim from mmgbsa.dat.{resid ? ` The internal-term residual it accompanies: ${resid.total.mean} ± ${resid.total.sd} kcal/mol per frame (${(resid.fraction_of_delta_g * 100).toFixed(3)} % of ΔG), from ${resid.dominant_term}; the exact trigger is not recorded, so this is consistent with the warning, not its proven cause${quiet ? " — below 0.1 % of ΔG, shown for the record" : ""}.` : " Ask the agent to explain_result for what it means."}</div></div>; })}
          </> : <p className="dim">no MM-GBSA result</p>}
        </div>
        {m.results.plip && <div className="card">
          <h2>Contacts <span className="dim">PLIP on the medoid frame</span></h2>
          <dl>{Object.entries(m.results.plip.interactions).map(([k, v]) => <div key={k}><dt>{k.replace("_", " ")}</dt><dd>{v.map(x => x.residue).join(", ")}</dd></div>)}</dl>
          <div className="dim small" style={{ marginTop: 6 }}>frame {m.results.plip.frame?.index} of {m.results.plip.frame?.nframes} ({m.results.plip.frame?.policy})</div>
          {m.analyses.plip && <div className="dim small"><a href={`/runs/${m.id}/plip.png`} target="_blank" rel="noopener">PLIP interaction chart (plip.png)</a></div>}
        </div>}
      </div>

      <div className="card">
        <h2>Stages <span className={`badge ${overall === "PASS" ? "" : overall.toLowerCase()}`}>input checks {overall}</span></h2>
        <p className="dim small">11 rules on each .in file (timestep vs SHAKE, cutoff, thermostat, barostat, restarts, seeds, output cadence): a sanity check of the input files, not evidence of convergence or physical accuracy and not a rung of the confidence ladder — select a stage for its input and findings.</p>
        {/* Each stage is a native disclosure button: Tab reaches it, Enter/Space toggle it, aria-expanded carries the state. The arrow is decoration. */}
        <div className="stages">{m.stages.map((s, i) => <div key={s.name} className={`stage ${open === s.name ? "open" : ""}`}>
          {i > 0 && <span className="arrow" aria-hidden="true">→</span>}
          <button type="button" className="stagebox" id={`stage-${s.name}`} aria-expanded={open === s.name} aria-controls={open === s.name ? "stagedetail" : undefined} onClick={() => setOpen(open === s.name ? null : s.name)}>
            <span className="stagename">{s.name}</span><span className="dim">{s.role}{s.length_ps != null ? ` · ${s.length_ps} ps` : ""}</span>
            <span className="dim">{s.cntrl.temp0 ? `${s.cntrl.temp0} K` : ""}{s.role === "minimization" ? "" : s.cntrl.ntp === "1" ? " NPT" : s.cntrl.ntb === "1" ? " NVT" : ""}{s.cntrl.ntr === "1" ? " restrained" : ""}</span>
            {verdictOf(reports[s.name]) !== overall || overall !== "PASS" ? <Verdict r={reports[s.name]} /> : null}</button></div>)}</div>
        {open && (() => { const s = m.stages.find(x => x.name === open)!; const r = reports[open]; return <div className="stagedetail" id="stagedetail" role="region" aria-labelledby={`stage-${open}`}>
          <div><h3>{s.name}.in</h3><pre>{s.mdin}</pre>
            <div className="dim">restarts from {s.restart_from || "initial coordinates"} · {s.role === "minimization" ? `seed ${s.realized_seed ?? "n/a"} (unused by minimization)` : `requested ig=${s.requested_seed ?? "unset (pmemd default -1)"} → realized seed ${s.realized_seed ?? "n/a"}`} · wall {s.wall_s ?? "?"} s · {s.finished ? "finished" : "not finished"}{s.envelope?.crashes?.length ? ` · crashes: ${s.envelope.crashes.join(", ")}` : ""}</div></div>
          <div><h3>Validation</h3><ul className="findings">{r.findings.map((f, i) => <li key={i}><span className={`badge ${f.level.toLowerCase()}`}>{f.level}</span> <b>{f.rule}</b> — {f.detail}</li>)}</ul></div>
        </div>; })()}
      </div>

      <div className="grid2">
        <div className="card">
          <h2>System</h2>
          <dl>
            <dt>protein</dt><dd>{m.system.protein.atoms} atoms</dd>
            <dt>ligand</dt><dd>{m.system.ligand.resname} · {m.system.ligand.atoms} atoms · {m.system.ligand.charge_method} charges · net <span title={netCharge == null ? undefined : `${netCharge} (as written by antechamber)`}>{netCharge == null ? "—" : Math.abs(netCharge) < 1e-3 ? "0" : netCharge.toFixed(2)}</span></dd>
            <dt>atom types</dt><dd className="mono">{m.system.ligand.atom_types?.join(" ")}</dd>
            <dt>solvent</dt><dd>{m.system.solvent.model} {m.system.solvent.box === "oct" ? "truncated octahedron" : m.system.solvent.box}, {m.system.solvent.buffer_A} Å buffer · {m.system.solvent.residues_added?.[0]} waters+ions · {m.system.solvent.solvated_atoms} atoms</dd>
            <dt>force fields</dt><dd className="mono">{m.system.force_fields.join(" · ")}</dd>
            <dt>engine</dt><dd>{prod?.engine} · AmberTools {m.environment.conda_lock.ambertools} · MMPBSA.py {mm?.mmpbsa_version}</dd>
          </dl>
        </div>
        {m.structure && <Boundary label="Structure"><div className="card"><h2>Structure <span className="dim">cluster medoid, dry</span></h2><Viewer url={`/runs/${m.id}/${m.structure}`} ligand={m.system.ligand.resname} /></div></Boundary>}
      </div>

      {idx.length > 0 && (() => { const L = confidenceLadderFull(m, idx); const cls = (s: string) => s === "verified" ? "pass" : s === "not established" ? "warn" : s === "partly established" ? "partly" : ""; return <div className="card">
        <h2>Confidence ladder <span className="dim">{L.verified_of_assessable} assessed rungs verified{L.rungs.some(r => r.status === "partly established") ? ` · ${L.rungs.filter(r => r.status === "partly established").length} partly established` : ""} · 1 not assessed · computed from the archived data</span></h2>
        <ol className="ladder">{L.rungs.map((r, i) => <li key={r.rung} className={r.status === "not assessed" ? "dim" : ""}><span className="dim mono">{i + 1}.</span> <span className={`badge ${cls(r.status)}`}>{r.status}</span> <b>{r.rung}</b> <span className="dim">— {r.short}</span>
          <details className="small"><summary className="dim">evidence</summary><p className="dim">{r.evidence}{r.to_climb ? <> · <i>to climb: {r.to_climb}</i></> : null}</p></details></li>)}</ol>
      </div>; })()}

      <div className="card"><h2>Fork this experiment <span className="dim">Reproduce and replicate change no inputs, so no proposal is needed. Extend changes one variable, so it waits for your approval.</span></h2>
        <dl className="fork">
          <dt>reproduce</dt><dd>rerun the original as exactly as possible: pinned seeds, same build — tests <i>repeatability</i> if executed and compared; it cannot show the result is stable.</dd>
          <div className="act"><button className="ghost" onClick={() => callTool("generate_rerun_bundle", { run_id: m.id, seed: "pinned", target: "local" })}>build pinned bundle</button></div>
          <dt>replicate</dt><dd>same protocol, independent seeds (ig=-1) — {ens && ens.all.n > 1 ? "an executed rerun joins the run-to-run spread above" : "an executed rerun would start the run-to-run spread this card lacks"}.</dd>
          <div className="act"><button className="ghost" onClick={() => callTool("fork_experiment", { run_id: m.id, kind: "replicate" })}>plan a replicate</button></div>
          <dt>extend</dt><dd>change one variable, hold the listed controls: the controlled diff is validated and waits for your approval before a bundle exists.</dd>
          <div className="act"><button className="ghost" onClick={() => { set({ console: { tool: "fork_experiment", input: JSON.stringify({ run_id: m.id, kind: "extend", treatment: { key: "temp0", value: "310.0" }, question: "Does binding weaken at 310 K?" }, null, 1) } }); document.getElementById("tool-console")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>prefill the console with an extension (temp0 → 310 K) →</button></div>
        </dl>
      </div>

      <div className="card"><h2>Analyses <span className="dim">cpptraj</span></h2>
        <div className="gallery">{Object.entries(m.analyses).filter(([k]) => k !== "plip").map(([k, a]) => <figure key={k}><a href={`/runs/${m.id}/${a.png}`} target="_blank" rel="noopener" title={`open ${a.png} full size`}><img src={`/runs/${m.id}/${a.png}`} alt="" loading="lazy" /></a><figcaption>{k}</figcaption></figure>)}</div></div>

      <div className="card"><h2>Provenance</h2>
        <dl><dt>pipeline stages</dt><dd className="mono">{Object.entries(m.pipeline.stage_envelopes).map(([k, ok]) => `${k}:${ok ? "ok" : "FAILED"}`).join("  ")} <span className="dim">({m.pipeline.skills.join(" → ")})</span></dd>
          <dt>environment</dt><dd className="mono">{Object.entries(m.environment.conda_lock).map(([k, v]) => `${k}=${v}`).join("  ")} <a href="/runs/env.lock.yml" target="_blank">full lock</a></dd>
          <dt>seeds</dt><dd className="mono">{m.stages.map(s => `${s.name}:${s.realized_seed ?? "-"}`).join("  ")}</dd>
          <dt>leap.in</dt><dd><pre className="small">{m.system.leap_in}</pre></dd></dl></div>
    </section>
  );
}

/** Per-frame ΔG with running mean. Inline SVG; every point is a number from the manifest. */
function Sparkline({ x, lengthPs, window }: { x: number[]; lengthPs: number | null; window?: { start: number; end: number } }) {
  const W = 480, H = 90, P = 4; const lo = Math.min(...x), hi = Math.max(...x); const rm = runningMean(x);
  const sx = (i: number) => P + (i / (x.length - 1)) * (W - 2 * P), sy = (v: number) => P + (1 - (v - lo) / (hi - lo || 1)) * (H - 2 * P);
  const path = (v: number[]) => v.map((y, i) => `${i ? "L" : "M"}${sx(i).toFixed(1)},${sy(y).toFixed(1)}`).join(" ");
  return <figure className="spark"><svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="per-frame ΔG">
      {window && <rect x={sx(window.start - 1)} y={0} width={Math.max(1, sx(window.end - 1) - sx(window.start - 1))} height={H} fill="var(--acc)" opacity="0.12" />}
      <path d={path(x)} fill="none" stroke="var(--dim)" strokeWidth="1" /><path d={path(rm)} fill="none" stroke="var(--acc)" strokeWidth="1.5" /></svg>
    <figcaption>per-frame ΔG over {x.length} frames{lengthPs != null ? ` (${lengthPs} ps)` : ""}: grey = frame values ({lo.toFixed(1)} … {hi.toFixed(1)} kcal/mol), blue = running mean</figcaption></figure>;
}

function ComparePage({ a, b, idx }: { a: string; b: string; idx: IndexEntry[] }) {
  const [d, setD] = useState<ReturnType<typeof diffRuns> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!idx.length) return;
    let live = true; setD(null); setErr(null);
    Promise.all([loadRun(a), loadRun(b)]).then(([x, y]) => diffRuns(x, y, idx))
      .then(r => { if (live) setD(r); }, e => { if (live) setErr(String(e?.message ?? e)); });
    return () => { live = false; };
  }, [a, b, idx, attempt]);
  useEffect(() => { document.title = `compare ${a} vs ${b} · runcard`; }, [a, b]);
  if (err) return <LoadError message={`compare ${a} vs ${b}: ${err}`} onRetry={() => setAttempt(n => n + 1)} />;
  if (!d) return <p className="dim" role="status">comparing…</p>;
  return <section>
    <div className="titlebar"><h1>Compare <a href={`#/run/${a}`}>{idx.find(r => r.id === a)?.title ?? a}</a> vs <a href={`#/run/${b}`}>{idx.find(r => r.id === b)?.title ?? b}</a></h1><span className="dim">{a} · {b}</span>
      <select value={b} aria-label="compare this run with" onChange={e => e.target.value && navigate(`/compare/${a}/${e.target.value}`)}>{idx.filter(r => r.id !== a).map(r => <option key={r.id} value={r.id}>{r.title}</option>)}</select></div>
    {/* The verdict first, in bold; the reasoning under it; the numbers live once, in the table below. */}
    <div className={`interp ${d.same_system ? "" : "warn"}`}><b>{d.verdict}</b><div className="dim">{d.interpretation}</div></div>
    <div className={d.system.length > 0 ? "grid2" : ""}>
      <div className="card"><h2>ΔG <span className="dim">kcal/mol{d.same_system ? "" : " · listed, not compared"}</span></h2><table><thead><tr><th>run</th><th className="num">ΔG</th></tr></thead><tbody><tr><td>{a}</td><td className="num">{fmt(d.delta_g.a)}</td></tr><tr><td>{b}</td><td className="num">{fmt(d.delta_g.b)}</td></tr>
        {d.run_to_run_spread && <tr><td>run-to-run mean ± SD (n={d.run_to_run_spread.all.n})</td><td className="num">{fmt(d.run_to_run_spread.all.mean)} ± {fmt(d.run_to_run_spread.all.sd)}</td></tr>}
        {d.delta_g.diff != null && <tr><td>ΔΔG ({a} − {b}){d.delta_g_vs_noise ? <span className="dim"> · √2·SD = {fmt(d.delta_g_vs_noise.sd_of_difference)}</span> : null}</td><td className="num">{fmt(d.delta_g.diff)}</td></tr>}</tbody></table>
        <div className="dim mono small">seeds {a}: {d.realized_seeds.a.join(" ")}<br />seeds {b}: {d.realized_seeds.b.join(" ")}</div></div>
      {d.system.length > 0 && <div className="card"><h2>System</h2><table><thead><tr><th>field</th><th>{a}</th><th>{b}</th></tr></thead><tbody>{d.system.map(s => <tr key={s.field}><td>{s.field.replace(/_/g, " ")}</td><td className="mono">{show(s.a)}</td><td className="mono">{show(s.b)}</td></tr>)}</tbody></table></div>}
    </div>
    {d.system.length === 0 && d.stages.length > 0 && <p className="dim small">identical prepared system</p>}
    {d.system.length === 0 && d.stages.length === 0 && <p className="dim small">identical prepared system; stage inputs identical across all {d.stages_compared} stages (every &amp;cntrl key compared, seeds excluded) — only the seeds listed above differ</p>}
    {d.stages.length > 0 && <div className="card"><h2>Stage parameters</h2>{d.stages.map(s => <div key={s.stage}><h3>{s.stage}</h3><table><thead><tr><th>key</th><th>meaning</th><th>{a}</th><th>{b}</th><th>material?</th></tr></thead><tbody>{s.changes.map(c => <tr key={c.key} className={c.material ? "" : "dim"}><td className="mono">{c.key}</td><td>{c.meaning}</td><td className="mono">{c.a}</td><td className="mono">{c.b}</td><td>{c.material ? <span className="badge warn">material · {c.class.replace("_", " ")}</span> : <span className="badge">{d.same_system ? "not material" : "moot across systems"} · {c.class.replace("_", " ")}</span>}</td></tr>)}</tbody></table></div>)}</div>}
    {d.system.length > 0 && d.stages.length === 0 && <p className="dim small">no parameter differences (seeds excluded)</p>}
  </section>;
}

function Sidebar() {
  const proposals = useStore(s => s.proposals); const calls = useStore(s => s.calls); const bundle = useStore(s => s.bundle);
  const route = useStore(s => s.route); const webmcp = useStore(s => s.webmcp); const pre = useStore(s => s.console);
  const [tool, setTool] = useState(TOOLS[0].name); const [input, setInput] = useState("{}"); const [out, setOut] = useState(""); const [touched, setTouched] = useState(false);
  // A page button can hand the console a drafted call (the human edits and presses Call — the console is the only path).
  const callRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (pre) { setTool(pre.tool); setInput(pre.input); setOut(""); setTouched(true); set({ console: null }); setTimeout(() => callRef.current?.focus(), 50); } }, [pre]);
  // Prefill run_id with the run on screen, so "pick explain_result, press Call" works on a run page.
  const currentRun = route.split("/")[2] || "";
  const prefill = (name: string) => { const props: any = (TOOLS.find(x => x.name === name)!.inputSchema as any).properties ?? {}; return JSON.stringify(currentRun && props.run_id ? { run_id: currentRun } : currentRun && props.run_a ? { run_a: currentRun, run_b: "" } : {}); };
  // On a run page the most useful first call is explain_result for that run — until the human picks a tool themselves.
  useEffect(() => { if (currentRun && !touched) { setTool("explain_result"); setInput(JSON.stringify({ run_id: currentRun })); setOut(""); } }, [currentRun, touched]);
  const t = TOOLS.find(x => x.name === tool)!;
  const outIsError = out.startsWith("SyntaxError") || out.startsWith("{\"error\"");
  const download = () => { if (!bundle) return; const z = zipBundle(bundle.files); const url = URL.createObjectURL(new Blob([z as BlobPart], { type: "application/zip" })); const a = document.createElement("a"); a.href = url; a.download = bundle.name; a.click(); URL.revokeObjectURL(url); };
  return <aside>
    <div className="card">
      <h2>Proposals <span className="dim">agent proposes, you approve</span></h2>
      {proposals.length === 0 && <p className="dim">None yet. An agent can call <code>propose_change</code>; nothing is applied until you approve it here.</p>}
      {proposals.map(p => <div key={p.id} className={`proposal ${p.status}`}>
        <div><b>{p.run}</b> / {p.stage} <span className={`badge ${p.status}`}>{p.status}</span>{p.fork && <span className="dim small"> · fork {p.fork.kind}{p.fork.question ? `: ${p.fork.question}` : ""}</span>}</div>
        <div className="mono">{(p.changes ?? []).map(c => `${c.key}: ${c.before ?? "(unset)"} → ${c.after}`).join(" · ") || Object.entries(p.edits).map(([k, v]) => `${k}=${v}`).join(", ")}{p.material_classes?.length ? <> <span className="badge warn">material · {p.material_classes.map(c => c.replace("_", " ")).join(", ")}</span></> : null}</div>
        <div className="dim">{p.reason}</div>
        <div>before <Verdict r={p.before} /> → after <Verdict r={p.after} /></div>
        {p.after.findings.filter(f => f.level !== "PASS").map((f, i) => <div key={i} className="dim small">{f.level}: {f.rule} — {f.detail}</div>)}
        {p.status === "pending" && <div className="row"><button onClick={() => setProposalStatus(p.id, "approved")} disabled={p.after.hasFail}>Approve</button><button className="ghost" onClick={() => setProposalStatus(p.id, "rejected")}>Reject</button>{p.after.hasFail && <span className="dim small" style={{ alignSelf: "center" }}>cannot approve: the edit fails validation</span>}</div>}
      </div>)}
    </div>
    {bundle && <div className="card"><h2>Rerun bundle</h2><pre className="small">{Object.keys(bundle.files).join("\n")}</pre><button onClick={download}>Download {bundle.name}</button> <button className="ghost" onClick={() => set({ bundle: null })}>clear</button></div>}
    <div className="card" id="tool-console">
      <h2>Tool console <span className="dim">the same tools an agent sees · ✎ = changes page state</span></h2>
      {webmcp !== "registered" && <p className="dim small">No agent is connected to this page. In Chrome, enable <code>chrome://flags/#enable-webmcp-testing</code> and reload to let an agent call these tools itself; or call them by hand here.</p>}
      <select value={tool} aria-label="tool" onChange={e => { setTouched(true); setTool(e.target.value); setInput(prefill(e.target.value)); }}>{TOOLS.map(t => <option key={t.name} value={t.name}>{t.name}{t.readOnly ? "" : " ✎"}</option>)}</select>
      {(() => { const q = t.description.indexOf("? "); const head = q > 0 ? t.description.slice(0, q + 1) : t.description; const rest = q > 0 ? t.description.slice(q + 2) : ""; return <div className="dim small">{head}{rest && <details className="small"><summary className="dim">what it returns</summary><p className="dim">{rest}</p></details>}</div>; })()}
      <div className="dim small mono" id="tool-schema">{JSON.stringify((t.inputSchema as any).properties && Object.fromEntries(Object.entries((t.inputSchema as any).properties).map(([k, v]: any) => [k, v.enum ? v.enum.join("|") : v.type])))}</div>
      <textarea value={input} onChange={e => { setTouched(true); setInput(e.target.value); }} rows={3} spellCheck={false} aria-label="tool input (JSON)" aria-describedby="tool-schema" aria-invalid={outIsError || undefined} />
      <button ref={callRef} onClick={async () => { try { setOut(await callTool(tool, JSON.parse(input))); } catch (e: any) { setOut(String(e)); } }}>Call</button>
      <div role="status" aria-live="polite">{out && <pre className="small out">{(() => { try { return JSON.stringify(JSON.parse(out), null, 1); } catch { return out; } })()}</pre>}</div>
    </div>
    {/* What the agent just did, announced to screen readers; the visible log is below. */}
    <div role="status" aria-live="polite" style={srOnly}>{calls[0] ? `${calls[0].tool}: ${calls[0].summary}` : ""}</div>
    {calls.length > 0 && <div className="card"><h2>Tool calls <span className="dim">what the agent did on this page</span></h2>
      {calls.map((c, i) => <div key={i} className="call"><span className={c.ok ? "pass" : "fail"} role="img" aria-label={c.ok ? "ok" : "failed"}>●</span> <b>{c.tool}</b> <span className="args mono">{fmtArgs(c.input)}</span><div className={`what ${c.ok ? "" : "fail"}`}>{c.summary}</div></div>)}
    </div>}
  </aside>;
}
