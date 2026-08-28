// Port of check_amber.py (md-param-check). Behaviour is pinned to the Python
// original by test/amberCheck.test.ts, which compares against an oracle dump
// produced by test/oracle/dump.py. Do not change a rule here without changing
// the Python and regenerating the oracle.

export const DT_MAX_SHAKE = 0.002;
export const DT_MAX_NOSHAKE = 0.001;
export const CUT_MIN = 8.0;
export const CUT_MAX = 12.0;
export const GAMMA_LN_MIN = 1.0;
export const GAMMA_LN_MAX = 5.0;

export type Level = "PASS" | "WARN" | "FAIL";
export interface Finding { level: Level; rule: string; detail: string }
export interface Report { findings: Finding[]; hasFail: boolean; hasWarn: boolean }

type Block = Record<string, string>;

const NAMELIST_RE = /&(\w+)\s*([\s\S]*?)\//g;
const KV_RE = /(\w+)\s*=\s*('[^']*'|"[^"]*"|[^\s,/]+)/g;
const COMMENT_RE = /('[^'\n]*'|"[^"\n]*")|!.*/g;

export function stripComments(text: string): string {
  return text.replace(COMMENT_RE, (_m, q) => q ?? "");
}

export function parseNamelists(content: string): Record<string, Block[]> {
  const out: Record<string, Block[]> = {};
  for (const m of content.matchAll(NAMELIST_RE)) {
    const name = m[1].toLowerCase();
    const body = stripComments(m[2]);
    const kvs: Block = {};
    for (const kv of body.matchAll(KV_RE)) {
      kvs[kv[1].toLowerCase()] = kv[2].replace(/^['"]+|['"]+$/g, "");
    }
    (out[name] ??= []).push(kvs);
  }
  return out;
}

// Python float(): accepts decimal, exponent (e/E), inf/nan, surrounding
// whitespace, underscores between digits. Rejects Fortran d-exponents.
const PY_FLOAT_RE = /^[+-]?((\d(_?\d)*)?\.?\d(_?\d)*([eE][+-]?\d(_?\d)*)?|\d(_?\d)*\.)$/;
export function num(v: string | undefined): number | null {
  if (v === undefined) return null;
  const s = v.trim();
  if (/^[+-]?(inf|infinity|nan)$/i.test(s)) return null;
  if (!PY_FLOAT_RE.test(s)) return null;
  const f = Number(s.replace(/_/g, ""));
  return Number.isFinite(f) ? f : null;
}

// Python's str(float) for the values we format into details.
function pyFloat(f: number): string {
  if (Number.isInteger(f) && Math.abs(f) < 1e16) return f.toFixed(1);
  let s = String(f);
  if (/e/.test(s)) {
    // JS: 1e-7 / 1.5e+21 ; Python: 1e-07 / 1.5e+21
    s = s.replace(/e([+-])(\d)$/, "e$10$2");
  }
  return s;
}

export function checkAmberIn(content: string): Report {
  const findings: Finding[] = [];
  const nl = parseNamelists(content);

  if (!nl["cntrl"]) {
    findings.push({ level: "FAIL", rule: "&cntrl missing", detail: "no &cntrl namelist found" });
    return finish(findings);
  }
  const c = nl["cntrl"][0];

  const numOrFail = (block: Block, key: string): number | null => {
    const raw = block[key];
    const v = num(raw);
    const rule = `${key} not a finite number`;
    if (raw !== undefined && v === null && !findings.some(f => f.rule === rule)) {
      findings.push({ level: "FAIL", rule, detail:
        `${key}=${raw} is not a plain finite decimal (nan/inf, an overflowing literal, ` +
        `or a Fortran d-exponent — pmemd reads 2.0d-3 but this validator refuses ` +
        `it by policy: write 0.002); refusing to treat it as absent` });
    }
    return v;
  };

  const imin = numOrFail(c, "imin") || 0;
  const isMin = imin === 1;

  const dt = numOrFail(c, "dt");
  const ntc = numOrFail(c, "ntc");
  const ntf = numOrFail(c, "ntf");
  const ntt = numOrFail(c, "ntt");
  const cut = numOrFail(c, "cut");
  const gammaLn = numOrFail(c, "gamma_ln");
  const temp0 = numOrFail(c, "temp0");
  numOrFail(c, "tempi");
  const nmropt = numOrFail(c, "nmropt") || 0;
  const ig = numOrFail(c, "ig");
  const ntp = numOrFail(c, "ntp");
  const barostat = numOrFail(c, "barostat");
  const nstlim = numOrFail(c, "nstlim");
  const iwrap = numOrFail(c, "iwrap");

  // dt + SHAKE
  if (!isMin && dt !== null) {
    const shakeOn = ntc === 2 && ntf === 2;
    if (shakeOn) {
      if (dt > DT_MAX_SHAKE + 1e-9)
        findings.push({ level: "FAIL", rule: "dt > 2 fs cap", detail: `dt=${pyFloat(dt)} ps with SHAKE on; SOP §3 cap is ${DT_MAX_SHAKE}` });
      else
        findings.push({ level: "PASS", rule: "dt", detail: `dt=${pyFloat(dt)} ps (within SHAKE-on cap)` });
    } else {
      if (dt > DT_MAX_NOSHAKE + 1e-9)
        findings.push({ level: "FAIL", rule: "dt > 1 fs cap (no SHAKE)", detail: `dt=${pyFloat(dt)} ps without SHAKE; need ntc=2 ntf=2 or dt≤${DT_MAX_NOSHAKE}` });
      else
        findings.push({ level: "PASS", rule: "dt", detail: `dt=${pyFloat(dt)} ps (no SHAKE; within cap)` });
    }
  }

  // SHAKE coherence
  if (!isMin && ntc !== null && ntf !== null) {
    if (ntc === 2 && ntf !== 2)
      findings.push({ level: "FAIL", rule: "SHAKE incoherent", detail: `ntc=2 (bonds-to-H constrained) but ntf=${pyFloat(ntf)} (should be 2 to skip those forces)` });
    else if (ntc === 1 && ntf === 1 && (dt || 0) >= 0.002 - 1e-9)
      findings.push({ level: "FAIL", rule: "dt too large without SHAKE", detail: `ntc=1 ntf=1 (no SHAKE) with dt=${dt === null ? "None" : pyFloat(dt)}; need SHAKE or smaller dt` });
  }

  // Restart coherence (comment-stripped re-parse, AMBER defaults applied)
  const rcntrl = parseNamelists(stripComments(content))["cntrl"]?.[0] ?? {};
  const ic = (key: string, def: number) => { const v = numOrFail(rcntrl, key); return v === null ? def : v; };
  const rImin = ic("imin", 0), rIrest = ic("irest", 0), rNtx = ic("ntx", 1);
  if (rImin === 0 && rIrest === 1 && ![4, 5, 6, 7].includes(rNtx))
    findings.push({ level: "FAIL", rule: "irest/ntx incoherent", detail:
      `irest=1 (restart) needs velocities but ntx=${Math.trunc(rNtx)} reads ` +
      `coordinates only; a restart requires ntx in {4,5,6,7} (5 standard)` });

  // cut
  if (cut !== null) {
    if (!(CUT_MIN - 1e-9 <= cut && cut <= CUT_MAX + 1e-9))
      findings.push({ level: "FAIL", rule: "cut out of range", detail: `cut=${pyFloat(cut)} Å outside [${pyFloat(CUT_MIN)}, ${pyFloat(CUT_MAX)}] for explicit solvent` });
    else
      findings.push({ level: "PASS", rule: "cut", detail: `cut=${pyFloat(cut)} Å` });
  }

  // Thermostat
  if (!isMin && ntt !== null) {
    if (ntt !== 3)
      findings.push({ level: "WARN", rule: "non-Langevin thermostat", detail: `ntt=${pyFloat(ntt)} (advisor demo uses ntt=3 Langevin); confirm intent` });
    else if (gammaLn !== null && !(GAMMA_LN_MIN <= gammaLn && gammaLn <= GAMMA_LN_MAX))
      findings.push({ level: "WARN", rule: "gamma_ln out of typical range", detail: `gamma_ln=${pyFloat(gammaLn)} outside [${pyFloat(GAMMA_LN_MIN)}, ${pyFloat(GAMMA_LN_MAX)}]` });
    else
      findings.push({ level: "PASS", rule: "thermostat", detail: `ntt=3 Langevin, gamma_ln=${gammaLn === null ? "None" : pyFloat(gammaLn)}` });
  }

  // temp0 vs &wt value2
  if (nmropt === 1 && nl["wt"]) {
    for (const wt of nl["wt"]) {
      if (wt["type"] === "TEMP0" || wt["type"] === "'TEMP0'") {
        const v2 = numOrFail(wt, "value2");
        if (v2 !== null && temp0 !== null && Math.abs(v2 - temp0) > 0.5)
          findings.push({ level: "WARN", rule: "temp0 / &wt mismatch", detail:
            `&cntrl temp0=${pyFloat(temp0)} but &wt TEMP0 ramp ends at value2=${pyFloat(v2)}; ` +
            `Langevin follows the &wt-set TEMP0, system ramps to value2. ` +
            `heat-3.in 2026-06-01 lesson — confirm intent.` });
        else if (v2 !== null && temp0 !== null)
          findings.push({ level: "PASS", rule: "temp0 / &wt coherent", detail: `temp0=${pyFloat(temp0)}, &wt ramp ends at ${pyFloat(v2)}` });
      }
    }
  }

  // Barostat / NPT
  if (!isMin && ntp !== null && barostat !== null) {
    if (ntp === 1 && ![1, 2].includes(barostat))
      findings.push({ level: "WARN", rule: "barostat choice", detail: `ntp=1 with barostat=${pyFloat(barostat)}; advisor demo uses barostat=2 (MC)` });
    if (ntp === 0 && [1, 2].includes(barostat))
      findings.push({ level: "WARN", rule: "barostat set but ntp=0", detail: `ntp=0 (no pressure scaling) but barostat=${pyFloat(barostat)} — harmless but confusing` });
  }

  // ig
  if (!isMin && ig !== null && ig !== -1)
    findings.push({ level: "WARN", rule: "fixed Langevin seed", detail: `ig=${pyFloat(ig)} (fixed); use ig=-1 for randomized seed unless determinism is required` });

  // iwrap on long production
  if (!isMin && nstlim !== null && nstlim >= 1_000_000) {
    if (iwrap === null || iwrap === 0)
      findings.push({ level: "WARN", rule: "iwrap=0 on long run", detail:
        `nstlim=${Math.trunc(nstlim).toLocaleString("en-US")} suggests production; set iwrap=1 to prevent ` +
        `diffusion artifacts in trajectory` });
  }

  return finish(findings);
}

function finish(findings: Finding[]): Report {
  return {
    findings,
    hasFail: findings.some(f => f.level === "FAIL"),
    hasWarn: findings.some(f => f.level === "WARN"),
  };
}
