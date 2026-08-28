#!/usr/bin/env python3
"""Oracle: run the ORIGINAL check_amber.py over test/corpus/*.in, write JSON.
Regenerate with: python3 test/oracle/dump.py"""
import importlib.util, json, sys
from pathlib import Path
HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
CHECK = Path.home() / "Downloads/Single Particle/Single Particle/.claude/skills/md-param-check/checks/check_amber.py"
spec = importlib.util.spec_from_file_location("ca", CHECK); mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod; spec.loader.exec_module(mod)
out = {}
for f in sorted((ROOT / "test/corpus").glob("*.in")):
    rep = mod.check_amber_in(f)
    out[f.name] = [{"level": x.level, "rule": x.rule, "detail": x.detail} for x in rep.findings]
(HERE / "expected.json").write_text(json.dumps(out, indent=1, ensure_ascii=False))
print(f"{len(out)} files")
