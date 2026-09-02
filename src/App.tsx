import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { Manifest, IndexEntry, Owners } from "./lib/types";
import { loadIndex, loadOwners, ownerStats, ownerHandles, loadRun, validateStage, ensemble, cohorts, type Cohort, projectSummary, protocolPairs, type ForkNetwork, diffRuns, zipBundle, uncertaintyFromFrames, verdictOf, confidenceLadderFull, explainResult, internalResidual, forkNetwork, forkNetworks, type Proposal, sameSystem } from "./lib/runs";
import { runningMean } from "./lib/stats";
import type { Report } from "./lib/amberCheck";
import { useStore, navigate, setProposalStatus, set } from "./store";
import { analysisInfo, ANALYSIS_CATEGORIES, type AnalysisCategory } from "./lib/analysisCatalog";
import { describeSystem } from "./lib/systemCatalog";
import { TOOLS, callTool } from "./webmcp";
import { Viewer, Boundary } from "./Viewer";
import { Spread } from "./Spread";
import type { InvestigationState } from "./lib/investigation";

/** "run_id=1l2y-regression stage=product" — the call's arguments, readable at a glance. */
const fmtArgs = (input: unknown) => input && typeof input === "object" && !Array.isArray(input) ? Object.entries(input as Record<string, unknown>).map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`).join(" ") : input == null ? "" : JSON.stringify(input);
const show = (v: unknown) => Array.isArray(v) ? v.join(" ") : v == null ? "—" : String(v);
const fmt = (n: number | null | undefined, d = 2) => n == null ? "—" : n.toFixed(d);
/** GitHub's "owner / repo": a run is named by whose card it is. Falls back to the bare id until the index has loaded. */
const ownerOf = (idx: IndexEntry[], id: string) => idx.find(r => r.id === id)?.owner;
const qualified = (idx: IndexEntry[], id: string) => { const o = ownerOf(idx, id); return o ? `${o}/${id}` : id; };
const plural = (n: number, w: string) => (n === 1 ? w : w + "s");
/** The project (cohort) a run belongs to, for breadcrumbs. */
const projectOf = (idx: IndexEntry[], id: string) => cohorts(idx).find(c => c.runs.some(r => r.id === id));
const rungCls = (st: string) => st === "verified" ? "pass" : st === "not established" ? "warn" : st === "partly established" ? "partly" : "";
/** One color code everywhere (design ruling 2026-09-01): green pass, amber warn, red fail. The copy still scopes PASS as an input sanity check, not physical validity. */
const Verdict = ({ r }: { r: Report }) => { const v = verdictOf(r); return <span className={`badge ${v.toLowerCase()}`}>{v}</span>; };
/** Visually hidden, read by screen readers. Inline so it survives a stylesheet swap. */
const srOnly = { position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" } as const;

export default function App() {
  const route = useStore(s => s.route);
  const [idx, setIdx] = useState<IndexEntry[]>([]);
  const [own, setOwn] = useState<Owners | null>(null);
  const [idxErr, setIdxErr] = useState<string | null>(null);
  useEffect(() => { loadIndex().then(setIdx, e => setIdxErr(String(e?.message ?? e))); loadOwners().then(setOwn, () => setOwn(null)); }, []);
  const parts = route.split("/").filter(Boolean);
  return (
    <div className="app">
      <Header />
      <main>
        {idxErr && <div className="interp warn" role="alert">{idxErr} — reload the page to try again.</div>}
        <Boundary label="Page">{parts[0] === "run" && parts[1] ? <RunPage key={parts[1]} id={parts[1]} idx={idx} own={own} /> :
         parts[0] === "compare" && parts[2] ? <ComparePage a={parts[1]} b={parts[2]} idx={idx} /> :
         parts[0] === "p" && parts[1] ? <ProjectPage key={parts[1]} slug={decodeURIComponent(parts[1])} idx={idx} own={own} /> :
         parts[0] === "u" && parts[1] ? <Profile key={parts[1]} handle={decodeURIComponent(parts[1])} idx={idx} own={own} /> :
         <Home idx={idx} own={own} />}</Boundary>
      </main>
      <Sidebar idx={idx} />
    </div>
  );
}

function Mark() {
  return (
    <svg className="mark" viewBox="-12 -20 445 460" aria-hidden="true" fill="currentColor" stroke="currentColor" strokeWidth="20">
      <path d="M14.1373 175.633C5.63734 165.633 12.1372 153.133 16.6372 149.633L163.637 30.6328C185.637 11.6328 247.137 -9.86717 295.137 44.6328C331.637 89.6326 313.637 145.633 281.137 174.133L163.637 269.633C155.637 278.633 127.137 300.633 150.137 345.133C178.137 385.133 219.69 370.466 234.137 358.633L380.137 240.133C385.137 236.133 395.637 230.633 405.637 241.133C415.422 251.406 408.804 262.966 404.637 267.133L260.137 385.133C234.137 406.133 170.637 427.633 122.637 369.133C87.1373 313.133 113.637 262.633 142.637 240.633L260.137 145.633C265.137 141.133 300.637 102.633 265.137 65.6327C236.737 36.0327 203.304 47.2994 190.137 56.6327C141.137 96.2994 42.4484 175.822 40.6373 177.633C37.1372 181.133 23.6368 186.809 14.1373 175.633Z" />
      <path d="M34.6374 256.133C25.6373 245.133 32.4707 233.3 36.6374 230.133L210.137 89.6331C215.637 85.1329 229.137 80.6327 237.637 91.6331C245.137 101.633 239.471 112.633 235.637 116.133L59.6373 258.133C55.6373 261.133 44.6373 266.133 34.6374 256.133Z" />
      <path d="M184.065 326.982C175.065 315.982 181.898 304.149 186.065 300.982L359.565 160.482C365.065 155.982 378.565 151.482 387.065 162.482C394.565 172.482 388.898 183.482 385.065 186.982L209.065 328.982C205.065 331.982 194.065 336.982 184.065 326.982Z" />
    </svg>
  );
}

function Header() {
  const st = useStore(s => s.webmcp);
  return (
    <header>
      <a href="#/" className="brand"><Mark />runcard</a>
      {/* One pill says what an agent gets here. Green: registered with navigator.modelContext. Amber: this browser does not expose WebMCP; the pill leads to the console, which calls the same table by hand. */}
      {st === "registered" ? <span className="webmcp registered" title="Registered with navigator.modelContext — an agent in this browser can call every tool on this page">WebMCP · {TOOLS.length} tools</span>
       : st === "registering" ? <span className="webmcp registering" title="This browser exposes WebMCP; the tools are being registered">WebMCP · {TOOLS.length} tools <span className="dim">· registering…</span></span>
       : st === "error" ? <span className="webmcp error" title="registerTool threw; see the browser console">WebMCP · registration failed</span>
       : <a className="webmcp" href="#tool-console" onClick={e => { e.preventDefault(); document.getElementById("tool-console")?.scrollIntoView({ behavior: "smooth", block: "start" }); }} title="This browser does not expose WebMCP. Chrome 149+: chrome://flags/#enable-webmcp-testing, then reload. The console on this page calls the same tools by hand.">WebMCP · {TOOLS.length} tools <span className="dim">· off in this browser</span><span className="dim short">· off</span></a>}
    </header>
  );
}


/** The id line under a run's title: its id, what it forks, and who forked it. */
function RunLineage({ idx, r }: { idx: IndexEntry[]; r: IndexEntry }) {
  const ks = idx.filter(x => x.parent === r.id); const by = [...new Set(ks.map(k => k.owner).filter(o => o && o !== r.owner))];
  return <div className="dim">{r.id}{r.parent ? <span className="forkmark"> ↳ fork of {qualified(idx, r.parent)}</span> : null}{ks.length ? <span className="forkmark"> · {ks.length} {plural(ks.length, "fork")}{by.length ? ` by ${by.join(", ")}` : ""}</span> : null}</div>;
}

/** "13 comparable runs · 9 by Kevin Zhou · 4 by PACE-ICE (external forks)": who ran what in a project, external forks named per owner. */
function CountsLine({ c, p, own }: { c: Cohort; p: ReturnType<typeof projectSummary>; own: Owners | null }) {
  const byId = new Map(c.runs.map(r => [r.id, r]));
  const extOf = (h: string) => c.runs.filter(r => r.owner === h && r.parent && byId.has(r.parent) && byId.get(r.parent)!.owner !== h).length;
  return <p className="cohort-counts"><b>{c.n}</b> comparable {plural(c.n, "run")}{p.by_owner.map(o => { const e = extOf(o.handle); return <span key={o.handle}> · <b>{o.n}</b> by <a href={`#/u/${o.handle}`}>{own?.profiles[o.handle]?.name ?? o.handle}</a>{e ? <span className="dim"> ({e === o.n ? "external forks" : `${e} external ${plural(e, "fork")}`})</span> : null}</span>; })}</p>;
}

/** A project is the repository: one prepared system, its runs as commits. The card says what it is, who ran it, the number
    and its spread, and where to go. On a profile it also folds that owner's runs under a disclosure. */
function ProjectCard({ c, idx, own, rows, handle }: { c: Cohort; idx: IndexEntry[]; own: Owners | null; rows?: IndexEntry[]; handle?: string }) {
  const p = projectSummary(idx, c.slug);
  const sys = describeSystem(c.title, p.start.ligand);
  const span = `${c.lengths_ps[0]}–${c.lengths_ps[c.lengths_ps.length - 1]} ps`;
  const nameOf = (h: string) => own?.profiles[h]?.name ?? h;
  const st = p.network?.status;
  const ringId = p.network?.parent.id ?? c.start_here;
  return <section className="cohort">
    {/* Kicker: the system's code name and the fork status. Headline: what it is, in words. Then the spread, the object a reader can see at once. */}
    <p className="kicker">{sys ? <span className="mono">{c.title}</span> : <span>project</span>}{st && st !== "none" && <span className={`badge ${st === "agree" ? "pass" : st === "tension" ? "warn" : ""}`}>{st === "agree" ? "forks agree" : st === "tension" ? "forks in tension" : "forks: sign only"}</span>}</p>
    <h2 className="headline"><a href={`#/p/${c.slug}`}>{sys?.name ?? c.title}</a></h2>
    <p className="cohort-desc">{sys ? `${sys.sentence} ` : ""}{c.n > 1 ? `The same prepared system and protocol run ${c.n} times with fresh seeds, ${span}.` : "One run so far."}</p>
    <Spread runs={c.runs} mean={c.mean} sd={c.sd} own={own} ringId={ringId} ringWhy={p.network ? "the parent of the forks" : "the longest run"} />
    <div className="meta-row">
      <p className="cohort-dg">ΔG <b className="mono">{fmt(c.mean)}{c.sd != null ? ` ± ${fmt(c.sd)}` : ""}</b> kcal/mol <span className="dim">MM-GBSA{c.sd != null ? "" : " · one run, so no run-to-run spread yet"}</span></p>
      <CountsLine c={c} p={p} own={own} />
    </div>
    <div className="cohort-actions">
      <a className="btn" href={`#/p/${c.slug}`}>Open project →</a>
      <a className="btn ghost" href={`#/run/${p.start.id}`}>Longest run <span className="dim">{p.start.id} · {p.start.production_ps} ps</span></a>
    </div>
    {rows && <details className="runs-list" open={rows.length <= 3}>
      <summary>{rows.length} {plural(rows.length, "run")} by {handle ? nameOf(handle) : "this owner"}{rows.length > 1 && <span className="dim"> · the same experiment; seeds and lengths differ</span>}</summary>
      <div className="tablewrap"><table className="runs">
        <thead><tr><th>run</th><th>production</th><th>ΔG <span className="dim">kcal/mol</span></th><th>contacts <span className="dim">PLIP</span></th></tr></thead>
        <tbody>{rows.map(r => <tr key={r.id} onClick={() => navigate(`/run/${r.id}`)}><td><a href={`#/run/${r.id}`}>{r.title}</a><RunLineage idx={idx} r={r} /></td><td>{r.production_ps} ps</td><td className="num">{fmt(r.delta_g)}</td><td>{r.plip ? "✓" : ""}</td></tr>)}</tbody>
      </table></div>
    </details>}
  </section>;
}

/** Home lists the projects: the prepared systems are the repositories. People are one line; profiles are a click away. */
function Home({ idx, own }: { idx: IndexEntry[]; own: Owners | null }) {
  useEffect(() => { document.title = "runcard"; }, []);
  const cs = cohorts(idx); const handles = ownerHandles(idx);
  const nameOf = (h: string) => own?.profiles[h]?.name ?? h;
  return <section>
    <h1>Validated records of <em>molecular simulations</em></h1>
    <p className="lede">A project is one prepared system. Its runs are the commits, a fork is a rerun with lineage, and every number on the page traces to a file in the run directory. An agent reads the same page through WebMCP; a person approves every change to an input.</p>
    {!idx.length && <p className="dim" role="status">loading runs…</p>}
    {cs.map(c => <ProjectCard key={c.key} c={c} idx={idx} own={own} />)}
    {handles.length > 0 && <p className="people">People on runcard: {handles.map((h, i) => { const o = ownerStats(idx, h); return <span key={h}>{i ? " · " : ""}<a href={`#/u/${h}`}>{nameOf(h)}</a> <span className="dim">@{h} · {o.runs} {plural(o.runs, "run")}{o.forks_from_others > 0 ? `, forks of ${o.forked_from.map(nameOf).join(", ")}'s` : ""}</span></span>; })}</p>}
  </section>;
}

/** The fork network's verdict as one scientific finding with a next step, not a paragraph of arithmetic. Every clause
    comes from `forkNetwork`'s fields; the full card with the numbers sits behind the anchor. */
function ForkCallout({ net, detailHref, onReplicate }: { net: ForkNetwork; detailHref: string; onReplicate?: () => void }) {
  const by = [...new Set(net.forks.map(f => f.owner).filter((o): o is string => !!o && o !== net.parent.owner))];
  const crossEngine = net.engines.forks.some(e => e !== net.engines.parent);
  const head = net.status === "tension" ? `${net.n} independent ${net.n === 1 ? "fork disagrees" : "forks disagree"} with ${net.parent.id} beyond seed noise`
    : net.status === "agree" ? `${net.n} independent ${net.n === 1 ? "fork reproduces" : "forks reproduce"} ${net.parent.id} to seed noise`
    : `${net.n} ${net.n === 1 ? "fork agrees" : "forks agree"} with ${net.parent.id} in sign; the spread cannot be judged yet`;
  const body = net.status === "tension"
    ? `${net.sign_agrees ? "All keep the sign of ΔG" : "Not all keep the sign of ΔG"}; the fork mean sits ${fmt(Math.abs(net.parent_offset_kcal!), 1)} kcal/mol from the parent, ${fmt(Math.abs(net.parent_offset_sd!), 1)}× the run-to-run SD.${crossEngine ? " Engine and seed changed together, so the cause is unresolved; a replicate on the parent's engine would separate them." : " Same engine, so seed noise alone does not explain it."}`
    : net.status === "agree" ? `Fork mean ${fmt(net.fork_mean)}${net.fork_sd != null ? ` ± ${fmt(net.fork_sd)}` : ""} kcal/mol; the parent is within 2 run-to-run SDs of it${crossEngine ? ", across an engine change" : ""}.`
    : `Fork mean ${fmt(net.fork_mean)} kcal/mol; no run-to-run SD is available to judge the spread.`;
  return <div className={`callout ${net.status === "tension" ? "warn" : net.status === "agree" ? "pass" : ""}`} role="note">
    <p className="callout-head">{head}{by.length ? <span className="dim"> · by {by.join(", ")}</span> : null}</p>
    <p className="callout-body">{body}</p>
    <div className="callout-actions"><a href={detailHref}>Inspect fork evidence ↓</a>{onReplicate && <button type="button" className="ghost" onClick={onReplicate}>Plan a replicate</button>}</div>
  </div>;
}

/** Compare two runs of a project: GitHub's branch picker, not "this run with…" — on a project page there is no "this run". */
function ComparePair({ runs }: { runs: IndexEntry[] }) {
  const [a, setA] = useState(runs[0]?.id ?? ""); const [b, setB] = useState("");
  const label = (r: IndexEntry) => `${r.id} · ${r.owner ?? "—"} · ${r.engine} · ${r.production_ps} ps`;
  return <div className="compare-pair" role="group" aria-label="compare two runs">
    <span className="dim">Compare two runs</span>
    <select value={a} aria-label="first run" onChange={e => setA(e.target.value)}>{runs.map(r => <option key={r.id} value={r.id}>{label(r)}</option>)}</select>
    <span className="dim">with</span>
    <select value={b} aria-label="second run" onChange={e => setB(e.target.value)}><option value="">select second run…</option>{runs.filter(r => r.id !== a).map(r => <option key={r.id} value={r.id}>{label(r)}</option>)}</select>
    <button type="button" disabled={!a || !b} onClick={() => navigate(`/compare/${a}/${b}`)}>Compare</button>
  </div>;
}

/** The project page: a prepared system is the repository and its runs are the commits. Everything here is read from the
    index except the longest run's manifest, loaded for the confidence ladder and the fork actions and labelled as that run's. */
function ProjectPage({ slug, idx, own }: { slug: string; idx: IndexEntry[]; own: Owners | null }) {
  let p: ReturnType<typeof projectSummary> | null = null;
  if (idx.length) { try { p = projectSummary(idx, slug); } catch { p = null; } }
  const startId = p?.start.id;
  const [m, setM] = useState<Manifest | null>(null); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (!startId) return; let live = true; loadRun(startId).then(x => { if (live) setM(x); }, e => { if (live) setErr(String(e?.message ?? e)); }); return () => { live = false; }; }, [startId]);
  useEffect(() => { document.title = p ? `${p.cohort.title} · runcard` : "runcard"; }, [p?.cohort.title]);
  if (!idx.length) return <p className="dim" role="status">loading…</p>;
  if (!p) return <section><h1>No project <span className="dim mono">{slug}</span></h1><p className="dim">Nothing by that name here. <a href="#/">All projects.</a></p></section>;
  const { cohort: c, start } = p; const sys = describeSystem(c.title, start.ligand);
  const ens = ensemble(idx, start.id); const ladder = m ? confidenceLadderFull(m, idx) : null;
  const S = start.system; const pairs = protocolPairs(start.protocol);
  const span = `${c.lengths_ps[0]}–${c.lengths_ps[c.lengths_ps.length - 1]} ps`;
  const netCls = p.network ? (p.network.status === "agree" ? "pass" : p.network.status === "tension" ? "warn" : "") : "";
  return <section className="project">
    <nav className="crumbs" aria-label="breadcrumb"><a href="#/">projects</a><span aria-hidden="true">/</span><span>{c.title}</span></nav>
    <div className="titlebar"><h1>{sys?.name ?? c.title}</h1>{sys && <span className="dim">{c.title}</span>}
      {p.network && <a className={`badge fork ${netCls}`} href={`#network-${p.network.parent.id}`}>{p.network.n} forks · {p.network.status === "agree" ? "agree" : p.network.status === "tension" ? "in tension" : "sign only"}</a>}</div>
    <p className="lede">{sys ? `${sys.sentence} ` : ""}{c.n > 1 ? `The same prepared system and protocol run ${c.n} times with fresh seeds, ${span}.` : "One run so far."}</p>
    <CountsLine c={c} p={p} own={own} />

    <div className="card">
        <h2>Ensemble result <span className="dim">MM-GBSA ΔG across the runs</span></h2>
        <p className="cohort-dg">ΔG <b className="mono">{fmt(c.mean)}{c.sd != null ? ` ± ${fmt(c.sd)}` : ""}</b> kcal/mol <span className="dim">{c.sd != null ? "mean ± run-to-run SD" : "one run, no spread yet"}</span></p>
        <Spread runs={c.runs} mean={c.mean} sd={c.sd} own={own} ringId={p.network?.parent.id ?? c.start_here} ringWhy={p.network ? "the parent of the forks" : "the longest run"} />
        {ens.long.n > 0 && ens.long.n < ens.all.n && <dl className="facts">
          <dt>≥ {ens.long.min_ps} ps only</dt><dd><b>n={ens.long.n}</b>: mean {fmt(ens.long.mean)}, SD {fmt(ens.long.sd)}, range {fmt(ens.long.min)} … {fmt(ens.long.max)}</dd>
        </dl>}
        {c.sd != null && <p className="dim small">The ± is the observed run-to-run spread across {c.n} comparable runs with different seeds and lengths{p.engines.length > 1 ? ` and ${p.engines.length} disclosed engines` : ""}: an empirical spread, not pure seed noise.</p>}
        {/* The sign claim only; the spread and its caveat are stated once, above. signClaim's full sentence is what the tool returns. */}
        <p className="dim small">{ens.all.negative === ens.all.n ? `All ${ens.all.n} runs give ΔG < 0; the sign is robust to seed variation.` : ens.all.negative === 0 ? `None of the ${ens.all.n} runs gives ΔG < 0.` : `${ens.all.negative} of ${ens.all.n} runs give ΔG < 0; the sign is not robust across runs.`}</p>
    </div>

    {p.network && <ForkCallout net={p.network} detailHref={`#network-${p.network.parent.id}`} onReplicate={m ? () => forkKinds(m, ens).find(k => k.id === "replicate")?.run() : undefined} />}

    <div className="grid2">
      <div className="card">
        <h2>Shared system and protocol <span className="dim">what every run here has in common</span></h2>
        <dl className="facts">
          <dt>system</dt><dd>{S.protein_atoms}-atom protein · ligand {S.ligand}, {S.ligand_atoms} atoms, {S.charge_method} charges, net {S.net_charge} · {S.solvent}, {S.box} box, {S.buffer_A} Å buffer · {S.force_fields.join(", ")}</dd>
          <dt>protocol</dt><dd className="mono small">{pairs.map(x => `${x.key}=${x.value}`).join(" · ")}</dd>
          <dt>engines</dt><dd>{p.engines.map(e => `${e.engine} × ${e.n}`).join(" · ")}</dd>
        </dl>
        <p className="dim small">Every run here shares all of the above; seeds, lengths{p.engines.length > 1 ? " and engines" : ""} differ.</p>
      </div>
      <div className="card">
        <h2>Confidence <span className="dim">for the longest run, {start.id} — the ladder is computed per run</span></h2>
        {ladder ? <>
          <p><b>{ladder.verified_of_assessable} assessed rungs verified.</b> <a href={`#/run/${start.id}`}>Open its ladder and evidence →</a></p>
          <ol className="ladder compact">{ladder.rungs.map((r, i) => <li key={r.rung} className={r.status === "not assessed" ? "dim" : ""}><span className="dim mono">{i + 1}.</span> <span className={`badge ${rungCls(r.status)}`}>{r.status}</span> <b>{r.rung}</b> <span className="dim">— {r.short}</span></li>)}</ol>
        </> : err ? <p className="dim">{err}</p> : <p className="dim" role="status">loading {start.id}…</p>}
      </div>
    </div>

    <div className="card">
      <h2>Runs <span className="dim">{c.n} · the commits of this project: same system, different seeds, lengths and engines</span></h2>
      <div className="tablewrap"><table className="runs">
        <thead><tr><th>run</th><th>owner</th><th>engine</th><th>production</th><th>ΔG <span className="dim">kcal/mol</span></th><th>contacts <span className="dim">PLIP</span></th></tr></thead>
        <tbody>{c.runs.map(r => <tr key={r.id} onClick={() => navigate(`/run/${r.id}`)}><td><a href={`#/run/${r.id}`}>{r.title}</a>{r.id === c.start_here && <span className="badge start">start here · longest run</span>}<RunLineage idx={idx} r={r} /></td><td>{r.owner ? <a href={`#/u/${r.owner}`}>{r.owner}</a> : "—"}</td><td className="dim">{r.engine}</td><td>{r.production_ps} ps</td><td className="num">{fmt(r.delta_g)}</td><td>{r.plip ? "✓" : ""}</td></tr>)}</tbody>
      </table></div>
    </div>

    {p.network && <ForkNetworkCard net={p.network} />}
    {m && <ForkCards m={m} ens={ens} />}

    <div className="card">
      <h2>Comparability <span className="dim">what may be compared here and what may not</span></h2>
      <p>Runs in this project share one system fingerprint (protein, ligand atom types and charges, solvent, box, force fields) and one production protocol key ({pairs.length} &amp;cntrl and GB settings). Seeds and lengths are free to differ: that is the spread. Engines are disclosed, not assumed equal: {p.engines.map(e => `${e.engine} × ${e.n}`).join(", ")}. A run of another system, or of this system under another protocol, is not a replicate, and the compare page says so.</p>
      <ComparePair runs={c.runs} />
    </div>
  </section>;
}

/** A profile is the page a visitor lands on: whose runs these are, how they connect to other people's, then the runs.
    No accounts — every card is public and the owner is site metadata (public/runs/owners.json), never a login. */
function Profile({ handle, idx, own }: { handle: string; idx: IndexEntry[]; own: Owners | null }) {
  const p = own?.profiles[handle];
  const name = p?.name ?? handle;
  useEffect(() => { document.title = `${name} · runcard`; }, [name]);
  const allProposals = useStore(s => s.proposals);
  const mine = idx.filter(r => r.owner === handle);
  if (idx.length && !mine.length && !p) return <section><h1>No profile <span className="dim handle">@{handle}</span></h1><p className="dim">Nobody by that handle has a run here. <a href="#/">Back to the home page.</a></p></section>;
  const st = ownerStats(idx, handle);
  const others = ownerHandles(idx).filter(h => h !== handle);
  const cs = cohorts(idx).map(c => ({ c, rows: c.runs.filter(r => r.owner === handle) })).filter(x => x.rows.length);
  const nets = forkNetworks(idx).filter(n => n.parent.owner === handle || n.forks.some(f => f.owner === handle));
  const pending = allProposals.filter(pr => pr.status === "pending" && mine.some(r => r.id === pr.run)).length;
  const who = (h: string) => <a href={`#/u/${h}`}>{own?.profiles[h]?.name ?? h}</a>;
  const list = (hs: string[]) => hs.map((h, i) => <span key={h}>{i > 0 ? ", " : ""}{who(h)}</span>);
  return (
    <section>
      <div className="profile">
        <span className="avatar" aria-hidden="true">{name[0].toUpperCase()}</span>
        <div className="profile-body">
          <h1>{name} <span className="dim handle">@{handle}</span></h1>
          {p?.bio && <p className="bio">{p.bio}</p>}
          <p className="stats"><span><b>{st.runs}</b> {plural(st.runs, "run")}</span><span><b>{st.systems}</b> {plural(st.systems, "system")}</span>{st.forks_of_theirs > 0 && <span><b>{st.forks_of_theirs}</b> {plural(st.forks_of_theirs, "fork")} of these runs, by {list(st.forked_by)}</span>}{st.forks_from_others > 0 && <span><b>{st.forks_from_others}</b> forked from {list(st.forked_from)}</span>}{pending > 0 && <span><b>{pending}</b> {plural(pending, "proposal")} awaiting approval</span>}</p>
        </div>
      </div>
      {others.length > 0 && <p className="people">Also on runcard: {others.map((h, i) => { const o = ownerStats(idx, h); return <span key={h}>{i > 0 ? " · " : ""}{who(h)} <span className="dim">@{h} · {o.runs} {plural(o.runs, "run")}{o.forks_from_others > 0 && o.forked_from.includes(handle) ? `, forked from ${name}` : ""}</span></span>; })}</p>}
      {cs.map(({ c, rows }) => <ProjectCard key={c.key} c={c} idx={idx} own={own} rows={rows} handle={handle} />)}
      {/* The fork network sits under the tables: the rows already mark forks; this is the check across them. */}
      {nets.map(net => <ForkNetworkCard key={net.parent.id} net={net} compact />)}
    </section>
  );
}

/** A Figma-style comment marker on a stage: a bubble, not a numbered label. Amber = pending (needs you), green = approved, grey = rejected.
    WebMCP does not expose the client's name, so the glyph is a generic agent mark; the thread names the source. */
function ProposalPin({ stage, proposals, expanded, onToggle }: { stage: string; proposals: Proposal[]; expanded: boolean; onToggle: () => void }) {
  if (!proposals.length) return null;
  const pending = proposals.filter(p => p.status === "pending").length;
  const cls = pending ? "pending" : proposals.every(p => p.status === "rejected") ? "rejected" : "approved";
  const label = `${proposals.length} proposal${proposals.length === 1 ? "" : "s"} on this stage${pending ? `, ${pending} awaiting your approval` : ""}`;
  // A toggle, like the stage boxes: the first click opens the thread, the second closes it.
  return <button type="button" id={`pin-${stage}`} className={`pin ${cls}`} aria-label={label} title={label} aria-expanded={expanded} aria-controls={expanded ? `threads-${stage}` : undefined} onClick={onToggle}><span className="pin-glyph" aria-hidden="true">{proposals.length > 1 ? proposals.length : "✦"}</span></button>;
}
/** One proposal as a comment thread: who and when, the ask, the diff, validation after, and the only two verbs a person has. */
function ProposalThread({ p, compact }: { p: Proposal; compact?: boolean }) {
  const when = p.t ? new Date(p.t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : null;
  return <div className={`thread ${p.status}`}>
    <div className="thread-who"><span className={`chip ${p.source === "webmcp" ? "agent" : ""}`}>{p.source === "webmcp" ? "agent proposal" : "proposal"}</span> {p.source && <Source source={p.source} />}{when && <span className="dim"> · {when}</span>}{compact && <span className="dim"> · <b>{p.run}</b> / {p.stage}</span>}{p.fork && <span className="dim"> · fork: {p.fork.kind}</span>}<span className={`badge ${p.status}`}>{p.status}</span></div>
    <p className="thread-ask">{p.reason}</p>
    <div className="thread-diff mono">{(p.changes ?? []).length ? p.changes.map(c => <div key={c.key}><span className="k">{c.key}</span> <s className="old">{c.before ?? "(unset)"}</s> <span className="new">{c.after}</span>{c.meaning && <span className="dim sans"> — {c.meaning}{c.material ? "" : " · not material"}</span>}</div>) : Object.entries(p.edits).map(([k, v]) => <div key={k}><span className="k">{k}</span> <span className="new">{v}</span></div>)}</div>
    <div className="thread-check">{p.material_classes?.length ? <span className="badge warn">material · {p.material_classes.map(c => c.replace("_", " ")).join(", ")}</span> : null} validation after <Verdict r={p.after} />{p.after.findings.filter(f => f.level !== "PASS").map((f, i) => <div key={i} className="dim small">{f.level}: {f.rule} — {f.detail}</div>)}</div>
    {p.status === "pending" && <div className="row"><button className="primary" onClick={() => setProposalStatus(p.id, "approved")} disabled={p.after.hasFail}>Approve</button><button className="ghost" onClick={() => setProposalStatus(p.id, "rejected")}>Reject</button>{p.after.hasFail && <span className="dim small" style={{ alignSelf: "center" }}>cannot approve: the edit fails validation</span>}</div>}
  </div>;
}
const SHEET = "(max-width: 700px)";
const pinOf = (stage: string) => document.getElementById(`pin-${stage}`);
/** The threads of one stage as a popover anchored to its pin — a bottom sheet on phones — rendered into body so the pipeline's
    horizontal scroll cannot clip it and it sits above the sticky header. Escape and a click outside close it; focus moves
    in on open and returns to the pin on close. The stage's own .in file and checks stay inline where they were. */
function ThreadPopover({ stage, proposals, onClose }: { stage: string; proposals: Proposal[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; tail: number } | null>(null);
  // Placed in document coordinates so it rides with the page; a resize or the pipeline's own scroll re-places it.
  useLayoutEffect(() => {
    const sheet = window.matchMedia(SHEET);
    const place = () => {
      const el = pinOf(stage); if (!el) return; if (sheet.matches) { setPos(null); return; }
      const r = el.getBoundingClientRect(), box = (el.parentElement ?? el).getBoundingClientRect(), rail = el.closest(".stages")?.getBoundingClientRect();
      const w = Math.min(520, window.innerWidth - 24); const rightEdge = rail && rail.width >= w ? Math.min(rail.right, window.innerWidth - 12) : window.innerWidth - 12;
      const left = Math.max(12, Math.min(r.left - 10, rightEdge - w));
      const next = { top: Math.round(box.bottom + 10 + window.scrollY), left: Math.round(left + window.scrollX), tail: Math.round(r.left + r.width / 2 - left - 6) };
      setPos(p => p && p.top === next.top && p.left === next.left && p.tail === next.tail ? p : next);
    };
    place(); window.addEventListener("resize", place); document.addEventListener("scroll", place, true); sheet.addEventListener("change", place);
    return () => { window.removeEventListener("resize", place); document.removeEventListener("scroll", place, true); sheet.removeEventListener("change", place); };
  }, [stage]);
  useEffect(() => {
    const node = ref.current; if (!node) return;
    node.focus({ preventScroll: true });
    // Bring the pin and the whole popover into view without recentring a page the reader is already looking at.
    const el = pinOf(stage);
    if (el && !window.matchMedia(SHEET).matches) requestAnimationFrame(() => { const top = 72; const pr = el.getBoundingClientRect(), nr = node.getBoundingClientRect(); let dy = 0; if (pr.top < top) dy = pr.top - top; else if (nr.bottom > window.innerHeight - 12) dy = Math.min(nr.bottom - window.innerHeight + 12, pr.top - top); if (dy) window.scrollBy({ top: dy, behavior: "smooth" }); });
    // On close, focus goes back to the pin unless the reader already put it somewhere else (a click on another control).
    return () => { if (!document.activeElement || document.activeElement === document.body) pinOf(stage)?.focus({ preventScroll: true }); };
  }, [stage]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    const down = (e: PointerEvent) => { const t = e.target as Node; if (ref.current?.contains(t) || pinOf(stage)?.contains(t)) return; onClose(); };
    document.addEventListener("keydown", key); document.addEventListener("pointerdown", down);
    return () => { document.removeEventListener("keydown", key); document.removeEventListener("pointerdown", down); };
  // It hangs below the pinned stage's box (name and label stay readable) with the tail on the pin, and stays inside
  // the pipeline's width where that fits, so it does not lie over the sidebar.
  }, [stage, onClose]);
  return createPortal(<>
    <div className="thread-scrim" aria-hidden="true" />
    <div ref={ref} className="thread-popover" id={`threads-${stage}`} role="dialog" aria-label={`proposals pinned at ${stage}`} tabIndex={-1} style={pos ? { top: pos.top, left: pos.left, "--tail-x": `${pos.tail}px` } as CSSProperties : undefined}>
      <div className="thread-popover-head"><span className="kicker">pinned at <span className="mono">{stage}</span>{proposals.length > 1 ? ` · ${proposals.length} proposals` : ""}</span><button type="button" className="linklike thread-close" aria-label="Close the thread" onClick={onClose}>×</button></div>
      <div className="threads">{proposals.map(p => <ProposalThread key={p.id} p={p} />)}</div>
    </div>
  </>, document.body);
}

/** The compare picker: same-system runs first (those are the comparisons that mean something), then the rest; each option carries its id and length. */
function CompareSelect({ idx, self, value, onPick, wide }: { idx: IndexEntry[]; self: string; value: string; onPick: (id: string) => void; wide?: boolean }) {
  const me = idx.find(r => r.id === self);
  const others = idx.filter(r => r.id !== self);
  const same = me ? others.filter(r => sameSystem(r, me)) : [];
  const rest = me ? others.filter(r => !sameSystem(r, me)) : others;
  const label = (r: IndexEntry) => `${r.title} · ${r.id} · ${r.production_ps} ps${r.parent === self ? " · fork of this run" : r.id === me?.parent ? " · parent of this run" : ""}`;
  return <select value={value} className={wide ? "wide" : undefined} aria-label="compare this run with" onChange={e => e.target.value && onPick(e.target.value)}>
    {value === "" && <option value="">compare with…</option>}
    {same.length > 0 && <optgroup label={`same prepared system (${same.length})`}>{same.map(r => <option key={r.id} value={r.id}>{label(r)}</option>)}</optgroup>}
    {rest.length > 0 && <optgroup label={same.length ? `other systems (${rest.length})` : "runs"}>{rest.map(r => <option key={r.id} value={r.id}>{label(r)}</option>)}</optgroup>}
  </select>;
}

/** GitHub's Fork dropdown: the three fork actions from the title bar, no scrolling needed. Escape or an outside click closes it. */
function ForkMenu({ m, ens }: { m: Manifest; ens: ReturnType<typeof ensemble> | null }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!open) return; const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); }; const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); }; document.addEventListener("mousedown", onDoc); document.addEventListener("keydown", onKey); return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); }; }, [open]);
  const kinds = forkKinds(m, ens);
  const jump = () => { setOpen(false); const el = document.getElementById("fork-card"); el?.scrollIntoView({ behavior: "smooth", block: "start" }); el?.classList.add("flash"); setTimeout(() => el?.classList.remove("flash"), 1200); };
  return <div className="fork-menu" ref={ref}>
    <button type="button" className="fork-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)}>Fork <span aria-hidden="true">▾</span></button>
    {open && <div className="menu" role="menu" aria-label="fork this experiment">
      {kinds.map(k => <button key={k.id} type="button" role="menuitem" className="menu-item" onClick={() => { setOpen(false); k.run(); }}>
        <span className="menu-title">{k.title}{k.approval && <span className="badge warn">needs your approval</span>}</span>
        <span className="menu-desc">{k.desc}</span>
        <span className="menu-verb">{k.action} →</span>
      </button>)}
      <button type="button" role="menuitem" className="menu-item menu-more" onClick={jump}>All three, with prompts for your agent ↓</button>
    </div>}
  </div>;
}

/** Fork this experiment: three cards, one primary action each. Reproduce and replicate change no inputs, so they act at once;
    extend changes one variable and is prefilled into the console, where it becomes a proposal that waits for Approve. */
/** The three ways to fork a run, each with its one verb, what it does, and the prompt to hand an agent. */
function forkKinds(m: Manifest, ens: ReturnType<typeof ensemble> | null) {
  const card = `${window.location.origin}${window.location.pathname}#/run/${m.id}`;
  return [
    { id: "reproduce", title: "Reproduce", desc: "Rerun exactly as-is: pinned seeds, same build. Confirms the pipeline replays; it cannot show the result is stable.", action: "Build bundle", approval: false,
      run: () => callTool("generate_rerun_bundle", { run_id: m.id, seed: "pinned", target: "local" }, "page"),
      prompt: `Build the pinned rerun bundle for ${card} and tell me what it contains and what running it would establish.` },
    { id: "replicate", title: "Replicate", desc: ens && ens.all.n > 1 ? `Same protocol, fresh seeds. An executed rerun joins the ${ens.all.n}-run spread above.` : "Same protocol, fresh seeds. An executed rerun starts the run-to-run spread this card lacks.", action: "Plan replicate", approval: false,
      run: () => callTool("fork_experiment", { run_id: m.id, kind: "replicate" }, "page"),
      prompt: `Plan a replicate of ${card}: how many more independent runs are needed and at what length? Then prepare the replicate fork.` },
    { id: "extend", title: "Extend", desc: "Change one variable, hold the rest fixed — e.g. temp0 → 310 K. The controlled diff becomes a proposal pinned to its stages.", action: "Prefill console", approval: true,
      run: () => { set({ console: { tool: "fork_experiment", input: JSON.stringify({ run_id: m.id, kind: "extend", treatment: { key: "temp0", value: "310.0" }, question: "Does binding weaken at 310 K?" }, null, 1) } }); document.getElementById("tool-console")?.scrollIntoView({ behavior: "smooth", block: "start" }); },
      prompt: `Using ${card}, prepare a controlled temperature change and explain what stays fixed. Stop at a pending proposal and wait for my approval.` },
  ];
}
function ForkCards({ m, ens }: { m: Manifest; ens: ReturnType<typeof ensemble> | null }) {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (id: string, text: string) => { try { await navigator.clipboard.writeText(text); setCopied(id); } catch { setCopied(`error:${id}`); } };
  const kinds = forkKinds(m, ens);
  return <div className="card" id="fork-card"><h2>Fork this experiment <span className="dim">reproduce and replicate change no inputs; extend changes one and waits for your approval</span></h2>
    <div className="fork-cards">{kinds.map(k => <div key={k.id} className="fork-card">
      {k.approval && <span className="badge warn">needs your approval</span>}
      <h3>{k.title}</h3><p>{k.desc}</p>
      <div className="fork-actions"><button onClick={k.run}>{k.action}</button><button className="ghost" onClick={() => copy(k.id, k.prompt)} aria-label={`Copy the ${k.title.toLowerCase()} prompt for your agent`}>Copy prompt</button>
        {copied === k.id && <span className="dim small" role="status">Copied</span>}{copied === `error:${k.id}` && <span className="fail small" role="status">Clipboard unavailable</span>}</div>
    </div>)}</div>
  </div>;
}

/** The cpptraj plots as a filterable gallery. The caption is name + family, which is what a computational chemist
    needs; the catalogue's one-clause description sits in the figure's tooltip and in one collapsed key under the gallery. */
function AnalysesCard({ m }: { m: Manifest }) {
  const [filter, setFilter] = useState<AnalysisCategory | "all">("all");
  const [all, setAll] = useState(false);
  const items = Object.entries(m.analyses).filter(([k]) => k !== "plip").map(([k, a]) => ({ key: k, png: a.png, ...analysisInfo(k) }));
  const present = ANALYSIS_CATEGORIES.filter(c => items.some(i => i.category === c));
  // Three plots carry the story: stability, one interaction view, one ensemble view. The rest are one click away.
  const featured = [["rmsd", "rg"], ["hbond", "rmsf", "dssp"], ["fel", "cluster", "pca"]].map(ks => ks.map(k => items.find(i => i.key === k)).find(Boolean)).filter((i): i is typeof items[number] => !!i);
  const shown = all ? items.filter(i => filter === "all" || i.category === filter) : featured;
  return <div className="card"><h2>Analyses <span className="dim">cpptraj · {all || featured.length >= items.length ? `${items.length} plots` : `${featured.length} featured of ${items.length}`}</span></h2>
    {all && present.length > 1 && <div className="pills" role="group" aria-label="filter analyses by family">
      {(["all", ...present] as const).map(c => <button key={c} type="button" className={`pill ${filter === c ? "on" : ""}`} aria-pressed={filter === c} onClick={() => setFilter(c)}>{c}{c !== "all" && <span className="count">{items.filter(i => i.category === c).length}</span>}</button>)}
    </div>}
    <div className="gallery">{shown.map(i => <figure key={i.key} className="analysis" title={i.shows || undefined}>
      <figcaption><b>{i.name}</b><span className="dim">{i.category}</span></figcaption>
      <a href={`/runs/${m.id}/${i.png}`} target="_blank" rel="noopener" title={`open ${i.png} full size`}><img src={`/runs/${m.id}/${i.png}`} alt={`${i.name} plot`} loading="lazy" /></a>
    </figure>)}</div>
    {items.length > featured.length && <button type="button" className="ghost" onClick={() => setAll(a => !a)} aria-expanded={all}>{all ? "Featured only" : `All ${items.length} analyses ▸`}</button>}
    {shown.some(i => i.shows) && <details className="small plots-key"><summary>What these plots show</summary>
      <dl>{shown.filter(i => i.shows).map(i => <div key={i.key}><dt>{i.name}</dt><dd>{i.shows}</dd></div>)}</dl>
    </details>}
  </div>;
}

/** GitHub's network graph for an experiment: the parent, the runs re-executed from its bundle, and whether they agree.
    The verdict is computed (forkNetwork); tension is shown in amber, not hidden, because surfacing it is the point. */
function ForkNetworkCard({ net, compact }: { net: ReturnType<typeof forkNetwork>; compact?: boolean }) {
  const Node = ({ n, role }: { n: ReturnType<typeof forkNetwork>["parent"]; role: "parent" | "fork" }) => <a className={`node ${role}`} href={`#/run/${n.id}`}>
    <span className="node-id mono">{n.owner && <span className="node-owner">{n.owner}/</span>}{n.id}</span><span className="dim">{n.engine} · {n.production_ps} ps{role === "fork" && n.kind ? ` · ${n.kind}${n.seed === "fresh" ? ", fresh seeds" : ""}${n.complete === false ? ", partial" : ""}` : ""}</span><span className="node-dg mono">{fmt(n.delta_g)}</span>
  </a>;
  return <section className="card network" aria-labelledby={`network-${net.parent.id}`}>
    <h2 id={`network-${net.parent.id}`}>Fork network <span className="dim">{compact ? `${net.n} reruns of ${net.parent.id}` : `${net.n} runs re-executed from ${net.parent.id}'s rerun bundle, each a card that points back at its parent`}</span></h2>
    <div className="tree">
      <Node n={net.parent} role="parent" />
      <ul className="forks">{net.forks.map(f => <li key={f.id}><Node n={f} role="fork" /></li>)}</ul>
    </div>
    <p className="verdict">{net.verdict}</p>
    {!compact && <p className="dim small">ΔG in kcal/mol, MM-GBSA. Agreement is judged against the observed run-to-run SD of the whole same-system cohort — a fork is a rerun, and this is the check a rerun exists to make.</p>}
  </section>;
}

/** Requests to hand an agent, written for the run on screen. Code blocks, not textareas: a prompt is text
    you copy out, not a field you fill in. The partner is a same-system peer where one exists. */
function AgentPrompts({ runId, partnerId }: { runId: string; partnerId?: string }) {
  const [copied, setCopied] = useState<string | null>(null);
  const card = (id: string) => `${window.location.origin}${window.location.pathname}#/run/${id}`;
  const prompts = [
    { id: "evidence", label: "Inspect the evidence", text: `Check what supports this result and what is still uncertain. Use the tools on ${card(runId)} and do not claim more than the evidence supports.` },
    ...(partnerId ? [{ id: "compare", label: "Check comparability", text: `Check whether ${runId} and ${partnerId} are comparable and explain their differences. Start from ${card(runId)} and investigate before drawing a conclusion.` }] : []),
  ];
  const copy = async (id: string, text: string) => { try { await navigator.clipboard.writeText(text); setCopied(id); } catch { setCopied(`error:${id}`); } };
  return <>
    <p className="dim small">Ask your agent — each request names this run's card URL.</p>
    <div className="request-examples" aria-label="Example requests for your agent">{prompts.map(p => <div className="request" key={p.id}>
      <h3>{p.label}</h3><pre className="small">{p.text}</pre>
      <button className="ghost" onClick={() => copy(p.id, p.text)} aria-label={`Copy the ${p.label.toLowerCase()} prompt`}>Copy prompt</button>
      {copied === p.id && <span className="dim small" role="status">Copied</span>}{copied === `error:${p.id}` && <span className="fail small" role="status">Clipboard unavailable — select the text above.</span>}
    </div>)}</div>
  </>;
}

/** Settled load failure: the message names the run and the cause; the reader can go back or retry (the loader evicts failed loads, so retry refetches). */
function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <section>
    <div className="interp warn" role="alert">{message}</div>
    <p><a href="#/">← back to the run list</a> <button className="ghost" onClick={onRetry}>retry</button></p>
  </section>;
}
/** The Approve button is the point of a proposal: scroll the thread into view, not just the stage's dot. */
function RunPage({ id, idx, own }: { id: string; idx: IndexEntry[]; own: Owners | null }) {
  const [m, setM] = useState<Manifest | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  // Which stage's proposal thread is open as a popover under its pin; independent of the inline stage detail.
  const [thread, setThread] = useState<string | null>(null);
  const closeThread = useCallback(() => setThread(null), []);
  const investigation = useStore(s => s.investigations[id]);
  const re = investigation?.reanalysis?.value;
  // Proposals are comments pinned to the stage they target. Filter outside the selector (React #185).
  const runProposals = useStore(s => s.proposals).filter(p => p.run === id);
  const openStage = useStore(s => s.openStage);
  const seenProposal = useRef<string | null>(null);
  // A new pending proposal on this run opens its thread, so the reader sees what the agent asked for without hunting.
  useEffect(() => { const p = runProposals[0]; if (p && p.status === "pending" && seenProposal.current !== p.id) { seenProposal.current = p.id; setThread(p.stage); } }, [runProposals]);
  useEffect(() => { if (openStage) { setThread(openStage); set({ openStage: null }); } }, [openStage]);
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
  const ladder = idx.length ? confidenceLadderFull(m, idx) : null;
  const explanation = idx.length ? explainResult(m, idx) as any : null;
  const net = idx.length ? forkNetwork(idx, id) : null;
  return (
    <section className="run">
      <nav className="crumbs" aria-label="breadcrumb"><a href="#/">projects</a><span aria-hidden="true">/</span>{(() => { const c = projectOf(idx, id); return c ? <><a href={`#/p/${c.slug}`}>{c.title}</a><span aria-hidden="true">/</span></> : null; })()}<span className="mono">{m.id}</span></nav>
      <div className="titlebar"><h1>{describeSystem(m.title, m.system.ligand.resname ?? "")?.name ?? m.title}</h1><span className="dim">{m.id}</span>
        {m.parent && <a className="badge fork" href={`#/run/${m.parent}`}>fork of {qualified(idx, m.parent)}</a>}
        <ForkMenu m={m} ens={ens} />
        {net && net.n > 0 && <a className={`badge fork ${net.status === "agree" ? "pass" : net.status === "tension" ? "warn" : ""}`} href={`#network-${m.id}`}>{net.n} forks{(() => { const by = [...new Set(net.forks.map(f => f.owner).filter(o => o && o !== net.parent.owner))]; return by.length ? ` by ${by.join(", ")}` : ""; })()} · {net.status === "agree" ? "agree" : net.status === "tension" ? "in tension" : "sign only"}</a>}
        <CompareSelect idx={idx} self={id} value="" onPick={other => navigate(`/compare/${id}/${other}`)} /></div>
      {/* Lineage is identity, not provenance trivia: a replicate has to say what it replicates before it shows
          a number, or a reader takes its ΔG for an independent measurement of a different thing. */}
      {m.parent && <p className="lineage">{m.fork?.kind === "replicate" ? "Independent replicate of" : m.fork?.kind ? `${m.fork.kind} of` : "Derived from"} <a href={`#/run/${m.parent}`}>{qualified(idx, m.parent)}</a>{m.fork?.seed === "fresh" ? " — same prepared system and protocol, fresh seeds" : ""}{m.fork?.complete === false ? " — partially applied" : ""}.</p>}

      {/* Run metadata, one line: who, which engine, how long, which seed. The result comes next, then what qualifies it. */}
      <div className="summary-strip">
        {(() => { const o = ownerOf(idx, id); return o ? <span><a href={`#/u/${o}`}>{own?.profiles[o]?.name ?? o}</a> <span className="mono dim">@{o}</span></span> : null; })()}
        <span><b>{prod?.engine ?? m.environment.pmemd}</b></span><span>{prod?.length_ps != null ? `${prod.length_ps} ps production` : "no production stage"}</span><span>seed <span className="mono">{prod?.realized_seed ?? "—"}</span></span>
      </div>

      <div className={m.results.plip ? "grid2" : ""}>
        <div className="card">
          <h2>Binding free energy <span className="dim">MM-GBSA, single trajectory{mm?.params?.entropy === "0" ? ", no entropy term" : ""}</span></h2>
          {mm ? <>
            {/* Headline: this run's ΔG with the uncertainty the page argues for (run-to-run SD), then the rows in order of what matters; the mechanics are one disclosure away. */}
            <div className="big">{fmt(mm.delta_total_kcal_mol)}{spreadSd != null && <> ± {fmt(spreadSd)}</>} <span className="unit">kcal/mol</span>{u && u.verdict !== "no drift detected" && <> <span className="badge warn" title="halves test within the archived window">{u.verdict}</span></>}</div>
            {mm.per_frame && <Sparkline x={mm.per_frame.delta_total} lengthPs={prod?.length_ps ?? null} window={re ? { start: re.window.start_frame, end: re.window.end_frame } : undefined} />}
            <p className="dim small">{spreadSd != null
              ? <>± is the run-to-run SD across the independent runs of this system (the row below): the uncertainty to quote; the within-run SEM is not.</>
              : u ? <>single run of this system: the within-run corrected SEM below does not estimate run-to-run uncertainty — no spread can be quoted until three independent runs exist.</> : null}</p>
            <dl>
              {ens && ens.all.n > 1 && <><dt>run-to-run</dt><dd><b>n={ens.all.n}</b>: mean {fmt(ens.all.mean)}, SD {fmt(ens.all.sd)}, range {fmt(ens.all.min)} … {fmt(ens.all.max)}
                {ens.long.n > 0 && ens.long.n < ens.all.n && <><br /><b>n={ens.long.n}</b> runs ≥ {ens.long.min_ps} ps: mean {fmt(ens.long.mean)}, SD {fmt(ens.long.sd)}, range {fmt(ens.long.min)} … {fmt(ens.long.max)}</>}
                <span className="dim"> — observed run-to-run variation from one prepared start at {[...new Set(ens.all.runs.map(r => r.production_ps))].sort((x, y) => x - y).join(", ")} ps; seeds and lengths differ{ens.engines.length > 1 ? `, and so do engines (${ens.engines.map(e => `${e.engine} × ${e.n}`).join(", ")})` : ""}</span></dd></>}
              {u && <><dt>within run</dt><dd>corrected SEM <b>{fmt(u.corrected_sem, 3)}</b> (g = {u.statistical_inefficiency_g}, N<sub>eff</sub> ≈ {u.n_eff}) · halves {fmt(u.halves.first)} → {fmt(u.halves.second)} · <b>{u.verdict}</b> <span className="dim">(halves test over {prod?.length_ps ?? "?"} ps)</span></dd></>}
              {re && <><dt>current reanalysis</dt><dd>frames {re.window.start_frame}–{re.window.end_frame}{re.window.interval > 1 ? ` every ${re.window.interval}th` : ""} ({re.window.frames_used} frames{re.window.start_ps != null ? `, ${re.window.start_ps}–${re.window.end_ps} ps` : ""}) → <b>{fmt(re.delta_g.mean)} ± {fmt(re.delta_g.corrected_sem)}</b>, {re.delta_g.verdict} <span className="dim">(recomputed in the browser from the archived per-frame energies; ± is the corrected SEM; the archived value above is unchanged)</span></dd></>}
              <dt>method</dt><dd>MM-GBSA igb={mm.igb}, saltcon={mm.saltcon} · computed {mm.run_on}</dd></dl>
            <details className="small"><summary className="dim">how these numbers were computed</summary>
              <p className="dim">Per-frame: population SD {fmt(mm.frame_std)}, naive SEM {fmt(mm.frame_sem, 3)} over {mm.frames} frames (every {mm.params?.interval ?? "?"}th of {mm.params?.endframe ?? "?"}); frames are correlated, so the naive SEM understates the within-run uncertainty.{mm.frames_header_text && mm.frames_header_text !== String(mm.frames) ? ` The mmgbsa.dat header prints "${mm.frames_header_text}" — (endframe−startframe)/interval+1 un-floored; the count here is from the per-frame blocks.` : ""}</p>
              {u && <p className="dim">Corrected SEM = SD·√(g/N) with g = 1 + 2Σ(1−t/N)C(t) (τ = {u.integrated_autocorrelation_time_frames} frames); drift verdict: {u.thresholds.drifting_if}; too short if {u.thresholds.too_short_if}. Reconstructed from the per-frame mdout files; the full window reproduces mmgbsa.dat exactly.</p>}
            </details>
            {mm.warnings.map((w, i) => { const quiet = resid != null && resid.fraction_of_delta_g < 1e-3; const pct = resid ? `${(resid.fraction_of_delta_g * 100).toFixed(3)} %` : null; return <details key={i} className={`warnstatus ${quiet ? "quiet" : ""}`}>
              <summary><span className="badge warn">archived warning</span> <b>MMPBSA warned about its internal terms — investigated.</b> {resid ? <>Residual {pct} of ΔG · status: <b>{quiet ? "retained caveat, not outcome-determining" : "open caveat"}</b>.</> : <>Status: <b>open caveat</b>; no per-frame data to size it.</>} <span className="dim">verbatim ▾</span></summary>
              <p className="warn-verbatim">⚠ {w}</p>
              <p className="dim small">Recorded from mmgbsa.dat — shown lowercased; the file prints it in capitals.{resid ? ` The internal-term residual it accompanies: ${resid.total.mean} ± ${resid.total.sd} kcal/mol per frame (${(resid.fraction_of_delta_g * 100).toFixed(3)} % of ΔG), from ${resid.dominant_term}; the exact trigger is not recorded, so this is consistent with the warning, not its proven cause${quiet ? " — below 0.1 % of ΔG, shown for the record" : ""}.` : " Ask the agent to explain_result for what it means."}</p></details>; })}
          </> : <p className="dim">no MM-GBSA result</p>}
        </div>
        {m.results.plip && <div className="card">
          <h2>Contacts <span className="dim">PLIP on the medoid frame</span></h2>
          <dl>{Object.entries(m.results.plip.interactions).map(([k, v]) => <div key={k}><dt>{k.replace("_", " ")}</dt><dd>{v.map(x => x.residue).join(", ")}</dd></div>)}</dl>
          <div className="dim small" style={{ marginTop: 6 }}>frame {m.results.plip.frame?.index} of {m.results.plip.frame?.nframes} ({m.results.plip.frame?.policy})</div>
          {m.analyses.plip && <div className="dim small"><a href={`/runs/${m.id}/plip.png`} target="_blank" rel="noopener">PLIP interaction chart (plip.png)</a></div>}
        </div>}
      </div>

      <h2 className="section-label">can I trust it?{ladder && <span className="badge pass">{ladder.verified_of_assessable} assessed rungs verified</span>}</h2>
      {net && net.n > 0 && <ForkCallout net={net} detailHref={`#network-${m.id}`} onReplicate={() => forkKinds(m, ens).find(k => k.id === "replicate")?.run()} />}
      {ladder && <EvidenceOverview ladder={ladder} explanation={explanation} investigation={investigation} validationVerdict={overall} />}
      {ladder && (() => { const L = ladder; const cls = (s: string) => s === "verified" ? "pass" : s === "not established" ? "warn" : s === "partly established" ? "partly" : ""; return <div className="card">
        <h2>Confidence ladder <span className="dim">computed from the archived data{L.rungs.some(r => r.status === "partly established") ? ` · ${L.rungs.filter(r => r.status === "partly established").length} partly established` : ""} · 1 not assessed</span></h2>
        <ol className="ladder">{L.rungs.map((r, i) => <li key={r.rung} className={r.status === "not assessed" ? "dim" : ""}><span className="dim mono">{i + 1}.</span> <span className={`badge ${cls(r.status)}`}>{r.status}</span> <b>{r.rung}</b> <span className="dim">— {r.short}</span>
          <details className="small"><summary className="dim">evidence</summary><p className="dim">{r.evidence}{r.to_climb ? <> · <i>to climb: {r.to_climb}</i></> : null}</p></details></li>)}</ol>
      </div>; })()}

      <h2 className="section-label">what happened</h2>
        {m.structure && <Boundary label="Structure"><div className="card"><h2>Structure <span className="dim">cluster medoid, dry</span></h2><Viewer url={`/runs/${m.id}/${m.structure}`} ligand={m.system.ligand.resname} /></div></Boundary>}
      <AnalysesCard m={m} />

      <h2 className="section-label">build on it</h2>
      <ForkCards m={m} ens={ens} />
      {net && net.n > 0 && <ForkNetworkCard net={net} compact />}
      <CurrentInvestigation runId={id} investigation={investigation} partnerId={ens?.all.runs.find(r => r.id !== m.id)?.id ?? others[0]?.id} />

      <h2 className="section-label">how it was produced</h2>
      <div className="card">
        <h2>Stages <span className={`badge ${overall.toLowerCase()}`}>input checks {overall}</span></h2>
        <p className="dim small">11 rules on each .in file (timestep vs SHAKE, cutoff, thermostat, barostat, restarts, seeds, output cadence): a sanity check of the input files, not evidence of convergence or physical accuracy and not a rung of the confidence ladder — select a stage for its input and findings.</p>
        {/* Each stage is a native disclosure button: Tab reaches it, Enter/Space toggle it, aria-expanded carries the state. The arrow is decoration. */}
        <div className="stages">{m.stages.map((s, i) => <div key={s.name} className={`stage ${open === s.name ? "open" : ""}`}>
          {i > 0 && <span className="arrow" aria-hidden="true">→</span>}
          <button type="button" className="stagebox" id={`stage-${s.name}`} aria-expanded={open === s.name} aria-controls={open === s.name ? "stagedetail" : undefined} onClick={() => setOpen(open === s.name ? null : s.name)}>
            <span className="stagename">{s.name}</span><span className="dim">{s.role}{s.length_ps != null ? ` · ${s.length_ps} ps` : ""}</span>
            <span className="dim">{s.cntrl.temp0 ? `${s.cntrl.temp0} K` : ""}{s.role === "minimization" ? "" : s.cntrl.ntp === "1" ? " NPT" : s.cntrl.ntb === "1" ? " NVT" : ""}{s.cntrl.ntr === "1" ? " restrained" : ""}</span>
            {verdictOf(reports[s.name]) !== overall || overall !== "PASS" ? <Verdict r={reports[s.name]} /> : null}</button>
          <ProposalPin stage={s.name} proposals={runProposals.filter(p => p.stage === s.name)} expanded={thread === s.name} onToggle={() => setThread(t => t === s.name ? null : s.name)} /></div>)}</div>
        {thread && runProposals.some(p => p.stage === thread) && <ThreadPopover stage={thread} proposals={runProposals.filter(p => p.stage === thread)} onClose={closeThread} />}
        {open && (() => { const s = m.stages.find(x => x.name === open)!; const r = reports[open]; return <div className="stagedetail" id="stagedetail" role="region" aria-labelledby={`stage-${open}`}>
          <div><h3>{s.name}.in</h3><pre>{s.mdin}</pre>
            <div className="dim">restarts from {s.restart_from || "initial coordinates"} · {s.role === "minimization" ? `seed ${s.realized_seed ?? "n/a"} (unused by minimization)` : `requested ig=${s.requested_seed ?? "unset (pmemd default -1)"} → realized seed ${s.realized_seed ?? "n/a"}`} · wall {s.wall_s ?? "?"} s · {s.finished ? "finished" : "not finished"}{s.envelope?.crashes?.length ? ` · crashes: ${s.envelope.crashes.join(", ")}` : ""}</div></div>
          <div><h3>Validation</h3><ul className="findings">{r.findings.map((f, i) => <li key={i}><span className={`badge ${f.level.toLowerCase()}`}>{f.level}</span> <b>{f.rule}</b> — {f.detail}</li>)}</ul></div>
        </div>; })()}
      </div>
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
      <div className="card"><h2>Provenance</h2>
        <dl>{m.parent && <><dt>derived from</dt><dd><a href={`#/run/${m.parent}`}>{m.parent}</a>{m.fork ? <span className="dim"> · {m.fork.kind}{m.fork.seed ? `, ${m.fork.seed} seed` : ""}{m.fork.complete === false ? ", partially applied" : ""}</span> : null}</dd></>}
          <dt>pipeline stages</dt><dd className="mono">{Object.entries(m.pipeline.stage_envelopes).map(([k, ok]) => `${k}:${ok ? "ok" : "FAILED"}`).join("  ")} <span className="dim">({m.pipeline.skills.join(" → ")})</span></dd>
          <dt>environment</dt><dd className="mono">{Object.entries(m.environment.conda_lock).map(([k, v]) => `${k}=${v}`).join("  ")} <a href="/runs/env.lock.yml" target="_blank">full lock</a></dd>
          <dt>seeds</dt><dd className="mono">{m.stages.map(s => `${s.name}:${s.realized_seed ?? "-"}`).join("  ")}</dd>
          <dt>leap.in</dt><dd><pre className="small">{m.system.leap_in}</pre></dd></dl></div>
    </section>
  );
}

function EvidenceOverview({ ladder, explanation, investigation, validationVerdict }: { ladder: ReturnType<typeof confidenceLadderFull>; explanation: any; investigation?: InvestigationState; validationVerdict: string }) {
  const missing = ladder.rungs.filter(r => r.status !== "verified");
  const replicate = ladder.rungs.find(r => r.rung === "independently replicated");
  const plan: any = investigation?.samplingPlan?.value;
  return <section className="evidence-overview" aria-labelledby="evidence-overview-title">
    <h2 id="evidence-overview-title">Evidence overview <span className="dim">what this record supports before you build on it</span></h2>
    <div className="evidence-grid">
      <div><h3>Checks supporting it</h3><p>{ladder.rungs.filter(r => r.status === "verified").map(r => r.rung).join(", ")}. Input sanity checks: <span className={`badge ${validationVerdict.toLowerCase()}`}>{validationVerdict}</span>. A passing input check is not convergence or physical accuracy.</p></div>
      <div><h3>Still unestablished</h3><p>{missing.map(r => `${r.rung}: ${r.status}`).join("; ")}. {explanation?.within_run?.verdict ? `Archived-window verdict: ${explanation.within_run.verdict}.` : "Within-run drift could not be assessed."}</p></div>
      <div><h3>Next relevant action</h3><p>{replicate?.to_climb ?? "Inspect the detailed evidence below."}</p>{plan && <p className="dim small"><b>Separate precision target:</b> {plan.recommendation}</p>}</div>
    </div>
  </section>;
}

function CurrentInvestigation({ runId, investigation, partnerId }: { runId: string; investigation?: InvestigationState; partnerId?: string }) {
  // Subscribe to the stable array and filter outside the selector: useStore passes the selector straight to
  // useSyncExternalStore as getSnapshot, so returning a fresh array here re-renders without end (React #185).
  const proposals = useStore(s => s.proposals).filter(p => p.run === runId);
  const [message, setMessage] = useState<string | null>(null);
  const auto: any = investigation?.automode;
  const re = investigation?.reanalysis; const plan: any = investigation?.samplingPlan; const forks = Object.values(investigation?.forks ?? {}); const bundle = investigation?.bundle?.value; const brief = investigation?.brief?.value;
  const downloadBlob = (content: BlobPart, type: string, filename: string) => { const url = URL.createObjectURL(new Blob([content], { type })); const a = document.createElement("a"); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url); };
  const prepare = async () => { const raw = await callTool("export_evidence_brief", { run_id: runId, include_session: true }, "page"); const out = JSON.parse(raw); setMessage(out.error ? out.error : "Evidence brief prepared."); };
  const copyBrief = async () => { if (!brief) return; try { await navigator.clipboard.writeText(brief.markdown); setMessage("Brief copied."); } catch { setMessage("Clipboard unavailable — the prepared Markdown remains available to download."); } };
  const hasActivity = !!(auto || re || plan || forks.length || proposals.length || bundle);
  return <section className="card investigation" aria-labelledby="investigation-title">
    <h2 id="investigation-title">Current investigation <span className="dim">completed actions from this visit, scoped to {runId}</span></h2>
    {!hasActivity && <p className="dim">No transient analysis or follow-up has been prepared for this run. Ask an agent one of the example questions, or use the Tool Console.</p>}
    {auto && <div className="investigation-item"><h3>Automode investigation <Source source={auto.source} /></h3>
      <p>{auto.value.summary}</p>
      <ol className="trace">{auto.value.steps.map((s: any, i: number) => <li key={i}><b className="mono">{s.tool}</b> <span className="dim">— {s.why}</span><div>{s.found}</div></li>)}</ol>
      {auto.value.next && <p><b>Next:</b> {auto.value.next.rationale}{auto.value.next.tool && <> <span className="dim">— </span><button className="ghost" onClick={() => { set({ console: { tool: auto.value.next.tool, input: JSON.stringify(auto.value.next.input, null, 1) } }); document.getElementById("tool-console")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>prefill {auto.value.next.tool} →</button></>}</p>}
      <p className="dim small">{auto.value.created}</p></div>}
    {re && <div className="investigation-item"><h3>Reanalysis <Source source={re.source} /></h3><p>Frames {re.value.window.start_frame}–{re.value.window.end_frame}{re.value.window.interval > 1 ? ` every ${re.value.window.interval}th` : ""}: <b>{fmt(re.value.delta_g.mean)} ± {fmt(re.value.delta_g.corrected_sem)} kcal/mol</b>, {re.value.delta_g.verdict}. Difference from archive: {fmt(re.value.vs_archived.diff)} kcal/mol. The archive is unchanged.</p></div>}
    {plan && <div className="investigation-item"><h3>Sampling plan <Source source={plan.source} /></h3><p><span className="badge warn">expected, not measured</span> Target ±{fmt(plan.value.target_uncertainty_kcal)} kcal/mol on the ensemble mean. {plan.value.recommendation}</p>{plan.value.run_to_run.n_needed_range && <p className="dim small">Estimation range n={plan.value.run_to_run.n_needed_range.low}–{plan.value.run_to_run.n_needed_range.high}. Principal assumptions: {plan.value.assumptions.join(" ")}</p>}</div>}
    {forks.map(f => { const v: any = f.value; return <div className="investigation-item" key={v.fork_id}><h3>{v.kind} fork <Source source={f.source} /></h3><p>{v.question || v.tests}</p>{v.treatment && <p><b>{v.treatment.key}</b>: {Object.entries(v.treatment.from).map(([s, x]) => `${s} ${x}`).join(", ")} → {v.treatment.to}; changed stages: {v.stages_changed.join(", ")}.</p>}<p className="dim small">{v.stages_unchanged_note || v.controls_note}</p></div>; })}
    {proposals.length > 0 && <div className="investigation-item"><h3>Human review</h3><p>{proposals.map(p => <span key={p.id} className={`proposal-chip ${p.status}`}>{p.stage}: {p.status}</span>)}</p><p className="dim small">Approval and rejection remain human actions in the Proposals panel.</p></div>}
    {bundle && <div className="investigation-item"><h3>Prepared rerun bundle <Source source={investigation!.bundle!.source} /></h3><p><b>{bundle.name}</b> · {bundle.appliedProposalIds.length} approved proposal{bundle.appliedProposalIds.length === 1 ? "" : "s"} captured at generation · {bundle.selfContained ? "self-contained" : `missing ${bundle.missingInputs.join(", ")}`}. Prepared does not mean simulated.</p>{bundle.forks.map(f => <p className={f.complete ? "dim small" : "warnbox"} key={f.id}>Fork {f.id}: {f.complete ? "complete at generation" : `partially approved — ${f.missingStages.join(", ")} not applied`}.</p>)}{bundle.combinesMultipleForks && <p className="warnbox">This bundle combines multiple fork questions.</p>}
      <details className="small"><summary className="dim">{Object.keys(bundle.files).length} files in this bundle</summary><pre className="small">{Object.keys(bundle.files).join("\n")}</pre></details>
      <button onClick={() => downloadBlob(zipBundle(bundle.files) as BlobPart, "application/zip", bundle.name)}>Download bundle</button></div>}
    <AgentPrompts runId={runId} partnerId={partnerId} />
    <div className="investigation-actions"><button onClick={prepare}>Prepare evidence brief</button>{brief && <><button className="ghost" onClick={copyBrief}>Copy brief</button><button className="ghost" onClick={() => downloadBlob(brief.markdown, "text/markdown;charset=utf-8", brief.filename)}>Download Markdown</button><span className="dim small">snapshot {new Date(brief.generatedAt).toLocaleString()}</span></>}</div>
    {message && <p role="status" className={message.includes("unavailable") ? "fail small" : "dim small"}>{message}</p>}
  </section>;
}

function Source({ source }: { source: string }) { return <span className="source-label">via {source === "webmcp" ? "agent / WebMCP" : source === "console" ? "the console" : "page action"}</span>; }

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
    <nav className="crumbs" aria-label="breadcrumb"><a href="#/">projects</a><span aria-hidden="true">/</span>{(() => { const c = projectOf(idx, a); return c ? <><a href={`#/p/${c.slug}`}>{c.title}</a><span aria-hidden="true">/</span></> : null; })()}<a href={`#/run/${a}`}>{a}</a><span aria-hidden="true">/</span><span>compare with <span className="mono">{b}</span></span></nav>
    <div className="titlebar"><h1>Compare two <em>runs</em></h1><span className="dim"><a href={`#/run/${a}`}>{a}</a> vs <a href={`#/run/${b}`}>{b}</a></span>
      <CompareSelect idx={idx} self={a} value={b} onPick={other => navigate(`/compare/${a}/${other}`)} wide /></div>
    {/* The verdict first, in bold; the reasoning under it; the numbers live once, in the table below. */}
    <div className={`interp ${d.same_system ? "" : "warn"}`}><b>{d.verdict}</b><div className="dim">{d.interpretation}</div></div>
    <div className={d.system.length > 0 ? "grid2" : ""}>
      <div className="card"><h2>ΔG <span className="dim">kcal/mol{d.same_system ? "" : " · listed, not compared"}</span></h2><table><thead><tr><th>run</th><th className="num">ΔG</th></tr></thead><tbody><tr><td>{a}</td><td className="num">{fmt(d.delta_g.a)}</td></tr><tr><td>{b}</td><td className="num">{fmt(d.delta_g.b)}</td></tr>
        {d.run_to_run_spread && <tr><td>run-to-run mean ± SD (n={d.run_to_run_spread.all.n})</td><td className="num">{fmt(d.run_to_run_spread.all.mean)} ± {fmt(d.run_to_run_spread.all.sd)}</td></tr>}
        {d.delta_g.diff != null && <tr><td>ΔΔG ({a} − {b}){d.delta_g_vs_noise ? <span className="dim"> · √2·SD = {fmt(d.delta_g_vs_noise.sd_of_difference)}</span> : null}</td><td className="num">{fmt(d.delta_g.diff)}</td></tr>}</tbody></table>
        <div className="dim mono small">seeds {a}: {d.realized_seeds.a.join(" ")}<br />seeds {b}: {d.realized_seeds.b.join(" ")}</div>
        {d.system.length === 0 && <div className="dim small" style={{ marginTop: 8 }}>identical prepared system{d.stages.length === 0 ? <>; stage inputs identical across all {d.stages_compared} stages (every &amp;cntrl key compared, seeds excluded) — {d.engines.differ ? <>the seeds above and the engine ({d.engines.a} vs {d.engines.b}) differ</> : <>only the seeds above differ</>}</> : d.engines.differ ? <>; the engines differ too ({d.engines.a} vs {d.engines.b}), which no &amp;cntrl key records</> : null}</div>}</div>
      {d.system.length > 0 && <div className="card"><h2>System</h2><table><thead><tr><th>field</th><th>{a}</th><th>{b}</th></tr></thead><tbody>{d.system.map(s => <tr key={s.field}><td>{s.field.replace(/_/g, " ")}</td><td className="mono">{show(s.a)}</td><td className="mono">{show(s.b)}</td></tr>)}</tbody></table></div>}
    </div>
    {d.stages.length > 0 && <div className="card"><h2>Stage parameters</h2>{d.stages.map(s => <div key={s.stage}><h3>{s.stage}</h3><table><thead><tr><th>key</th><th>meaning</th><th>{a}</th><th>{b}</th><th>material?</th></tr></thead><tbody>{s.changes.map(c => <tr key={c.key} className={c.material ? "" : "dim"}><td className="mono">{c.key}</td><td>{c.meaning}</td><td className="mono">{c.a}</td><td className="mono">{c.b}</td><td>{c.material ? <span className="badge warn">material · {c.class.replace("_", " ")}</span> : <span className="badge">{d.same_system ? "not material" : "moot across systems"} · {c.class.replace("_", " ")}</span>}</td></tr>)}</tbody></table></div>)}</div>}
    {d.system.length > 0 && d.stages.length === 0 && <p className="dim small">no parameter differences (seeds excluded)</p>}
  </section>;
}

function Sidebar({ idx }: { idx: IndexEntry[] }) {
  const allProposals = useStore(s => s.proposals); const calls = useStore(s => s.calls);
  const route = useStore(s => s.route); const webmcp = useStore(s => s.webmcp); const pre = useStore(s => s.console);
  const [tool, setTool] = useState(TOOLS[0].name); const [input, setInput] = useState("{}"); const [out, setOut] = useState(""); const [dout, setDout] = useState(""); const [touched, setTouched] = useState(false);
  // One card invites the agent: the action an agent would take for the page on screen, run from the page. The 17-tool
  // developer console is folded under it (mode "manual" = unfolded); a page button that drafts a call unfolds it.
  const [mode, setMode] = useState<"auto" | "manual">("auto");
  const [pOpen, setPOpen] = useState(false);
  const callRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (pre) { setTool(pre.tool); setInput(pre.input); setDout(""); setTouched(true); setMode("manual"); set({ console: null }); setTimeout(() => callRef.current?.focus(), 50); } }, [pre]);
  // Prefill run_id with the run on screen, so "pick explain_result, press Call" works on a run page.
  // The run on screen: a run page's run, or the first run of a compare page (so Investigate stays scoped there too).
  const currentRun = route.startsWith("/run/") || route.startsWith("/compare/") ? route.split("/")[2] || "" : "";
  // On a project page the agent action is on its longest run; on home there is no run, so the action is "what is here".
  const project = route.startsWith("/p/") && idx.length ? cohorts(idx).find(c => c.slug === decodeURIComponent(route.split("/")[2] || "")) ?? null : null;
  const target = currentRun || project?.runs[0]?.id || "";
  const context: "run" | "project" | "site" = currentRun ? "run" : project ? "project" : "site";
  const projectNet = project && idx.length ? forkNetworks(idx).find(n => project.runs.some(r => r.id === n.parent.id)) ?? null : null;
  // The approval queue is global on purpose: list_proposals is unfiltered, so scoping this list to the
  // route would let a pending proposal sit unseen while the panel said "None yet". Each card names its run.
  const proposals = [...allProposals].sort((a, b) => Number(b.run === currentRun) - Number(a.run === currentRun));
  // The demo proposal: prefills propose_change into the developer console; the human presses Call, then Approve on the pinned thread.
  const draftProposal = () => { const run = currentRun || "1l2y-rep4"; set({ console: { tool: "propose_change", input: JSON.stringify({ run_id: run, stage: "product", edits: { dt: "0.001" }, reason: "halve the timestep — a test of the proposal flow" }, null, 1) } }); if (!currentRun) navigate(`/run/${run}`); };
  // What a judge with a connected agent can type: one sentence naming the page, copyable.
  const askPrompt = context === "site" ? "What is on this site, and which run should I start with?" : `Investigate ${target} on this page and tell me what to do next.`;
  const [copied, setCopied] = useState(false);
  const copyAsk = async () => { try { await navigator.clipboard.writeText(askPrompt); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { setCopied(false); } };
  const prefill = (name: string) => { const props: any = (TOOLS.find(x => x.name === name)!.inputSchema as any).properties ?? {}; return JSON.stringify(currentRun && props.run_id ? { run_id: currentRun } : currentRun && props.run_a ? { run_a: currentRun, run_b: "" } : {}); };
  // On a run page the most useful first call is explain_result for that run — until the human picks a tool themselves.
  useEffect(() => { if (!touched) { if (target) { setTool("explain_result"); setInput(JSON.stringify({ run_id: target })); } else { setTool("list_runs"); setInput("{}"); } setDout(""); } }, [target, touched]);
  useEffect(() => { setOut(""); }, [target]);
  const t = TOOLS.find(x => x.name === tool)!;
  const outIsError = out.startsWith("SyntaxError") || out.startsWith("{\"error\"");
  const doutIsError = dout.startsWith("SyntaxError") || dout.startsWith("{\"error\"");
  const pretty = (o: string) => { try { return JSON.stringify(JSON.parse(o), null, 1); } catch { return o; } };
  return <aside>
    <div className="card agent" id="tool-console" data-mode={mode} data-run={target} data-context={context}>
      <p className="kicker">your agent is invited</p>
      {context === "run" ? <h2>Ask about this <em>run</em> <span className="dim">investigate_run on {currentRun} · the same tool an agent would call</span></h2>
        : context === "project" ? <h2>Investigate this <em>project</em> <span className="dim">investigate_run on its longest run, {target}{projectNet ? "; fork_network for the reruns" : ""}</span></h2>
        : <h2>What is <em>here</em>? <span className="dim">list_runs · the same tool an agent would call</span></h2>}
      {webmcp === "unsupported" && <p className="dim small">No agent is connected. Chrome 149+ with <code>chrome://flags/#enable-webmcp-testing</code> lets one call these tools itself; the button makes the same call from the page.</p>}
      {webmcp === "registered" && <p className="dim small">Your agent sees these tools. Ask it: <q>{askPrompt}</q> <button className="linklike" onClick={() => copyAsk()}>{copied ? "copied" : "copy"}</button></p>}
      {context === "run" && <p className="dim small">Investigate reads the confidence ladder, chases whichever rung is holding this run back with the read-only tools, and recommends one action; it creates nothing. Draft a proposal prefills propose_change for you to Call, then Approve or Reject on the thread pinned to its stage.</p>}
      {context === "project" && <p className="dim small">Investigates the longest run, {target}: its ladder, the rung holding it back, one next action; the page moves to that run to show the trace.{projectNet ? " Check the forks asks whether the reruns from its bundle agree with it." : ""} Neither creates anything.</p>}
      {context === "site" && <p className="dim small">Choose a project, or ask what is on this site: every run with its owner, project, length and ΔG.</p>}
      {/* Investigate and the developer console call the same table: Investigate is investigate_run, which picks the tools;
          the console is you picking. Both go through callTool, so the activity log below records them identically. */}
      <div className="row wrap">
        {context === "site"
          ? <button className="primary" onClick={async () => { try { setOut(await callTool("list_runs", {}, "console")); } catch (e: any) { setOut(String(e)); } }}>What is on this site?</button>
          : <button className="primary" disabled={!target} onClick={async () => { try { setOut(await callTool("investigate_run", { run_id: target }, "console")); } catch (e: any) { setOut(String(e)); } }}>Investigate {target}</button>}
        {context === "project" && projectNet && <button className="ghost" onClick={async () => { try { setOut(await callTool("fork_network", { run_id: target }, "console")); } catch (e: any) { setOut(String(e)); } }}>Check the forks</button>}
        {context === "run" && !allProposals.some(p => p.run === currentRun) && <button className="ghost" onClick={draftProposal} title="Prefills propose_change below; you press Call, then Approve or Reject on the thread pinned to the stage">Draft a proposal</button>}
      </div>
      <div role="status" aria-live="polite">{out && (outIsError
        ? <pre className="small out fail">{pretty(out)}</pre>
        : <div className="dim small">{(() => { let v: any = null; try { v = JSON.parse(out); } catch { return null; }
            if (Array.isArray(v)) return <p>{v.length} runs across {cohorts(idx).length} {plural(cohorts(idx).length, "project")}; each row names its owner. Open a project to see them grouped.</p>;
            if (v?.trace) return <p>Trace rendered under <a href="#investigation-title" onClick={e => { e.preventDefault(); document.getElementById("investigation-title")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>Current investigation ↓</a>.</p>;
            if (typeof v?.verdict === "string") return <p><b>{v.status === "tension" ? "Forks in tension." : v.status === "agree" ? "Forks agree." : "Forks: sign only."}</b> {v.verdict}</p>;
            return null; })()}<details className="small"><summary className="dim">raw JSON</summary><pre className="small out">{pretty(out)}</pre></details></div>)}</div>
      <details className="devtools" open={mode === "manual"} onToggle={e => setMode((e.target as HTMLDetailsElement).open ? "manual" : "auto")}>
        <summary>Developer tools <span className="dim">· the {TOOLS.length} tools an agent sees, called by hand · ✎ changes page state</span></summary>
        <div className="tool-chips" role="group" aria-label="tool">{TOOLS.map(x => <button type="button" key={x.name} className={`chip ${tool === x.name ? "on" : ""}`} aria-pressed={tool === x.name} onClick={() => { setTouched(true); setTool(x.name); setInput(prefill(x.name)); }}>{x.name}{x.readOnly ? "" : " ✎"}</button>)}</div>
        {(() => { const q = t.description.indexOf("? "); const head = q > 0 ? t.description.slice(0, q + 1) : t.description; const rest = q > 0 ? t.description.slice(q + 2) : ""; return <div className="dim small">{head}{rest && <details className="small"><summary className="dim">what it returns</summary><p className="dim">{rest}</p></details>}</div>; })()}
        <div className="dim small mono" id="tool-schema">{JSON.stringify((t.inputSchema as any).properties && Object.fromEntries(Object.entries((t.inputSchema as any).properties).map(([k, v]: any) => [k, v.enum ? v.enum.join("|") : v.type])))}</div>
        <textarea value={input} onChange={e => { setTouched(true); setInput(e.target.value); }} rows={Math.min(10, Math.max(3, input.split("\n").length))} spellCheck={false} aria-label="tool input (JSON)" aria-describedby="tool-schema" aria-invalid={doutIsError || undefined} />
        <button ref={callRef} onClick={async () => { try { setDout(await callTool(tool, JSON.parse(input), "console")); } catch (e: any) { setDout(String(e)); } }}>Call</button>
        <div role="status" aria-live="polite">{dout && <pre className="small out">{pretty(dout)}</pre>}</div>
      </details>
    </div>
    {/* Collapsed to a count until something needs approval, an agent adds one, or the reader opens it: an empty queue is not news. */}
    <details className="card proposals" open={allProposals.some(p => p.status === "pending") || pOpen} onToggle={e => setPOpen((e.target as HTMLDetailsElement).open)}>
      <summary><h2>Proposals <span className="dim">· {allProposals.length}{allProposals.length ? ` · ${allProposals.filter(p => p.status === "pending").length} pending` : ""} · agent proposes, you approve</span></h2></summary>
      {proposals.length === 0 && <p className="dim">None yet. An agent's proposed edits appear as comments pinned to the stage they target; nothing applies until you approve there.</p>}
      {proposals.length === 0 && context !== "run" && <button className="ghost" onClick={draftProposal}>Try it: draft a proposal, then press Call</button>}
      {/* This run's proposals live on the page as pinned comments; the panel only points at them. Other runs' proposals are listed in full so nothing waits unseen. */}
      {(() => { const here = proposals.filter(p => p.run === currentRun); const pend = here.filter(p => p.status === "pending"); const stages = [...new Set(here.map(p => p.stage))];
        return here.length ? <p className="pinned-summary">{pend.length ? <b>{pend.length} awaiting your approval</b> : <span>{here.length} reviewed</span>} on this run — pinned at {stages.map((st, i) => <span key={st}>{i > 0 ? ", " : ""}<button className="linklike" onClick={() => set({ openStage: st })}>{st}</button></span>)}.</p> : null; })()}
      {proposals.filter(p => p.run !== currentRun).map(p => <ProposalThread key={p.id} p={p} compact />)}
    </details>
    {/* What the agent just did, announced to screen readers; the visible log is below. */}
    <div role="status" aria-live="polite" style={srOnly}>{calls[0] ? `${calls[0].tool}: ${calls[0].summary}` : ""}</div>
    {calls.length > 0 && <div className="card"><h2>Tool activity <span className="dim">agent, console, and page actions are identified separately</span></h2>
      {calls.map((c, i) => <div key={i} className="call"><span className={c.ok ? "pass" : "fail"} role="img" aria-label={c.ok ? "ok" : "failed"}>●</span> <b>{c.tool}</b> <Source source={c.source} /> <span className="args mono">{fmtArgs(c.input)}</span><div className={`what ${c.ok ? "" : "fail"}`}>{c.summary}</div></div>)}
    </div>}
  </aside>;
}
