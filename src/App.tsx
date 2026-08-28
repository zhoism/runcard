import { useEffect, useState } from "react";
import type { Manifest, IndexEntry } from "./lib/types";
import { loadIndex, loadRun, validateStage, ensemble, diffRuns, zipBundle, uncertaintyFromFrames } from "./lib/runs";
import { runningMean } from "./lib/stats";
import type { Report } from "./lib/amberCheck";
import { useStore, navigate, setProposalStatus, set } from "./store";
import { TOOLS, callTool } from "./webmcp";
import { Viewer, Boundary } from "./Viewer";

const show = (v: unknown) => Array.isArray(v) ? v.join(" ") : v == null ? "—" : String(v);
const fmt = (n: number | null | undefined, d = 2) => n == null ? "—" : n.toFixed(d);
const Verdict = ({ r }: { r: Report }) => <span className={`badge ${r.hasFail ? "fail" : r.hasWarn ? "warn" : "pass"}`}>{r.hasFail ? "FAIL" : r.hasWarn ? "WARN" : "PASS"}</span>;

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
      <span className={`webmcp ${st}`} title={st === "registered" ? "Tools registered with document.modelContext" : st === "unsupported" ? "This browser does not expose WebMCP; use the Tool Console" : "Registration failed"}>
        WebMCP: {st}
      </span>
    </header>
  );
}

function Home({ idx }: { idx: IndexEntry[] }) {
  return (
    <section>
      <h1>Simulation runs</h1>
      <p className="lede">Each card is a molecular-dynamics run rendered from its artifacts: stages, parameters, seeds, results, environment. Open one and ask your agent about it — the page exposes tools to validate stages, compare runs, explain uncertainty, and build a rerun bundle.</p>
      <table className="runs">
        <thead><tr><th>run</th><th>ligand</th><th>protein atoms</th><th>production</th><th>ΔG MM-GBSA</th><th>PLIP</th></tr></thead>
        <tbody>{idx.map(r => <tr key={r.id} onClick={() => navigate(`/run/${r.id}`)}><td><a href={`#/run/${r.id}`}>{r.title}</a><div className="dim">{r.id}</div></td><td>{r.ligand}</td><td>{r.protein_atoms}</td><td>{r.production_ps} ps</td><td className="num">{fmt(r.delta_g)}</td><td>{r.plip ? "✓" : ""}</td></tr>)}</tbody>
      </table>
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
  useEffect(() => {
    let live = true; setM(null); setErr(null);
    loadRun(id).then(x => { if (live) setM(x); }, e => { if (live) setErr(String(e?.message ?? e)); });
    return () => { live = false; };
  }, [id, attempt]);
  if (err) return <LoadError message={err} onRetry={() => setAttempt(a => a + 1)} />;
  if (!m) return <p className="dim">loading {id}…</p>;
  const ens = idx.length ? ensemble(idx, id) : null;
  const mm = m.results.mmgbsa; const prod = m.stages.find(s => s.role === "production");
  const reports = Object.fromEntries(m.stages.map(s => [s.name, validateStage(m, s.name)]));
  const overall = Object.values(reports).some(r => r.hasFail) ? "FAIL" : Object.values(reports).some(r => r.hasWarn) ? "WARN" : "PASS";
  const others = idx.filter(r => r.id !== id);
  return (
    <section className="run">
      <div className="titlebar"><h1>{m.title}</h1><span className="dim">{m.id}</span><span className={`badge ${overall.toLowerCase()}`}>all stages {overall}</span>
        <select value="" onChange={e => e.target.value && navigate(`/compare/${id}/${e.target.value}`)}><option value="">compare with…</option>{others.map(r => <option key={r.id} value={r.id}>{r.title}</option>)}</select></div>

      <div className="grid2">
        <div className="card">
          <h2>System</h2>
          <dl>
            <dt>protein</dt><dd>{m.system.protein.atoms} atoms</dd>
            <dt>ligand</dt><dd>{m.system.ligand.resname} · {m.system.ligand.atoms} atoms · {m.system.ligand.charge_method} charges · net {m.system.ligand.net_charge}</dd>
            <dt>atom types</dt><dd className="mono">{m.system.ligand.atom_types?.join(" ")}</dd>
            <dt>solvent</dt><dd>{m.system.solvent.model} {m.system.solvent.box === "oct" ? "truncated octahedron" : m.system.solvent.box}, {m.system.solvent.buffer_A} Å buffer · {m.system.solvent.residues_added?.[0]} waters+ions · {m.system.solvent.solvated_atoms} atoms</dd>
            <dt>force fields</dt><dd className="mono">{m.system.force_fields.join(" · ")}</dd>
            <dt>engine</dt><dd>{prod?.engine} · AmberTools {m.environment.conda_lock.ambertools} · MMPBSA.py {mm?.mmpbsa_version}</dd>
          </dl>
        </div>
        {m.structure && <Boundary label="Structure"><div className="card"><h2>Structure <span className="dim">cluster medoid, dry</span></h2><Viewer url={`/runs/${m.id}/${m.structure}`} ligand={m.system.ligand.resname} /></div></Boundary>}
      </div>

      <div className="card">
        <h2>Stages <span className="dim">select a stage for its input and validation</span></h2>
        {/* Each stage is a native disclosure button: Tab reaches it, Enter/Space toggle it, aria-expanded carries the state. The arrow is decoration. */}
        <div className="stages">{m.stages.map((s, i) => <div key={s.name} className={`stage ${open === s.name ? "open" : ""}`}>
          {i > 0 && <span className="arrow" aria-hidden="true">→</span>}
          <button type="button" className="stagebox" id={`stage-${s.name}`} aria-expanded={open === s.name} aria-controls={open === s.name ? "stagedetail" : undefined} onClick={() => setOpen(open === s.name ? null : s.name)}>
            <span className="stagename">{s.name}</span><span className="dim">{s.role}{s.length_ps != null ? ` · ${s.length_ps} ps` : ""}</span>
            <span className="dim">{s.cntrl.temp0 ? `${s.cntrl.temp0} K` : ""}{s.cntrl.ntp === "1" ? " NPT" : s.cntrl.ntb === "1" ? " NVT" : ""}{s.cntrl.ntr === "1" ? " restrained" : ""}</span>
            <Verdict r={reports[s.name]} /></button></div>)}</div>
        {open && (() => { const s = m.stages.find(x => x.name === open)!; const r = reports[open]; return <div className="stagedetail" id="stagedetail" role="region" aria-labelledby={`stage-${open}`}>
          <div><h3>{s.name}.in</h3><pre>{s.mdin}</pre>
            <div className="dim">restarts from {s.restart_from || "initial coordinates"} · requested ig={s.requested_seed} → realized seed {s.realized_seed ?? "n/a"} · wall {s.wall_s ?? "?"} s · {s.finished ? "finished" : "not finished"}{s.envelope?.crashes?.length ? ` · crashes: ${s.envelope.crashes.join(", ")}` : ""}</div></div>
          <div><h3>Validation</h3><ul className="findings">{r.findings.map((f, i) => <li key={i}><span className={`badge ${f.level.toLowerCase()}`}>{f.level}</span> <b>{f.rule}</b> — {f.detail}</li>)}</ul></div>
        </div>; })()}
      </div>

      <div className="grid2">
        <div className="card">
          <h2>Binding free energy <span className="dim">MM-GBSA, single trajectory</span></h2>
          {mm ? <>
            <div className="big">{fmt(mm.delta_total_kcal_mol)} <span className="unit">kcal/mol</span></div>
            <dl><dt>per-frame</dt><dd>SD {fmt(mm.frame_std)} · SEM {fmt(mm.frame_sem, 3)} over {mm.frames} frames <span className="dim">(population SD; frames are correlated, so this SEM understates uncertainty{mm.frames_header_text && mm.frames_header_text !== String(mm.frames) ? `; the mmgbsa.dat header prints "${mm.frames_header_text}", see frames_note` : ""})</span></dd>
              {mm.per_frame && (() => { const u = uncertaintyFromFrames(mm.per_frame, prod?.length_ps ?? null); return <><dt>corrected</dt><dd>SEM <b>{u.corrected_sem}</b> after autocorrelation (g = {u.statistical_inefficiency_g}, τ = {u.integrated_autocorrelation_time_frames} frames, N<sub>eff</sub> ≈ {u.n_eff}) · halves {u.halves.first} → {u.halves.second} · <b>{u.verdict}</b> <span className="dim">(reconstructed from the per-frame mdout; reproduces mmgbsa.dat exactly)</span></dd></>; })()}
              <dt>method</dt><dd>igb={mm.igb}, saltcon={mm.saltcon}, {prod?.length_ps} ps production, seed {prod?.realized_seed}</dd>
              {ens && ens.all.n > 1 && <><dt>run-to-run</dt><dd><b>n={ens.all.n}</b> independent runs of this system: mean {fmt(ens.all.mean)}, SD {fmt(ens.all.sd)}, range {fmt(ens.all.min)} … {fmt(ens.all.max)}
                {ens.long.n > 0 && ens.long.n < ens.all.n && <><br /><b>n={ens.long.n}</b> runs ≥ {ens.long.min_ps} ps: mean {fmt(ens.long.mean)}, SD {fmt(ens.long.sd)}, range {fmt(ens.long.min)} … {fmt(ens.long.max)}</>}
                <span className="dim"> — production lengths differ across runs; this spread is the uncertainty that matters</span></dd></>}
              <dt>computed</dt><dd>{mm.run_on}</dd></dl>
            {mm.per_frame && <Sparkline x={mm.per_frame.delta_total} lengthPs={prod?.length_ps ?? null} />}
            {mm.warnings.map((w, i) => <div key={i} className="warnbox">⚠ {w}<div className="dim">Recorded verbatim from mmgbsa.dat. Ask the agent to explain_result for what it means.</div></div>)}
          </> : <p className="dim">no MM-GBSA result</p>}
        </div>
        <div className="card">
          <h2>Contacts <span className="dim">PLIP on the medoid frame</span></h2>
          {m.results.plip ? <>
            <dl>{Object.entries(m.results.plip.interactions).map(([k, v]) => <div key={k}><dt>{k.replace("_", " ")}</dt><dd>{v.map(x => x.residue).join(", ")}</dd></div>)}</dl>
            <div className="dim">frame {m.results.plip.frame?.index} of {m.results.plip.frame?.nframes} ({m.results.plip.frame?.policy})</div>
            {m.analyses.plip && <img src={`/runs/${m.id}/plip.png`} alt="PLIP" />}
          </> : <p className="dim">no PLIP profile for this run</p>}
        </div>
      </div>

      <div className="card"><h2>Analyses <span className="dim">cpptraj</span></h2>
        <div className="gallery">{Object.entries(m.analyses).filter(([k]) => k !== "plip").map(([k, a]) => <figure key={k}><img src={`/runs/${m.id}/${a.png}`} alt={k} loading="lazy" /><figcaption>{k}</figcaption></figure>)}</div></div>

      <div className="card"><h2>Provenance</h2>
        <dl><dt>pipeline stages</dt><dd className="mono">{Object.entries(m.pipeline.stage_envelopes).map(([k, ok]) => `${k}:${ok ? "ok" : "FAILED"}`).join("  ")} <span className="dim">({m.pipeline.skills.join(" → ")})</span></dd>
          <dt>environment</dt><dd className="mono">{Object.entries(m.environment.conda_lock).map(([k, v]) => `${k}=${v}`).join("  ")} <a href="/runs/env.lock.yml" target="_blank">full lock</a></dd>
          <dt>seeds</dt><dd className="mono">{m.stages.map(s => `${s.name}:${s.realized_seed ?? "-"}`).join("  ")}</dd>
          <dt>leap.in</dt><dd><pre className="small">{m.system.leap_in}</pre></dd></dl></div>
    </section>
  );
}

/** Per-frame ΔG with running mean. Inline SVG; every point is a number from the manifest. */
function Sparkline({ x, lengthPs }: { x: number[]; lengthPs: number | null }) {
  const W = 480, H = 90, P = 4; const lo = Math.min(...x), hi = Math.max(...x); const rm = runningMean(x);
  const sx = (i: number) => P + (i / (x.length - 1)) * (W - 2 * P), sy = (v: number) => P + (1 - (v - lo) / (hi - lo || 1)) * (H - 2 * P);
  const path = (v: number[]) => v.map((y, i) => `${i ? "L" : "M"}${sx(i).toFixed(1)},${sy(y).toFixed(1)}`).join(" ");
  return <figure className="spark"><svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="per-frame ΔG">
      <path d={path(x)} fill="none" stroke="var(--dim)" strokeWidth="1" /><path d={path(rm)} fill="none" stroke="var(--acc)" strokeWidth="1.5" /></svg>
    <figcaption>per-frame ΔG over {x.length} frames{lengthPs != null ? ` (${lengthPs} ps)` : ""}: grey = frame values ({lo.toFixed(1)} … {hi.toFixed(1)}), blue = running mean → {rm[rm.length - 1].toFixed(2)} kcal/mol</figcaption></figure>;
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
  if (err) return <LoadError message={`compare ${a} vs ${b}: ${err}`} onRetry={() => setAttempt(n => n + 1)} />;
  if (!d) return <p className="dim">comparing…</p>;
  return <section>
    <h1>Compare <a href={`#/run/${a}`}>{a}</a> vs <a href={`#/run/${b}`}>{b}</a></h1>
    <div className={`interp ${d.same_system ? "" : "warn"}`}>{d.interpretation}</div>
    <div className="grid2">
      <div className="card"><h2>System</h2>{d.system.length ? <table><tbody>{d.system.map(s => <tr key={s.field}><td>{s.field}</td><td className="mono">{show(s.a)}</td><td className="mono">{show(s.b)}</td></tr>)}</tbody></table> : <p className="pass">identical prepared system</p>}</div>
      <div className="card"><h2>ΔG</h2><table><tbody><tr><td>{a}</td><td className="num">{fmt(d.delta_g.a)}</td></tr><tr><td>{b}</td><td className="num">{fmt(d.delta_g.b)}</td></tr>
        {d.run_to_run_spread && <tr><td>run-to-run (n={d.run_to_run_spread.all.n})</td><td className="num">{fmt(d.run_to_run_spread.all.mean)} ± {fmt(d.run_to_run_spread.all.sd)}</td></tr>}
        {d.delta_g.diff != null && <tr><td>ΔΔG (a − b)</td><td className="num">{fmt(d.delta_g.diff)}</td></tr>}</tbody></table>
        <div className="dim mono">seeds A: {d.realized_seeds.a.join(" ")}<br />seeds B: {d.realized_seeds.b.join(" ")}</div></div>
    </div>
    <div className="card"><h2>Stage parameters</h2>{d.stages.length ? d.stages.map(s => <div key={s.stage}><h3>{s.stage}</h3><table><thead><tr><th>key</th><th>meaning</th><th>{a}</th><th>{b}</th><th></th></tr></thead><tbody>{s.changes.map(c => <tr key={c.key} className={c.material ? "" : "dim"}><td className="mono">{c.key}</td><td>{c.meaning}</td><td className="mono">{c.a}</td><td className="mono">{c.b}</td><td>{c.material ? <span className="badge warn">{c.class.replace("_", " ")}</span> : <span className="badge">{c.class.replace("_", " ")}</span>}</td></tr>)}</tbody></table></div>) : <p className="pass">no parameter differences (seeds excluded)</p>}</div>
  </section>;
}

function Sidebar() {
  const proposals = useStore(s => s.proposals); const calls = useStore(s => s.calls); const bundle = useStore(s => s.bundle);
  const [tool, setTool] = useState(TOOLS[0].name); const [input, setInput] = useState("{}"); const [out, setOut] = useState("");
  const t = TOOLS.find(x => x.name === tool)!;
  const download = () => { if (!bundle) return; const z = zipBundle(bundle.files); const url = URL.createObjectURL(new Blob([z as BlobPart], { type: "application/zip" })); const a = document.createElement("a"); a.href = url; a.download = bundle.name; a.click(); URL.revokeObjectURL(url); };
  return <aside>
    <div className="card">
      <h2>Proposals <span className="dim">agent proposes, you approve</span></h2>
      {proposals.length === 0 && <p className="dim">None yet. An agent can call <code>propose_change</code>; nothing is applied until you approve it here.</p>}
      {proposals.map(p => <div key={p.id} className={`proposal ${p.status}`}>
        <div><b>{p.run}</b> / {p.stage} <span className={`badge ${p.status}`}>{p.status}</span></div>
        <div className="mono">{Object.entries(p.edits).map(([k, v]) => `${k}=${v}`).join(", ")}</div>
        <div className="dim">{p.reason}</div>
        <div>before <Verdict r={p.before} /> → after <Verdict r={p.after} /></div>
        {p.after.findings.filter(f => f.level !== "PASS").map((f, i) => <div key={i} className="dim small">{f.level}: {f.rule} — {f.detail}</div>)}
        {p.status === "pending" && <div className="row"><button onClick={() => setProposalStatus(p.id, "approved")} disabled={p.after.hasFail} title={p.after.hasFail ? "Cannot approve a change that fails physics validation" : ""}>Approve</button><button className="ghost" onClick={() => setProposalStatus(p.id, "rejected")}>Reject</button></div>}
      </div>)}
    </div>
    {bundle && <div className="card"><h2>Rerun bundle</h2><div className="mono small">{Object.keys(bundle.files).join("\n")}</div><button onClick={download}>Download {bundle.name}</button> <button className="ghost" onClick={() => set({ bundle: null })}>clear</button></div>}
    <div className="card">
      <h2>Tool console <span className="dim">the same tools an agent sees</span></h2>
      <select value={tool} onChange={e => { setTool(e.target.value); setInput("{}"); }}>{TOOLS.map(t => <option key={t.name} value={t.name}>{t.name}{t.readOnly ? "" : " ✎"}</option>)}</select>
      <div className="dim small">{t.description}</div>
      <div className="dim small mono">{JSON.stringify((t.inputSchema as any).properties && Object.fromEntries(Object.entries((t.inputSchema as any).properties).map(([k, v]: any) => [k, v.enum ? v.enum.join("|") : v.type])))}</div>
      <textarea value={input} onChange={e => setInput(e.target.value)} rows={3} spellCheck={false} />
      <button onClick={async () => { try { setOut(await callTool(tool, JSON.parse(input))); } catch (e: any) { setOut(String(e)); } }}>Call</button>
      {out && <pre className="small out">{(() => { try { return JSON.stringify(JSON.parse(out), null, 1); } catch { return out; } })()}</pre>}
    </div>
    <div className="card"><h2>Tool calls <span className="dim">what the agent did on this page</span></h2>
      {calls.length === 0 && <p className="dim">none yet</p>}
      {calls.map((c, i) => <div key={i} className="call"><span className={c.ok ? "pass" : "fail"}>●</span> <b>{c.tool}</b> <span className="dim mono">{JSON.stringify(c.input)}</span><div className="dim small">{c.summary}</div></div>)}
    </div>
  </aside>;
}
