#!/usr/bin/env bash
# Re-extract every manifest from its pipeline run directory (../project-prime), then rebuild index.json.
# The run_dir -> id mapping was recovered on 2026-08-28 by matching mmgbsa.dat DELTA TOTAL and the
# realized product-stage seed in product.out against the existing manifests.
set -euo pipefail
cd "$(dirname "$0")/.."
P=../project-prime
x() { python3 tools/extract_run.py "$P/$1" "$2" --title "$3"; }
x regression-1L2Y                          1l2y-regression "1L2Y + MOL (indole)"
x happy-path-fixed-run                     1l2y-rep1       "1L2Y + MOL, run 1"
x happy-path-run                           1l2y-rep2       "1L2Y + MOL, run 2"   # top-level dir, not runs/happy-path-run
x stage6-wire-test                         1l2y-rep3       "1L2Y + MOL, run 3"
x pipeline-async-run-pa-20260608-174611    1l2y-rep4       "1L2Y + MOL, run 4"
x pipeline-async-run-pa-20260608-194730    1l2y-rep5       "1L2Y + MOL, run 5"
x pipeline-async-run-pa-20260609-164047    1l2y-rep6       "1L2Y + MOL, run 6"
x pipeline-async-run-pa-20260609-213026    1l2y-rep7       "1L2Y + MOL, run 7"
x pipeline-async-run-pa-20260609-214553    1l2y-rep8       "1L2Y + MOL, run 8"
x new-target-run                           3htb-jz4        "3HTB + JZ4"
python3 tools/build_index.py
