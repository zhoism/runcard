// Time-series statistics for per-frame MM-GBSA energies. Pure functions; every formula is stated.
// Conventions: N = series length; sd uses the sample estimator (N−1) unless `ddof` says otherwise.

export function mean(x: number[]): number { return x.length ? x.reduce((a, b) => a + b, 0) / x.length : NaN; }

/** Standard deviation. ddof=1 → sample SD (divide by N−1); ddof=0 → population SD (what MMPBSA.py 14.0 reports). */
export function sd(x: number[], ddof = 1): number {
  const n = x.length; if (n - ddof <= 0) return NaN;
  const m = mean(x); return Math.sqrt(x.reduce((a, b) => a + (b - m) ** 2, 0) / (n - ddof));
}

/** Naive standard error of the mean, sd/√N — correct only if the N samples are independent. */
export function sem(x: number[], ddof = 1): number { return sd(x, ddof) / Math.sqrt(x.length); }

/** Normalised autocorrelation C(t) = ⟨(x_i−μ)(x_{i+t}−μ)⟩ / ⟨(x_i−μ)²⟩ for t = 0..maxLag (C(0) = 1). */
export function autocorrelation(x: number[], maxLag: number): number[] {
  const n = x.length, m = mean(x), d = x.map(v => v - m);
  const c0 = d.reduce((a, b) => a + b * b, 0) / n;
  if (c0 === 0) return [1, ...Array(Math.min(maxLag, n - 1)).fill(0)]; // zero variance: no correlation structure to speak of
  const out: number[] = [];
  for (let t = 0; t <= Math.min(maxLag, n - 1); t++) { let s = 0; for (let i = 0; i + t < n; i++) s += d[i] * d[i + t]; out.push(s / (n - t) / c0); }
  return out;
}

/**
 * Statistical inefficiency g = 1 + 2·Σ_{t=1}^{T} (1 − t/N)·C(t), summed until the first non-positive C(t)
 * (Chodera et al., J. Chem. Theory Comput. 2007; the pymbar `statisticalInefficiency` convention, with the
 * (1 − t/N) finite-length weight). g ≥ 1; N_eff = N / g is the number of effectively independent samples.
 */
export function statisticalInefficiency(x: number[]): number {
  const n = x.length; if (n < 4) return 1;
  const c = autocorrelation(x, n - 1);
  let g = 1;
  for (let t = 1; t < c.length; t++) { if (c[t] <= 0) break; g += 2 * (1 - t / n) * c[t]; }
  return Math.max(1, g);
}

/** Integrated autocorrelation time τ_int = (g − 1)/2 in units of the sampling interval (frames). */
export const integratedAutocorrelationTime = (g: number) => (g - 1) / 2;

/** SEM corrected for correlation: sd·√(g/N) = sd/√N_eff. */
export function correctedSem(x: number[], g = statisticalInefficiency(x), ddof = 1): number { return sd(x, ddof) * Math.sqrt(g / x.length); }

/**
 * Block-averaging SEM (Flyvbjerg & Petersen 1989): split the series into ⌊N/b⌋ contiguous blocks of size b,
 * SEM_b = sd(block means)/√(#blocks). Rises with b until blocks are independent, then plateaus at the true SEM.
 * Returns one entry per block size that leaves ≥ 4 blocks.
 */
export function blockAverageSem(x: number[], blockSizes = [1, 2, 4, 5, 10, 20, 25]): { block: number; blocks: number; sem: number }[] {
  const out = [];
  for (const b of blockSizes) {
    const nb = Math.floor(x.length / b); if (nb < 4) continue;
    const means = Array.from({ length: nb }, (_, i) => mean(x.slice(i * b, (i + 1) * b)));
    out.push({ block: b, blocks: nb, sem: sem(means) });
  }
  return out;
}

/** Mean of the first and second halves and their difference (second − first); a drift check. */
export function halves(x: number[]): { first: number; second: number; diff: number } {
  const h = Math.floor(x.length / 2); const first = mean(x.slice(0, h)), second = mean(x.slice(h));
  return { first, second, diff: second - first };
}

/** Least-squares slope of x against its index (units of x per frame). */
export function driftSlope(x: number[]): number {
  const n = x.length; if (n < 2) return 0;
  const mi = (n - 1) / 2, mx = mean(x);
  let num = 0, den = 0; for (let i = 0; i < n; i++) { num += (i - mi) * (x[i] - mx); den += (i - mi) ** 2; }
  return num / den;
}

/** Running mean r_k = mean(x_0..x_k), for the sparkline. */
export function runningMean(x: number[]): number[] { let s = 0; return x.map((v, i) => (s += v) / (i + 1)); }

export const round = (v: number, d = 4) => Number.isFinite(v) ? +v.toFixed(d) : v;

/** Expected corrected SEM of a run of length L ps at the same output cadence Δ (ps/frame): SD·√(g·Δ/L), where g·Δ = Δ + 2τ_ps and N = L/Δ frames. */
export const projectedSem = (sdFrame: number, g: number, framePs: number, lengthPs: number) => sdFrame * Math.sqrt(g * framePs / lengthPs);
