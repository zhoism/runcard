# Executing the generated analysis — 2026-09-01

The claim under test: a rerun bundle from `generate_rerun_bundle` "reproduces the
card's headline ΔG." Until today that was a recipe no one had run.

## What was run

The exact 15-file pinned/local bundle for `1l2y-rep4`, emitted byte-for-byte as
the tool ships it (build inputs included), with the run's archived `comp_oct.top`
and `product.nc` placed in `md/` — i.e. "run.sh already ran" — then
`bash run_analysis.sh`, unmodified, on macOS with AmberTools from the
`prime-amber` conda env (`AMBERHOME` set, as any AMBER install has).

## Result

|                       | DELTA TOTAL | frame SD | frame SEM |
|-----------------------|------------:|---------:|----------:|
| archived (`mmgbsa.dat`, 2026-06-08) | −19.1953 | 1.7114 | 0.1711 |
| generated script, executed today    | −19.1939 | 1.7084 | 0.1708 |

Agreement to 1.4×10⁻³ kcal/mol — two orders below the frame SEM. The residual is
real and understood: the original pipeline handed MMPBSA.py the solvated
trajectory (`-sp comp_oct.top`, internal strip, no autoimage); the generated
script pre-strips with cpptraj and autoimages, and that re-centering re-rounds
float32 coordinates. All four steps ran: `ante-MMPBSA.py`, strip, `MMPBSA.py`,
and clustering (`rep.c0.pdb` produced — the card's 3D view).

## The bug this execution caught

The first execution, before the fix, returned **−18.7259** — 0.47 kcal/mol off —
because the script hardcoded `--radii=mbondi2` (inherited from the ICE replicate
script) while every archived analysis in this repo ran on **mbondi** topologies
(`analysis/comp_dry.top`, `%FLAG RADIUS_SET`). No amount of file inspection had
caught that: two adversarial browser batches verified the bundle's masks,
windows, and README and could not see a wrong radii set, because the manifests
did not record radii at all. Fix: `tools/extract_run.py` now reads `RADIUS_SET`
from the prmtop the archived MM-GBSA was actually handed and writes
`results.mmgbsa.radii` (+ `radii_source`); the generator emits `--radii` from
the manifest; the four ICE runs archived no dry topology, so their bundles omit
the flag and say so in the script and README rather than guessing.

Files here: `executed-run_analysis.sh` (as executed, byte-identical to what the
tool generates), `mmgbsa.dat` (the output the table above reads from),
`exec.log.tail`.
