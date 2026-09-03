# Devpost submission — runcard

Final 2026-09-03. Paste-ready. Every number below is read from the live site or the repo at the
commit that is deployed; nothing is aspirational. The four answers the rules require are the four
bold leads under "Why WebMCP".

---

## Submission checklist

- [ ] **Push the repo.** `github.com/zhoism/runcard` master must hold the deployed commit. License (MIT) shows in About.
- [ ] **Production serves the deployed commit.** Header pill reads `WebMCP · 17 tools` in green in ChatGPT's browser
      and in Chrome 149+ with `chrome://flags/#enable-webmcp-testing`. Then stop touching the site.
- [ ] **Video** public on YouTube, under 3:00, narrated, no music. Link in the form.
- [ ] **Freeze at 1:00 pm PDT.** No edits to site, repo, or form until winners are announced.

## Project name

runcard

## Tagline

A GitHub for molecular-dynamics runs: every number traces to a file, and the page exposes the
experiment to your agent as seventeen calibrated scientific operations through WebMCP. The agent
reasons; Runcard measures, checks and packages; a person approves.

## About the project

### What it is

A molecular-dynamics simulation ends as a directory of a couple hundred files: inputs, logs,
trajectories, analyses. The data is there, but its meaning lives in the researcher's head: what was
actually run, where the reported number came from, whether it should be trusted, how someone else
should continue the work.

**runcard** turns that directory into a scientific record that both people and agents can read. The
hierarchy is GitHub's: a prepared system is the repository (a *project*), each run is a commit, a rerun
from a bundle is a fork with lineage, an agent's proposed edit is a pull request only a person can
merge, and validation plus a five-rung confidence ladder are the checks.

Two rules govern everything on it. **A number is a claim**: every figure traces to a file in a run
directory; "verified" means executed and read, anything else says "expected." **Human approves, agent
proposes**: nothing that changes a scientific input is applied without a person clicking Approve.

### Why WebMCP

**Why this use case is a strong fit for WebMCP.** You cannot hand an agent an MD directory and say
"continue the science." It can read every file and still confidently compare a 2 ps run with a 30 ps
one, quote the per-frame standard error as an error bar, or find-and-replace a temperature into the
heating ramp. A language model can read an input file; that does not mean it should redesign an
experiment. WebMCP lets the page hand the agent the operations instead: which runs are comparable,
what uncertainty can be claimed, which stages a change touches, what stays fixed.

**How it creates a better user experience.** For a person, the page reconstructs the run from the
files: an ordered protocol with each stage's role, restart chain and the seed it actually used; eleven
validation rules on every input; the result with its limitations attached (short-run estimate, no
error bar yet and why, an archived MMPBSA warning sized at 0.007 % of the result); the next
experiment named. For an agent, the same page is seventeen tools returning structured evidence.

**What people and agents can do together that was difficult or impossible before.** Tonight a stock
ChatGPT agent, given only "Can I defend this result?", discovered the tools on its own, made seven
calls, verified the archived number to four decimals, refused to quote an error bar because only two
of three matched replicates exist, and recommended one more run at the same engine and length. Asked
"What happens to binding at 310 K? Prepare whatever it takes, and stop before anything changes," it
prepared a controlled extension (two stages changed, the heating ramp left alone with the reason written
out, fourteen controls held by name, inputs revalidated) and, unasked, also prepared the missing 300 K
control run because a comparison needs a complete control arm. Then it stopped: "Nothing changed or
ran. Two proposals await your approval on the page." A person approved. The agent built the 15-file
rerun bundle. That division of labor did not exist before: the agent reasons, the page measures, checks
and packages, the human authorizes, the cluster runs it, and the result returns as a traceable child.

**How WebMCP was implemented.** One table in `src/webmcp.ts` drives both
`navigator.modelContext.registerTool` and the in-page Tool Console, so the console is never a mock.
Seventeen tools: ten read-only; seven write page state (a bundle, a brief, a reanalysis, a plan, a
trace); only `propose_change` and `fork_experiment` can prepare a change to a scientific input, and both
stop at Approve. Every call, from an agent, the console or a page button, is logged on the page with
its source, so a judge can see "via agent / WebMCP" beside each line. Tool descriptions are
question-first and each states what it leaves on the page; a test caps their total length.

### Try it (what we'd do in your seat)

Open https://runcard.vercel.app/#/run/1l2y-rep4 in ChatGPT's built-in browser, or in Chrome 149+
with `chrome://flags/#enable-webmcp-testing`. The header pill should read **WebMCP · 17 tools** in
green. Then ask, in order:

1. `Using only the tools this page exposes, verify this result. Tell me what I can claim, what I can't, and the single next experiment that would most strengthen it. Be brief.`
   Expect: the archived −19.1953 kcal/mol reproduces; no run-level error bar can be claimed (2 of 3
   matched runs); the recommendation is one fresh-seed 30 ps run on Amber 26 PMEMD.
2. `What happens to binding at 310 K? Prepare whatever it takes to find out, and stop before anything changes to a scientific input.`
   Expect: proposals pinned to `density` and `product`, none on `heat`; a planned fork marked
   "expected · not yet run"; the agent stops. Click **Approve** on each pin.
3. `Approved. Build the bundle.`
   Expect: a 15-file ZIP. `density.in` and `product.in` read `temp0=310.0`; `heat.in` still reads
   `300.0`; `run_analysis.sh` carries this system's own masks.

Verify every step in the **Tool activity** card at the bottom of the right-hand rail: each line names
the tool and says `via agent / WebMCP`. Chrome DevTools → Application → WebMCP lists the same seventeen
tools and can run any of them by hand.

### Execution

- 14 real runs (13 × Trp-cage + indole at 2–30 ps production, 9 on Amber 26 PMEMD and 4 on Amber 24
  SANDER; 1 × T4 lysozyme L99A/M102Q + 2-propylphenol), extracted from AMBER artifacts by a script
  that never types a number into a manifest.
- The `.in` validator is a line-for-line port of an internship pipeline's Python checker, pinned to it
  by a generated oracle. 697 tests.
- The rerun bundle carries the MD inputs, a cluster script and the MM-GBSA recipe with every parameter
  read from the run's own manifest. We ran the generated recipe unmodified against the archived
  trajectory: it reproduced the archived ΔG to 0.001 kcal/mol (−19.1939 vs −19.1953), and the
  execution caught a real bug no file inspection had found.
- The live site was adversarially tested across eight batches by a second AI agent (OpenAI Codex)
  driving the production URL over WebMCP in a real browser.

### Potential impact

The loop has already closed once. We took `1l2y-rep4`'s bundle to Georgia Tech's PACE-ICE cluster,
ran it four times with fresh seeds, and extracted the results back as child cards with lineage to the
parent. They came back on a different engine, shifted 1.7 kcal/mol, and the page says so: it names the
engine and the seeds as confounded, refuses to call the shift significant, and does not count the four
toward the parent's matched replication. Among themselves the four are a matched set, so they are the
only runs on the site with an earned error bar (−17.51 ± 0.54, n = 4). Every rerun is a full record
with its own ladder and its own next step; the tree branches again from any node; the same tools work
on every system; and the reruns were executed under a different account, from a bundle. That is what
shared computational science should feel like, and WebMCP is what lets an agent drive it.

### Creativity

The confidence ladder: five rungs (recomputable, repeatable, independently replicated, robust to
analysis-window choices, externally supported), each earned from archived files or honestly refused.
One rule governs every noise claim: only same-engine, same-length replicates can produce an error bar;
everything pooled is descriptive dispersion. The page holds itself to that rule even when it costs the
headline run its "replicated" badge. Automode reads the ladder and decides what to investigate, so the
same run yields a different investigation after its evidence changes, and it creates nothing.

### What's next

The 310 K extension and its 300 K control are prepared, approved and bundled on the site right now.
Run both on the cluster, extract the children, and the page will compare them against each other and
their parent, closing the loop for a controlled change the way it already closed for replication.

## Built with

`webmcp` · `typescript` · `react` · `vite` · `bun` · `vitest` · `amber` · `python` · `vercel`

## Links

- Live (judges test here): https://runcard.vercel.app/#/run/1l2y-rep4
- Repo: https://github.com/zhoism/runcard
- Video: (YouTube link)
