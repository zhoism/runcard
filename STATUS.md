# STATUS — runcard

Updated 2026-08-28. Deadline **Sep 3 2026, 1:00 pm PDT** (Devpost, OpenAI WebMCP Challenge).

## Where it stands

| Area | State |
|---|---|
| Validator (`src/lib/amberCheck.ts`) | done — 11 rules, pinned to `check_amber.py` via `test/oracle/expected.json` over 553 inputs |
| Manifests (`public/runs/`) | done — 10 runs, all fields extracted from artifacts by `tools/extract_run.py` |
| Tools (`src/webmcp.ts`, `src/lib/runs.ts`) | done — 10 tools, one table drives WebMCP + in-page console |
| WebMCP in a real agent | **verified 2026-08-28** in ChatGPT's browser: tools listed, `validate_stage` logged, `propose_change` → Approve worked |
| Page renders | verified (headless Chrome): home, run, compare. WebGL-less browsers get a fallback instead of a crash |
| Deploy | `https://runcard.vercel.app` exists but **302s to Vercel SSO** — Deployment Protection must be turned off |
| Demo video, Devpost text | not started |
| UI polish | postponed |

`bun run test` (561) and `bun run build` pass at HEAD.

## Open decisions (human)

1. Turn off Vercel Authentication on the project (Settings → Deployment Protection).
2. Demo story. Recommended: `validate_stage` → `explain_result` → `propose_change` + Approve → `generate_rerun_bundle`.
3. Does `1l2y-regression` (5 ps production) belong in the n=9 ensemble statistics?

## Known thin spots (real, but a judge who pokes will find them)

- `explain_result.sign_claim` hardcodes "all give ΔG < 0"; the numbers are computed, the sentence is not conditional.
- `ensemble` defines "same prepared system" as ligand resname + protein atom count.
- `diff_runs` calls any differing key "material" unless it is one of `ntpr ntwx ntwr ioutfm`.
- Proposals live in page memory; a reload clears them. Intentional (nothing is authored here) — say so on the page.
- The rerun bundle needs the original `build/` inputs (mol2, frcmod, cleaned PDB); it is not self-sufficient.
- MMPBSA.py reports `100.8 complex frames`; shown verbatim and labelled, not rounded.

## Architecture

```
public/runs/<id>/manifest.json   ← tools/extract_run.py <run_dir> <id>   (reads artifacts only)
public/runs/index.json           ← list view + ensemble grouping
        │
src/lib/runs.ts     pure functions: validateStage/All, ensemble, explainResult, diffRuns,
                    makeProposal/applyEdits, rerunBundle/zipBundle          (test/runs.test.ts)
src/lib/amberCheck.ts   validator port                                     (test/amberCheck.test.ts, oracle-pinned)
        │
src/webmcp.ts       TOOLS[] — name, description, JSON schema, readOnly, run()
                    registerWebMCP(): navigator.modelContext.registerTool for each
                    callTool(): shared by the agent path and the in-page Tool Console; logs every call
        │
src/store.ts        tiny external store: route (hash), proposals, calls, bundle, webmcp status
src/App.tsx         Home / RunPage / ComparePage / Sidebar (Proposals, Bundle, Tool Console, Tool Calls)
src/Viewer.tsx      3Dmol viewer with WebGL fallback + error Boundary
```

Invariants (from CLAUDE.md): a number is a claim — every figure traces to a file; `propose_change` is the only
mutating tool and stops at the Approve button; read tools may navigate the page (`get_run_manifest`, `diff_runs`,
`propose_change`, `generate_rerun_bundle`) so the agent's actions are visible to the human.

## Tools

| tool | mutates | what it returns |
|---|---|---|
| `list_runs` | no | index: id, title, ligand, protein atoms, production ps, ΔG, PLIP? |
| `get_run_manifest` | no (navigates) | full manifest minus mdin text |
| `get_stage_input` | no | verbatim `.in` of one stage + restart source |
| `validate_stage` | no | PASS/WARN/FAIL findings for a stage, all stages, or supplied text |
| `explain_result` | no | ΔG meaning, SD/SEM caveat, seeds, run-to-run spread, warnings verbatim, provenance |
| `diff_runs` | no (navigates) | same-system?, system diff, per-stage &cntrl diff with meaning/materiality, interpretation |
| `get_ensemble` | no | n/mean/SD/min/max of ΔG across same-system runs |
| `propose_change` | **yes → pending** | bounded &cntrl edit, validated before/after, awaits Approve |
| `list_proposals` | no | proposals + status |
| `generate_rerun_bundle` | yes (page state) | .in files (approved edits applied), leap.in, run.sh, README, env pins |
