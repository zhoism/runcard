import { useEffect, useMemo, useRef, useState } from "react";
import { Spread } from "./Spread";
import { cohorts, confidenceLadderFull, ensemble, loadRun, sameSystem } from "./lib/runs";
import { TOOLS } from "./webmcp";
import type { IndexEntry, Owners } from "./lib/types";
import "./landing.css";

/* The landing page (the bare URL, no hash): the run card is the object at the top, and it is live — a dot in the
   spread picks the run, the ΔG counts to the new value, the ladder is recomputed from that run's manifest by the
   same confidenceLadderFull the run page and the confidence_ladder tool use. Every figure comes from index.json or a
   manifest, so this page cannot drift from the data. The scripted exchange quotes real tool names and argument
   shapes; the numbers in it are the ones test/runs.test.ts pins for 1l2y-rep4 or are read from the index here. */

const DEMO = "1l2y-rep4";

type CohortKey = "matched" | "system" | "all";
const COHORTS: { key: CohortKey; label: string; test: (r: IndexEntry, ref: IndexEntry) => boolean }[] = [
  { key: "matched", label: "matched length", test: (r, ref) => sameSystem(r, ref) && r.production_ps === ref.production_ps },
  { key: "system", label: "same system, all lengths", test: (r, ref) => sameSystem(r, ref) },
  { key: "all", label: "every run", test: () => true },
];

type Ladder = ReturnType<typeof confidenceLadderFull>;
const rungCls = (s: string) => s === "verified" ? "pass" : s === "not established" ? "warn" : s === "partly established" ? "partly" : "";

const sd = (xs: number[]) => { const n = xs.length; if (n < 2) return null; const m = xs.reduce((a, b) => a + b, 0) / n; return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1)); };
const f2 = (x: number | null | undefined) => x == null ? "—" : x.toFixed(2);

/** The demo run's cohort figures, read from the index: the matched-length spread and the pooled one. */
function demoFigures(idx: IndexEntry[]) {
  const me = idx.find(r => r.id === DEMO); if (!me) return null;
  const matched = idx.filter(r => sameSystem(r, me) && r.production_ps === me.production_ps);
  const engines = [...new Set(matched.map(r => r.engine))];
  const ens = ensemble(idx, DEMO);
  const lengths = [...new Set(ens.all.runs.map(r => r.production_ps))].sort((a, b) => a - b);
  return { me, matched, engines, sd_matched: sd(matched.map(r => r.delta_g)), all: ens.all, lengths };
}

type Line = { tag: string; kind: "you" | "tool" | "agent" | "page"; text: string };
function script(idx: IndexEntry[]): Line[] {
  const d = demoFigures(idx);
  const ps = d?.me.production_ps ?? 30;
  return [
    { tag: "you", kind: "you", text: "Using only the tools this page exposes, verify this result. Tell me what I can claim, what I can't, and the one next experiment that would most strengthen it." },
    { tag: "→ tool", kind: "tool", text: `get_run_manifest { run_id: "${DEMO}" }  →  6 stages · per-frame MM-GBSA energies archived` },
    { tag: "→ tool", kind: "tool", text: `recompute_result { run_id: "${DEMO}" }  →  −19.1953 kcal/mol · reproduces mmgbsa.dat` },
    { tag: "→ tool", kind: "tool", text: `confidence_ladder { run_id: "${DEMO}" }  →  rung statuses, evidence and next steps returned` },
    { tag: "→ tool", kind: "tool", text: `get_ensemble { run_id: "${DEMO}" }  →  ${d ? `${d.all.n} runs · SD ±${f2(d.all.sd)} · ${d.lengths.join(", ")} ps` : "…"}` },
    { tag: "agent", kind: "agent", text: d
      ? `Claim: −19.20 kcal/mol reproduces from the archived per-frame energies. The ${d.matched.length} runs at ${ps} ps spread ±${f2(d.sd_matched)}${d.engines.length > 1 ? ` across ${d.engines.length} engines` : ""}; quote that, not a single-run error bar. Don't claim external support: the page never assesses it. Strongest next step: one fresh-seed ${ps} ps run on ${d.me.engine}, which takes the engine mix out of the replication rung.`
      : "Claim: the archived number reproduces. Quote the matched-length spread, not a single-run error bar." },
    { tag: "you", kind: "you", text: "What happens to binding at 310 K? Prepare whatever it takes, and stop before anything changes a scientific input." },
    { tag: "→ tool", kind: "tool", text: `fork_experiment { run_id: "${DEMO}", kind: "extend", treatment: { key: "temp0", value: "310.0" } }  →  2 proposals pending · density, product` },
    { tag: "agent", kind: "agent", text: "heat keeps its temp0 ramp: a schedule, not a condition. Nothing is applied until you click Approve on each pinned thread." },
    { tag: "page", kind: "page", text: "2 threads pinned to their stages · needs your approval" },
  ];
}

/** The 17 tools, grouped by verb. test/landing.test.ts checks this covers the tool table exactly. */
export const TOOL_GROUPS = [
  { name: "Find", items: ["list_runs"], note: "The cohort, as an index." },
  { name: "Read", items: ["get_run_manifest", "get_stage_input"], note: "Artifacts, verbatim." },
  { name: "Check", items: ["validate_stage"], note: "The ported AMBER input validator." },
  { name: "Analyze", items: ["explain_result", "recompute_result", "get_ensemble", "diff_runs", "fork_network"], note: "Re-derive, spread, compare, and whether the forks agree with their parent." },
  { name: "Plan", items: ["plan_sampling", "confidence_ladder", "investigate_run"], note: "Automode reads the ladder, chases the rung holding a run back, and recommends in words. It creates nothing." },
  { name: "Change", items: ["propose_change", "fork_experiment", "list_proposals", "generate_rerun_bundle", "export_evidence_brief"], note: "Only the first two can prepare a change to a scientific input, and both stop at the Approve button. The bundle contains nothing a person has not approved." },
];

const RULES = [
  { n: "01", t: "A number is a claim.", d: "Every figure traces to a file in a run directory. “Verified” means executed and read here; anything else says expected." },
  { n: "02", t: "The agent proposes, a person approves.", d: "Only propose_change and fork_experiment can prepare a change to a scientific input, and both stop at the Approve button. Approve only part of a fork and the bundle's README says so, and its manifest records the fork as incomplete." },
  { n: "03", t: "The minimum that solves it.", d: "No accounts, no uploads, no live MD, no DFT. The page is a reader, and it does not pretend otherwise." },
];

export function Landing({ idx, own, err }: { idx: IndexEntry[]; own: Owners | null; err: string | null }) {
  const [runId, setRunId] = useState(DEMO);
  const [cohort, setCohort] = useState<CohortKey>("matched");
  const run = useMemo(() => idx.find(r => r.id === runId) ?? idx[0] ?? null, [idx, runId]);
  const shown = useMemo(() => run ? idx.filter(r => COHORTS.find(c => c.key === cohort)!.test(r, run)) : [], [idx, run, cohort]);
  const vals = shown.map(r => r.delta_g).filter(v => v != null);
  const m = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  const s = sd(vals);

  // The ladder is the run page's: the manifest is read and confidenceLadderFull decides, so a picked run shows its own rungs.
  const [ladder, setLadder] = useState<Ladder | null>(null);
  useEffect(() => {
    if (!run) return;
    let alive = true; setLadder(null);
    loadRun(run.id).then(mf => { if (alive) setLadder(confidenceLadderFull(mf, idx)); }).catch(() => { if (alive) setLadder(null); });
    return () => { alive = false; };
  }, [run, idx]);

  const dg = useAnimatedNumber(run?.delta_g ?? 0);
  const lines = useMemo(() => script(idx), [idx]);
  const { step, words, replay } = useTypedScript(lines);
  const fig = useMemo(() => demoFigures(idx), [idx]);
  const groups = useMemo(() => cohorts(idx), [idx]);
  const nameOf = (h: string) => own?.profiles[h]?.name ?? h;
  const solvent = run ? [run.system.solvent, run.system.box, run.system.buffer_A != null ? `${run.system.buffer_A} Å` : null].filter(Boolean).join(" · ") : "";

  return (
    <main className="lp">
      <section className="lp-hero">
        <p className="kicker">a shareable, validated record of a molecular-dynamics simulation</p>
        <h1 className="lp-h1">
          <span>Every figure</span> <span>on the page</span> <span>came</span> <em>out of a file.</em>
        </h1>
        <div className="lp-rule" />
        <p className="lede lp-lede">
          Nothing runs, uploads, or is authored here. runcard is the reader-facing layer for work that already
          happened: a page a collaborator opens, inspects, and hands to their agent. Its job is to say what the
          archive supports, and to refuse the rest.
        </p>
        <div className="cta lp-cta">
          <a className="btn lp-sheen" href={`#/run/${DEMO}`}>Open the demo run</a>
          <a className="btn ghost" href="#/">Browse every project</a>
        </div>
      </section>

      <section className="lp-object">
        <p className="lp-eyebrow"><span className="mono">the record itself · live</span><span className="lp-hair" /><span className="dim small">pick a dot to change the run</span></p>

        {!run ? (
          err ? <div className="interp warn" role="alert">{err} — reload the page to try again.</div> : <p className="dim">Loading the index…</p>
        ) : (
          <article className="card lp-card">
            <header className="lp-card-head">
              <span className="mono lp-card-id">{run.id}</span>
              <span className="lp-card-title">{run.title}</span>
              <span className="lp-card-meta">
                <span className="badge">{run.production_ps} ps production</span>
                <span className="badge">{run.engine}</span>
                {run.seed != null && <span className="badge">seed {run.seed}</span>}
                {run.owner && <span className="badge">{nameOf(run.owner)}</span>}
              </span>
              <a className="mono lp-card-open" href={`#/run/${run.id}`}>open the run →</a>
            </header>

            <div className="lp-card-body">
              <div className="lp-result">
                <h2>MM-GBSA ΔG <span className="dim">archived</span></h2>
                <p className="big lp-big">{dg.toFixed(2)} <span className="unit">kcal/mol</span></p>
                <p className="dim small">
                  A single-run figure; the run page re-derives it from this run's per-frame energies. The spread below is
                  what a collaborator should quote.
                </p>
                <dl className="facts lp-facts">
                  <div><dt>system</dt><dd className="mono">{run.title}</dd></div>
                  <div><dt>atoms</dt><dd className="mono">{run.protein_atoms} protein · {run.system.ligand_atoms ?? "?"} ligand</dd></div>
                  <div><dt>force fields</dt><dd className="mono">{run.system.force_fields.join(" · ")}</dd></div>
                  {solvent && <div><dt>solvent</dt><dd className="mono">{solvent}</dd></div>}
                  {run.protocol && <div><dt>&amp;cntrl</dt><dd className="mono lp-protocol">{run.protocol.split("|").join(" | ")}</dd></div>}
                </dl>
              </div>

              <div className="lp-ladder">
                <h2>Confidence ladder <span className="dim">{ladder ? `${ladder.verified_of_assessable} assessable rungs verified` : "reading the manifest…"}</span></h2>
                <ol className="ladder">
                  {ladder?.rungs.map((r, i) => (
                    <li key={r.rung} className={`lp-rung${r.status === "not assessed" ? " dim" : ""}`} style={{ animationDelay: `${(i * 0.09).toFixed(2)}s` }}>
                      <div className="lp-rung-head">
                        <span className="dim mono">{i + 1}.</span> <b>{r.rung}</b>
                        <span className={`badge ${rungCls(r.status)}`}>{r.status}</span>
                      </div>
                      <span className="dim small">{r.short}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </div>

            <footer className="lp-card-foot">
              <div className="lp-cohort-bar">
                <span className="mono dim">where this run sits</span>
                <span className="pills lp-pills">
                  {COHORTS.map(c => (
                    <button key={c.key} type="button" className={`pill${c.key === cohort ? " on" : ""}`} onClick={() => setCohort(c.key)}>{c.label}</button>
                  ))}
                </span>
                <span className="mono dim lp-cohort-stat">
                  {shown.length} runs{m != null ? ` · mean ${m.toFixed(2)}` : ""}{s != null ? ` · SD ±${s.toFixed(2)}` : ""}
                </span>
              </div>
              <Spread runs={shown} mean={m} sd={s} own={own} ringId={run.id} ringWhy="on this card" onPick={setRunId} />
            </footer>
          </article>
        )}
      </section>

      <section className="lp-split">
        <div>
          <p className="kicker">two readers, one record</p>
          <h2 className="headline">A human reads the <em>explanation</em>. An agent reads the <em>fact</em>.</h2>
          <p className="lede">
            The differentiator is not that the page stores a run. It is that the page understands what was stored:
            stage semantics, physics validity, environment, seeds, and whether two differing stochastic results are
            actually in conflict.
          </p>
        </div>
        <dl className="lp-pillars">
          <div><dt className="mono">stage semantics</dt><dd><b>It knows heat from density.</b> A heating ramp is a schedule, not a condition, so a fork pins temperature at density and product and leaves heat alone.</dd></div>
          <div><dt className="mono">physics validity</dt><dd><b>An AMBER <code>.in</code> validator, ported.</b> Every stage input is checked by a port of the pipeline's check_amber.py, pinned to the Python by an oracle of real and mutated input files.</dd></div>
          <div><dt className="mono">provenance</dt><dd><b>No number is typed by hand.</b> extract_run.py reads a finished run directory and writes the manifest from artifacts only; who published a card is the one field typed.</dd></div>
          <div><dt className="mono">conflict</dt><dd><b>Two results, or one spread.</b> {fig
            ? <>{fig.matched.length} runs at {fig.me.production_ps} ps give ±{f2(fig.sd_matched)} kcal/mol, {fig.sd_matched != null && fig.all.sd != null && fig.sd_matched > fig.all.sd ? "wider than" : "against"} the ±{f2(fig.all.sd)} pooled across all {fig.all.n}. The honest number is the less flattering one.</>
            : "The matched-length spread is quoted before the pooled one. The honest number is the less flattering one."}</dd></div>
        </dl>
      </section>

      <section className="lp-agent">
        <div className="lp-agent-copy">
          <p className="kicker">the agent proposes · a person approves</p>
          <h2 className="headline">Hand the page <em>to your agent</em>.</h2>
          <p className="lede">
            Open it in a WebMCP-capable browser and the page registers its tool table. Ask a question, not an
            instruction; the agent picks the tools. Only two of them can prepare a change to a scientific input,
            and both stop at the Approve button.
          </p>
          <div className="cta">
            <button type="button" className="primary" onClick={replay}>Replay the exchange</button>
            <a className="btn ghost" href={`#/run/${DEMO}`}>Try it live</a>
          </div>
        </div>

        <div className="lp-term">
          <div className="lp-term-head">
            <span className="lp-term-dot" />
            <span>tool activity · via agent / WebMCP</span>
            <span className="lp-term-count">{lines.slice(0, step + 1).filter(l => l.kind === "tool").length} calls</span>
          </div>
          <div className="lp-term-body">
            {lines.slice(0, step + 1).map((l, i) => (
              <p key={i} className={`lp-line ${l.kind}`}>
                <span className="lp-line-tag">{l.tag}</span>
                <span className="lp-line-text">
                  {i === step ? l.text.split(" ").slice(0, words).join(" ") : l.text}
                  {i === step && <i className="lp-caret" />}
                </span>
              </p>
            ))}
          </div>
        </div>
      </section>

      <section className="lp-tools">
        <p className="lp-eyebrow"><span className="mono">the tool table · {TOOLS.length} tools · one table drives WebMCP and the in-page console</span><span className="lp-hair" /></p>
        <div className="lp-tool-grid">
          {TOOL_GROUPS.map(g => (
            <div key={g.name} className="lp-tool-card">
              <h3>{g.name} <span className="dim small">{g.items.length}</span></h3>
              <div className="lp-tool-names">{g.items.map(t => <span key={t} className="mono">{t}</span>)}</div>
              <p className="dim small">{g.note}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="lp-rules">
        <h2 className="headline">Rules the code <em>actually enforces</em>.</h2>
        <ol className="lp-rule-list">
          {RULES.map(r => (
            <li key={r.n}><span className="mono dim">{r.n}</span><div><b>{r.t}</b><p className="dim">{r.d}</p></div></li>
          ))}
        </ol>
      </section>

      <section className="card lp-end">
        <p className="kicker">{idx.length ? `${idx.length} real runs${groups.length ? ` · ${groups.map(c => `${c.n} × ${c.title}`).join(" · ")}` : ""}` : "real runs, read from their own directories"}</p>
        <h2 className="headline">Open the run. Ask what you <em>can't</em> claim.</h2>
        <div className="cta">
          <a className="btn" href={`#/run/${DEMO}`}>Open the demo run</a>
          <a className="btn ghost" href="https://github.com/zhoism/runcard">Read the source</a>
        </div>
      </section>
    </main>
  );
}

/** Counts to a new value on an elapsed-time clock, so a slow frame skips ahead instead of falling behind. */
function useAnimatedNumber(target: number, ms = 620) {
  const [v, setV] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const start = performance.now(), a = from.current, b = target;
    if (a === b) { setV(b); return; }
    let raf = 0;
    const frame = (now: number) => {
      const k = Math.min(1, (now - start) / ms);
      setV(a + (b - a) * (1 - (1 - k) ** 3));
      if (k < 1) raf = requestAnimationFrame(frame); else from.current = b;
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  useEffect(() => { from.current = v; }, [v]);
  return v;
}

/** Reveals the scripted exchange a word at a time, positions derived from elapsed time. */
function useTypedScript(lines: Line[]) {
  const timeline = useMemo(() => lines.map(l => { const n = l.text.split(" ").length; const per = l.kind === "tool" ? 34 : 52; const type = n * per; return { n, per, type, total: type + 420 }; }), [lines]);
  const [{ step, words }, set] = useState({ step: 0, words: 0 });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    const t0 = performance.now() + 500;
    let raf = 0;
    const frame = (now: number) => {
      const el = now - t0;
      let acc = 0, st = -1, w = 0;
      for (let i = 0; i < lines.length; i++) {
        const t = timeline[i];
        if (el < acc + t.type) { st = i; w = Math.max(1, Math.ceil((el - acc) / t.per)); break; }
        if (el < acc + t.total) { st = i; w = t.n; break; }
        acc += t.total;
      }
      if (st < 0) { set({ step: lines.length, words: 0 }); return; }
      set(p => (p.step === st && p.words === w ? p : { step: st, words: w }));
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [nonce, lines, timeline]);
  return { step, words, replay: () => { set({ step: 0, words: 0 }); setNonce(n => n + 1); } };
}
