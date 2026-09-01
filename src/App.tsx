import { useEffect, useRef, useState } from "react";
import type { Manifest, IndexEntry } from "./lib/types";
import { loadIndex, loadRun, validateStage, ensemble, cohorts, type Cohort, diffRuns, zipBundle, uncertaintyFromFrames, verdictOf, confidenceLadderFull, explainResult, internalResidual, forkNetwork, forkNetworks, type Proposal, sameSystem } from "./lib/runs";
import { runningMean } from "./lib/stats";
import type { Report } from "./lib/amberCheck";
import { useStore, navigate, setProposalStatus, set } from "./store";
import { analysisInfo, ANALYSIS_CATEGORIES, type AnalysisCategory } from "./lib/analysisCatalog";
import { TOOLS, callTool } from "./webmcp";
import { Viewer, Boundary } from "./Viewer";
import type { InvestigationState } from "./lib/investigation";

/** "run_id=1l2y-regression stage=product" — the call's arguments, readable at a glance. */
const fmtArgs = (input: unknown) => input && typeof input === "object" && !Array.isArray(input) ? Object.entries(input as Record<string, unknown>).map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`).join(" ") : input == null ? "" : JSON.stringify(input);
const show = (v: unknown) => Array.isArray(v) ? v.join(" ") : v == null ? "—" : String(v);
const fmt = (n: number | null | undefined, d = 2) => n == null ? "—" : n.toFixed(d);
/** One color code everywhere (design ruling 2026-09-01): green pass, amber warn, red fail. The copy still scopes PASS as an input sanity check, not physical validity. */
const Verdict = ({ r }: { r: Report }) => { const v = verdictOf(r); return <span className={`badge ${v.toLowerCase()}`}>{v}</span>; };
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
      <span className="tag">validated simulation records</span>
      {st === "registered" ? <span className="webmcp registered" title="Tools registered with navigator.modelContext">WebMCP: registered · {TOOLS.length} tools</span>
       : st === "error" ? <span className="webmcp error" title="registerTool threw; see console">WebMCP: registration failed</span>
       : <a className="webmcp" href="#tool-console" onClick={e => { e.preventDefault(); document.getElementById("tool-console")?.scrollIntoView({ behavior: "smooth", block: "start" }); }} title="This browser does not expose WebMCP. Chrome: chrome://flags/#enable-webmcp-testing. The Tool Console calls the same tools by hand.">no WebMCP here — use the Tool Console ↓</a>}
    </header>
  );
}

/** The h2 line carries the cohort's mean ± run-to-run SD; rows do not repeat it. */
const cohortLine = (c: Cohort) => c.n > 1
  ? `${c.n} independent runs of one prepared system and protocol, ${c.lengths_ps[0]}–${c.lengths_ps[c.lengths_ps.length - 1]} ps · ΔG ${fmt(c.mean)} ± ${fmt(c.sd)} kcal/mol (run-to-run SD)`
  : `1 run · ΔG ${fmt(c.mean)} kcal/mol (no run-to-run spread yet)`;
function Home({ idx }: { idx: IndexEntry[] }) {
  useEffect(() => { document.title = "runcard"; }, []);
  const cs = cohorts(idx);
  return (
    <section>
      <h1>Simulation runs and their evidence</h1>
      <p className="lede">Each row is a molecular-dynamics run rendered from its artifacts: stages, parameters, seeds, results, environment. Runs of the same prepared system and protocol are grouped; their run-to-run spread is the uncertainty that matters. Open one and ask your agent about it — the page registers WebMCP tools (<code>navigator.modelContext</code>) to validate stages, compare runs, explain uncertainty, plan sampling, and prepare a controlled follow-up that waits for your approval.</p>
      {forkNetworks(idx).map(net => <ForkNetworkCard key={net.parent.id} net={net} />)}
      {cs.map(c => (
        <section key={c.key} className="cohort">
          <h2>{c.title} <span className="dim">— {cohortLine(c)}</span></h2>
          <div className="tablewrap"><table className="runs">
            <thead><tr><th>run</th><th>ligand</th><th>protein atoms</th><th>production</th><th>ΔG MM-GBSA <span className="dim">kcal/mol</span></th><th>PLIP</th></tr></thead>
            <tbody>{c.runs.map(r => <tr key={r.id} onClick={() => navigate(`/run/${r.id}`)}><td><a href={`#/run/${r.id}`}>{r.title}</a>{r.id === c.start_here && <span className="badge start">start here · longest run</span>}<div className="dim">{r.id}{r.parent ? <span className="forkmark"> ↳ fork of {r.parent}</span> : null}{(() => { const k = idx.filter(x => x.parent === r.id).length; return k ? <span className="forkmark"> · {k} forks</span> : null; })()}</div></td><td>{r.ligand}</td><td>{r.protein_atoms}</td><td>{r.production_ps} ps</td><td className="num">{fmt(r.delta_g)}</td><td>{r.plip ? "✓" : ""}</td></tr>)}</tbody>
          </table></div>
        </section>
      ))}
    </section>
  );
}

/** A Figma-style comment marker on a stage: a bubble, not a numbered label. Amber = pending (needs you), green = approved, grey = rejected.
    WebMCP does not expose the client's name, so the glyph is a generic agent mark; the thread names the source. */
function ProposalPin({ proposals, onOpen }: { proposals: Proposal[]; onOpen: () => void }) {
  if (!proposals.length) return null;
  const pending = proposals.filter(p => p.status === "pending").length;
  const cls = pending ? "pending" : proposals.every(p => p.status === "rejected") ? "rejected" : "approved";
  const label = `${proposals.length} proposal${proposals.length === 1 ? "" : "s"} on this stage${pending ? `, ${pending} awaiting your approval` : ""}`;
  return <button type="button" className={`pin ${cls}`} aria-label={label} title={label} onClick={onOpen}><span className="pin-glyph" aria-hidden="true">{proposals.length > 1 ? proposals.length : "✦"}</span></button>;
}
/** One proposal as a comment thread: who and when, the ask, the diff, validation after, and the only two verbs a person has. */
function ProposalThread({ p, compact }: { p: Proposal; compact?: boolean }) {
  const when = p.t ? new Date(p.t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : null;
  return <div className={`thread ${p.status}`}>
    <div className="thread-who"><span className="pin-glyph inline" aria-hidden="true">✦</span> <b>{p.source === "webmcp" ? "agent proposal" : "proposal"}</b> {p.source && <Source source={p.source} />}{when && <span className="dim"> · {when}</span>}{compact && <span className="dim"> · <b>{p.run}</b> / {p.stage}</span>}{p.fork && <span className="dim"> · fork: {p.fork.kind}</span>}<span className={`badge ${p.status}`}>{p.status}</span></div>
    <p className="thread-ask">{p.reason}</p>
    <div className="thread-diff mono">{(p.changes ?? []).length ? p.changes.map(c => <div key={c.key}><span className="k">{c.key}</span> <s className="old">{c.before ?? "(unset)"}</s> <span className="new">{c.after}</span>{c.meaning && <span className="dim sans"> — {c.meaning}{c.material ? "" : " · not material"}</span>}</div>) : Object.entries(p.edits).map(([k, v]) => <div key={k}><span className="k">{k}</span> <span className="new">{v}</span></div>)}</div>
    <div className="thread-check">{p.material_classes?.length ? <span className="badge warn">material · {p.material_classes.map(c => c.replace("_", " ")).join(", ")}</span> : null} validation after <Verdict r={p.after} />{p.after.findings.filter(f => f.level !== "PASS").map((f, i) => <div key={i} className="dim small">{f.level}: {f.rule} — {f.detail}</div>)}</div>
    {p.status === "pending" && <div className="row"><button onClick={() => setProposalStatus(p.id, "approved")} disabled={p.after.hasFail}>Approve</button><button className="ghost" onClick={() => setProposalStatus(p.id, "rejected")}>Reject</button>{p.after.hasFail && <span className="dim small" style={{ alignSelf: "center" }}>cannot approve: the edit fails validation</span>}</div>}
  </div>;
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

/** The cpptraj plots as a filterable gallery: each has a name, a family and a one-line meaning from the catalogue. */
function AnalysesCard({ m }: { m: Manifest }) {
  const [filter, setFilter] = useState<AnalysisCategory | "all">("all");
  const items = Object.entries(m.analyses).filter(([k]) => k !== "plip").map(([k, a]) => ({ key: k, png: a.png, ...analysisInfo(k) }));
  const present = ANALYSIS_CATEGORIES.filter(c => items.some(i => i.category === c));
  const shown = items.filter(i => filter === "all" || i.category === filter);
  return <div className="card"><h2>Analyses <span className="dim">cpptraj · {items.length} plots</span></h2>
    {present.length > 1 && <div className="pills" role="group" aria-label="filter analyses by family">
      {(["all", ...present] as const).map(c => <button key={c} type="button" className={`pill ${filter === c ? "on" : ""}`} aria-pressed={filter === c} onClick={() => setFilter(c)}>{c}{c !== "all" && <span className="count">{items.filter(i => i.category === c).length}</span>}</button>)}
    </div>}
    <div className="gallery">{shown.map(i => <figure key={i.key} className="analysis">
      <figcaption><b>{i.name}</b><span className="dim">{i.category}</span></figcaption>
      <a href={`/runs/${m.id}/${i.png}`} target="_blank" rel="noopener" title={`open ${i.png} full size`}><img src={`/runs/${m.id}/${i.png}`} alt={`${i.name} plot`} loading="lazy" /></a>
      {i.shows && <p className="dim small">{i.shows}</p>}
    </figure>)}</div>
  </div>;
}

/** GitHub's network graph for an experiment: the parent, the runs re-executed from its bundle, and whether they agree.
    The verdict is computed (forkNetwork); tension is shown in amber, not hidden, because surfacing it is the point. */
function ForkNetworkCard({ net, compact }: { net: ReturnType<typeof forkNetwork>; compact?: boolean }) {
  const cls = net.status === "agree" ? "pass" : net.status === "tension" ? "warn" : "";
  const label = net.status === "agree" ? "forks agree" : net.status === "tension" ? "forks in tension" : net.status === "sign" ? "sign only" : "no forks";
  const Node = ({ n, role }: { n: ReturnType<typeof forkNetwork>["parent"]; role: "parent" | "fork" }) => <a className={`node ${role}`} href={`#/run/${n.id}`}>
    <span className="node-id mono">{n.id}</span><span className="dim">{n.engine} · {n.production_ps} ps{role === "fork" && n.kind ? ` · ${n.kind}${n.seed === "fresh" ? ", fresh seeds" : ""}${n.complete === false ? ", partial" : ""}` : ""}</span><span className="node-dg mono">{fmt(n.delta_g)}</span>
  </a>;
  return <section className="card network" aria-labelledby={`network-${net.parent.id}`}>
    <h2 id={`network-${net.parent.id}`}>Fork network <span className={`badge ${cls}`}>{label}</span>{compact ? null : <span className="dim">{net.n} runs re-executed from {net.parent.id}'s rerun bundle, each a card that points back at its parent</span>}</h2>
    <div className="tree">
      <Node n={net.parent} role="parent" />
      <ul className="forks">{net.forks.map(f => <li key={f.id}><Node n={f} role="fork" /></li>)}</ul>
    </div>
    <p className="verdict">{net.verdict}</p>
    {!compact && <p className="dim small">ΔG in kcal/mol, MM-GBSA. Agreement is judged against the run-to-run SD of the whole same-system cohort, the uncertainty that matters — a fork is a rerun, and this is the check a rerun exists to make.</p>}
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
function RunPage({ id, idx }: { id: string; idx: IndexEntry[] }) {
  const [m, setM] = useState<Manifest | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const investigation = useStore(s => s.investigations[id]);
  const re = investigation?.reanalysis?.value;
  // Proposals are comments pinned to the stage they target. Filter outside the selector (React #185).
  const runProposals = useStore(s => s.proposals).filter(p => p.run === id);
  const openStage = useStore(s => s.openStage);
  const seenProposal = useRef<string | null>(null);
  // A new pending proposal on this run opens its thread, so the reader sees what the agent asked for without hunting.
  useEffect(() => { const p = runProposals[0]; if (p && p.status === "pending" && seenProposal.current !== p.id) { seenProposal.current = p.id; setOpen(p.stage); } }, [runProposals]);
  useEffect(() => { if (openStage) { setOpen(openStage); set({ openStage: null }); setTimeout(() => document.getElementById(`stage-${openStage}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 30); } }, [openStage]);
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
      <nav className="crumbs" aria-label="breadcrumb"><a href="#/">← all runs</a><span aria-hidden="true">/</span>{(() => { const c = cohorts(idx).find(c => c.runs.some(r => r.id === id)); return c ? <><span>{c.title}</span><span aria-hidden="true">/</span></> : null; })()}<span className="mono">{m.id}</span></nav>
      <div className="titlebar"><h1>{m.title}</h1><span className="dim">{m.id}</span>
        {m.parent && <a className="badge fork" href={`#/run/${m.parent}`}>fork of {m.parent}</a>}
        <ForkMenu m={m} ens={ens} />
        {net && net.n > 0 && <a className={`badge fork ${net.status === "agree" ? "pass" : net.status === "tension" ? "warn" : ""}`} href={`#network-${m.id}`}>{net.n} forks · {net.status === "agree" ? "agree" : net.status === "tension" ? "in tension" : "sign only"}</a>}
        <CompareSelect idx={idx} self={id} value="" onPick={other => navigate(`/compare/${id}/${other}`)} /></div>
      {/* Lineage is identity, not provenance trivia: a replicate has to say what it replicates before it shows
          a number, or a reader takes its ΔG for an independent measurement of a different thing. */}
      {m.parent && <p className="lineage">{m.fork?.kind === "replicate" ? "Independent replicate of" : m.fork?.kind ? `${m.fork.kind} of` : "Derived from"} <a href={`#/run/${m.parent}`}>{m.parent}</a>{m.fork?.seed === "fresh" ? " — same prepared system and protocol, fresh seeds" : ""}{m.fork?.complete === false ? " — partially applied" : ""}.</p>}

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
              {re && <><dt>current reanalysis</dt><dd>frames {re.window.start_frame}–{re.window.end_frame}{re.window.interval > 1 ? ` every ${re.window.interval}th` : ""} ({re.window.frames_used} frames{re.window.start_ps != null ? `, ${re.window.start_ps}–${re.window.end_ps} ps` : ""}) → <b>{fmt(re.delta_g.mean)} ± {fmt(re.delta_g.corrected_sem)}</b>, {re.delta_g.verdict} <span className="dim">(recomputed in the browser from the archived per-frame energies; ± is the corrected SEM; the archived value above is unchanged)</span></dd></>}
              <dt>method</dt><dd>MM-GBSA igb={mm.igb}, saltcon={mm.saltcon} · computed {mm.run_on}</dd></dl>
            {mm.per_frame && <Sparkline x={mm.per_frame.delta_total} lengthPs={prod?.length_ps ?? null} window={re ? { start: re.window.start_frame, end: re.window.end_frame } : undefined} />}
            <details className="small"><summary className="dim">how these numbers were computed</summary>
              <p className="dim">Per-frame: population SD {fmt(mm.frame_std)}, naive SEM {fmt(mm.frame_sem, 3)} over {mm.frames} frames (every {mm.params?.interval ?? "?"}th of {mm.params?.endframe ?? "?"}); frames are correlated, so the naive SEM understates the within-run uncertainty.{mm.frames_header_text && mm.frames_header_text !== String(mm.frames) ? ` The mmgbsa.dat header prints "${mm.frames_header_text}" — (endframe−startframe)/interval+1 un-floored; the count here is from the per-frame blocks.` : ""}</p>
              {u && <p className="dim">Corrected SEM = SD·√(g/N) with g = 1 + 2Σ(1−t/N)C(t) (τ = {u.integrated_autocorrelation_time_frames} frames); drift verdict: {u.thresholds.drifting_if}; too short if {u.thresholds.too_short_if}. Reconstructed from the per-frame mdout files; the full window reproduces mmgbsa.dat exactly.</p>}
            </details>
            {mm.warnings.map((w, i) => { const quiet = resid != null && resid.fraction_of_delta_g < 1e-3; return <div key={i} className={`warnbox ${quiet ? "quiet" : ""}`}>⚠ {w}
              <div className="dim">Recorded from mmgbsa.dat — shown lowercased; the file prints it in capitals.{resid ? ` The internal-term residual it accompanies: ${resid.total.mean} ± ${resid.total.sd} kcal/mol per frame (${(resid.fraction_of_delta_g * 100).toFixed(3)} % of ΔG), from ${resid.dominant_term}; the exact trigger is not recorded, so this is consistent with the warning, not its proven cause${quiet ? " — below 0.1 % of ΔG, shown for the record" : ""}.` : " Ask the agent to explain_result for what it means."}</div></div>; })}
          </> : <p className="dim">no MM-GBSA result</p>}
        </div>
        {m.results.plip && <div className="card">
          <h2>Contacts <span className="dim">PLIP on the medoid frame</span></h2>
          <dl>{Object.entries(m.results.plip.interactions).map(([k, v]) => <div key={k}><dt>{k.replace("_", " ")}</dt><dd>{v.map(x => x.residue).join(", ")}</dd></div>)}</dl>
          <div className="dim small" style={{ marginTop: 6 }}>frame {m.results.plip.frame?.index} of {m.results.plip.frame?.nframes} ({m.results.plip.frame?.policy})</div>
          {m.analyses.plip && <div className="dim small"><a href={`/runs/${m.id}/plip.png`} target="_blank" rel="noopener">PLIP interaction chart (plip.png)</a></div>}
        </div>}
      </div>

      {net && net.n > 0 && <ForkNetworkCard net={net} compact />}

      <ForkCards m={m} ens={ens} />

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
          <ProposalPin proposals={runProposals.filter(p => p.stage === s.name)} onOpen={() => setOpen(s.name)} /></div>)}</div>
        {open && (() => { const s = m.stages.find(x => x.name === open)!; const r = reports[open]; return <div className="stagedetail" id="stagedetail" role="region" aria-labelledby={`stage-${open}`}>
          {runProposals.some(p => p.stage === open) && <div className="threads">{runProposals.filter(p => p.stage === open).map(p => <ProposalThread key={p.id} p={p} />)}</div>}
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

      {ladder && <EvidenceOverview ladder={ladder} explanation={explanation} investigation={investigation} validationVerdict={overall} />}
      <CurrentInvestigation runId={id} investigation={investigation} partnerId={ens?.all.runs.find(r => r.id !== m.id)?.id ?? others[0]?.id} />

      {ladder && (() => { const L = ladder; const cls = (s: string) => s === "verified" ? "pass" : s === "not established" ? "warn" : s === "partly established" ? "partly" : ""; return <div className="card">
        <h2>Confidence ladder <span className="dim">{L.verified_of_assessable} assessed rungs verified{L.rungs.some(r => r.status === "partly established") ? ` · ${L.rungs.filter(r => r.status === "partly established").length} partly established` : ""} · 1 not assessed · computed from the archived data</span></h2>
        <ol className="ladder">{L.rungs.map((r, i) => <li key={r.rung} className={r.status === "not assessed" ? "dim" : ""}><span className="dim mono">{i + 1}.</span> <span className={`badge ${cls(r.status)}`}>{r.status}</span> <b>{r.rung}</b> <span className="dim">— {r.short}</span>
          <details className="small"><summary className="dim">evidence</summary><p className="dim">{r.evidence}{r.to_climb ? <> · <i>to climb: {r.to_climb}</i></> : null}</p></details></li>)}</ol>
      </div>; })()}


      <AnalysesCard m={m} />

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
      <div><h3>Checks supporting it</h3><p><b>{ladder.verified_of_assessable} assessed rungs verified.</b> Input sanity checks: <span className={`badge ${validationVerdict.toLowerCase()}`}>{validationVerdict}</span>. A passing input check is not convergence or physical accuracy.</p></div>
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

function Source({ source }: { source: string }) { return <span className="source-label">via {source === "webmcp" ? "agent / WebMCP" : source === "console" ? "manual console" : "page action"}</span>; }

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
    <nav className="crumbs" aria-label="breadcrumb"><a href="#/">← all runs</a><span aria-hidden="true">/</span><a href={`#/run/${a}`}>{a}</a><span aria-hidden="true">/</span><span>compare with <span className="mono">{b}</span></span></nav>
    <div className="titlebar"><h1>Compare <a href={`#/run/${a}`}>{idx.find(r => r.id === a)?.title ?? a}</a> vs <a href={`#/run/${b}`}>{idx.find(r => r.id === b)?.title ?? b}</a></h1>
      <CompareSelect idx={idx} self={a} value={b} onPick={other => navigate(`/compare/${a}/${other}`)} wide /></div>
    {/* The verdict first, in bold; the reasoning under it; the numbers live once, in the table below. */}
    <div className={`interp ${d.same_system ? "" : "warn"}`}><b>{d.verdict}</b><div className="dim">{d.interpretation}</div></div>
    <div className={d.system.length > 0 ? "grid2" : ""}>
      <div className="card"><h2>ΔG <span className="dim">kcal/mol{d.same_system ? "" : " · listed, not compared"}</span></h2><table><thead><tr><th>run</th><th className="num">ΔG</th></tr></thead><tbody><tr><td>{a}</td><td className="num">{fmt(d.delta_g.a)}</td></tr><tr><td>{b}</td><td className="num">{fmt(d.delta_g.b)}</td></tr>
        {d.run_to_run_spread && <tr><td>run-to-run mean ± SD (n={d.run_to_run_spread.all.n})</td><td className="num">{fmt(d.run_to_run_spread.all.mean)} ± {fmt(d.run_to_run_spread.all.sd)}</td></tr>}
        {d.delta_g.diff != null && <tr><td>ΔΔG ({a} − {b}){d.delta_g_vs_noise ? <span className="dim"> · √2·SD = {fmt(d.delta_g_vs_noise.sd_of_difference)}</span> : null}</td><td className="num">{fmt(d.delta_g.diff)}</td></tr>}</tbody></table>
        <div className="dim mono small">seeds {a}: {d.realized_seeds.a.join(" ")}<br />seeds {b}: {d.realized_seeds.b.join(" ")}</div>
        {d.system.length === 0 && <div className="dim small" style={{ marginTop: 8 }}>identical prepared system{d.stages.length === 0 ? <>; stage inputs identical across all {d.stages_compared} stages (every &amp;cntrl key compared, seeds excluded) — only the seeds above differ</> : null}</div>}</div>
      {d.system.length > 0 && <div className="card"><h2>System</h2><table><thead><tr><th>field</th><th>{a}</th><th>{b}</th></tr></thead><tbody>{d.system.map(s => <tr key={s.field}><td>{s.field.replace(/_/g, " ")}</td><td className="mono">{show(s.a)}</td><td className="mono">{show(s.b)}</td></tr>)}</tbody></table></div>}
    </div>
    {d.stages.length > 0 && <div className="card"><h2>Stage parameters</h2>{d.stages.map(s => <div key={s.stage}><h3>{s.stage}</h3><table><thead><tr><th>key</th><th>meaning</th><th>{a}</th><th>{b}</th><th>material?</th></tr></thead><tbody>{s.changes.map(c => <tr key={c.key} className={c.material ? "" : "dim"}><td className="mono">{c.key}</td><td>{c.meaning}</td><td className="mono">{c.a}</td><td className="mono">{c.b}</td><td>{c.material ? <span className="badge warn">material · {c.class.replace("_", " ")}</span> : <span className="badge">{d.same_system ? "not material" : "moot across systems"} · {c.class.replace("_", " ")}</span>}</td></tr>)}</tbody></table></div>)}</div>}
    {d.system.length > 0 && d.stages.length === 0 && <p className="dim small">no parameter differences (seeds excluded)</p>}
  </section>;
}

function Sidebar() {
  const allProposals = useStore(s => s.proposals); const calls = useStore(s => s.calls);
  const route = useStore(s => s.route); const webmcp = useStore(s => s.webmcp); const pre = useStore(s => s.console);
  const [tool, setTool] = useState(TOOLS[0].name); const [input, setInput] = useState("{}"); const [out, setOut] = useState(""); const [touched, setTouched] = useState(false);
  const [mode, setMode] = useState<"auto" | "manual">("manual");
  // A page button can hand the console a drafted call (the human edits and presses Call — the console is the only path).
  const callRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (pre) { setTool(pre.tool); setInput(pre.input); setOut(""); setTouched(true); set({ console: null }); setTimeout(() => callRef.current?.focus(), 50); } }, [pre]);
  // Prefill run_id with the run on screen, so "pick explain_result, press Call" works on a run page.
  const currentRun = route.split("/")[2] || "";
  // The approval queue is global on purpose: list_proposals is unfiltered, so scoping this list to the
  // route would let a pending proposal sit unseen while the panel said "None yet". Each card names its run.
  const proposals = [...allProposals].sort((a, b) => Number(b.run === currentRun) - Number(a.run === currentRun));
  const prefill = (name: string) => { const props: any = (TOOLS.find(x => x.name === name)!.inputSchema as any).properties ?? {}; return JSON.stringify(currentRun && props.run_id ? { run_id: currentRun } : currentRun && props.run_a ? { run_a: currentRun, run_b: "" } : {}); };
  // On a run page the most useful first call is explain_result for that run — until the human picks a tool themselves.
  useEffect(() => { if (currentRun && !touched) { setTool("explain_result"); setInput(JSON.stringify({ run_id: currentRun })); setOut(""); } }, [currentRun, touched]);
  const t = TOOLS.find(x => x.name === tool)!;
  const outIsError = out.startsWith("SyntaxError") || out.startsWith("{\"error\"");
  return <aside>
    <div className="card">
      <h2>Proposals <span className="dim">agent proposes, you approve{allProposals.length ? ` · ${allProposals.filter(p => p.status === "pending").length} pending of ${allProposals.length}` : ""}</span></h2>
      {proposals.length === 0 && <p className="dim">None yet. When an agent calls <code>propose_change</code> or <code>fork_experiment</code>, the proposal appears as a comment pinned to the stage it targets; nothing is applied until you approve it there.</p>}
      {proposals.length === 0 && <button className="ghost" onClick={() => { const run = currentRun || "1l2y-rep4"; set({ console: { tool: "propose_change", input: JSON.stringify({ run_id: run, stage: "product", edits: { dt: "0.001" }, reason: "halve the timestep — a test of the proposal flow" }, null, 1) } }); if (!currentRun) navigate(`/run/${run}`); }}>Try it: draft a proposal, then press Call</button>}
      {/* This run's proposals live on the page as pinned comments; the panel only points at them. Other runs' proposals are listed in full so nothing waits unseen. */}
      {(() => { const here = proposals.filter(p => p.run === currentRun); const pend = here.filter(p => p.status === "pending"); const stages = [...new Set(here.map(p => p.stage))];
        return here.length ? <p className="pinned-summary">{pend.length ? <b>{pend.length} awaiting your approval</b> : <span>{here.length} reviewed</span>} on this run — pinned at {stages.map((st, i) => <span key={st}>{i > 0 ? ", " : ""}<button className="linklike" onClick={() => set({ openStage: st })}>{st}</button></span>)}.</p> : null; })()}
      {proposals.filter(p => p.run !== currentRun).map(p => <ProposalThread key={p.id} p={p} compact />)}
    </div>
    <div className="card" id="tool-console">
      <h2>Tool console <span className="dim">the same tools an agent sees · ✎ = changes page state</span></h2>
      {webmcp !== "registered" && <p className="dim small">No agent is connected to this page. In Chrome, enable <code>chrome://flags/#enable-webmcp-testing</code> and reload to let an agent call these tools itself; or call them by hand here.</p>}
      {/* Auto and manual call the same table: auto is investigate_run, which picks the tools; manual is you picking.
          Both go through callTool, so the activity log below records them identically. */}
      <div className="mode" role="group" aria-label="console mode">
        <button className={mode === "auto" ? "" : "ghost"} aria-pressed={mode === "auto"}
          onClick={() => { setMode("auto"); setTool("investigate_run"); setInput(prefill("investigate_run")); }}>Auto</button>
        <button className={mode === "manual" ? "" : "ghost"} aria-pressed={mode === "manual"}
          onClick={() => setMode("manual")}>Manual</button>
        <span className="dim small">{mode === "auto"
          ? "investigate_run reads the ladder, chases whichever rung is holding this run back, and recommends one action. It creates nothing."
          : "pick any of the 17 tools yourself."}</span>
      </div>
      {mode === "manual" && <select value={tool} aria-label="tool" onChange={e => { setTouched(true); setTool(e.target.value); setInput(prefill(e.target.value)); }}>{TOOLS.map(t => <option key={t.name} value={t.name}>{t.name}{t.readOnly ? "" : " ✎"}</option>)}</select>}
      {(() => { const q = t.description.indexOf("? "); const head = q > 0 ? t.description.slice(0, q + 1) : t.description; const rest = q > 0 ? t.description.slice(q + 2) : ""; return <div className="dim small">{head}{rest && <details className="small"><summary className="dim">what it returns</summary><p className="dim">{rest}</p></details>}</div>; })()}
      <div className="dim small mono" id="tool-schema">{JSON.stringify((t.inputSchema as any).properties && Object.fromEntries(Object.entries((t.inputSchema as any).properties).map(([k, v]: any) => [k, v.enum ? v.enum.join("|") : v.type])))}</div>
      <textarea value={input} onChange={e => { setTouched(true); setInput(e.target.value); }} rows={3} spellCheck={false} aria-label="tool input (JSON)" aria-describedby="tool-schema" aria-invalid={outIsError || undefined} />
      <button ref={callRef} onClick={async () => { try { setOut(await callTool(tool, JSON.parse(input), "console")); } catch (e: any) { setOut(String(e)); } }}>{mode === "auto" ? "Investigate" : "Call"}</button>
      <div role="status" aria-live="polite">{out && <pre className="small out">{(() => { try { return JSON.stringify(JSON.parse(out), null, 1); } catch { return out; } })()}</pre>}</div>
    </div>
    {/* What the agent just did, announced to screen readers; the visible log is below. */}
    <div role="status" aria-live="polite" style={srOnly}>{calls[0] ? `${calls[0].tool}: ${calls[0].summary}` : ""}</div>
    {calls.length > 0 && <div className="card"><h2>Tool activity <span className="dim">agent, console, and page actions are identified separately</span></h2>
      {calls.map((c, i) => <div key={i} className="call"><span className={c.ok ? "pass" : "fail"} role="img" aria-label={c.ok ? "ok" : "failed"}>●</span> <b>{c.tool}</b> <Source source={c.source} /> <span className="args mono">{fmtArgs(c.input)}</span><div className={`what ${c.ok ? "" : "fail"}`}>{c.summary}</div></div>)}
    </div>}
  </aside>;
}
