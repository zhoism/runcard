import { describe, it, expect } from "vitest";
import { mean, sd, sem, autocorrelation, statisticalInefficiency, correctedSem, blockAverageSem, halves, driftSlope, runningMean, projectedSem } from "../src/lib/stats";

// Deterministic LCG so the tests are reproducible.
function rng(seed: number) { let s = seed >>> 0; return () => { s = (1664525 * s + 1013904223) >>> 0; return s / 2 ** 32; }; }
function gauss(r: () => number) { const u = 1 - r(), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
/** AR(1): x_t = φ·x_{t−1} + ε_t. Its statistical inefficiency is (1+φ)/(1−φ) in the long-series limit. */
function ar1(n: number, phi: number, seed = 1) { const r = rng(seed); const x = [gauss(r)]; for (let i = 1; i < n; i++) x.push(phi * x[i - 1] + gauss(r)); return x; }

describe("basic moments", () => {
  it("mean/sd/sem with both ddof conventions", () => {
    const x = [2, 4, 4, 4, 5, 5, 7, 9];
    expect(mean(x)).toBe(5); expect(sd(x, 0)).toBeCloseTo(2, 10); expect(sd(x, 1)).toBeCloseTo(Math.sqrt(32 / 7), 10);
    expect(sem(x, 0)).toBeCloseTo(2 / Math.sqrt(8), 10);
  });
});

describe("autocorrelation and statistical inefficiency", () => {
  it("C(0) = 1 and white noise has g ≈ 1", () => {
    const x = ar1(20000, 0, 7);
    expect(autocorrelation(x, 5)[0]).toBe(1);
    const g = statisticalInefficiency(x); expect(g).toBeGreaterThanOrEqual(1); expect(g).toBeLessThan(1.15);
  });
  it("AR(1) with φ = 0.6 gives g ≈ (1+φ)/(1−φ) = 4", () => {
    const g = statisticalInefficiency(ar1(50000, 0.6, 3));
    expect(g).toBeGreaterThan(3.4); expect(g).toBeLessThan(4.6);
  });
  it("corrected SEM ≥ naive SEM, equal when g = 1", () => {
    const x = ar1(5000, 0.5, 11);
    expect(correctedSem(x)).toBeGreaterThan(sem(x)); expect(correctedSem(x, 1)).toBeCloseTo(sem(x), 12);
  });
  it("constant series is handled (g = 1, no NaN)", () => { expect(statisticalInefficiency([3, 3, 3, 3, 3, 3])).toBe(1); });
});

describe("block averaging", () => {
  it("plateau of block SEM for AR(1) approaches the corrected SEM", () => {
    const x = ar1(4000, 0.5, 5);
    const blocks = blockAverageSem(x, [1, 2, 4, 8, 16, 32, 64, 128]);
    expect(blocks[0].sem).toBeCloseTo(sem(x), 12);
    const plateau = blocks[blocks.length - 1].sem, target = correctedSem(x);
    expect(plateau / target).toBeGreaterThan(0.7); expect(plateau / target).toBeLessThan(1.4);
  });
  it("drops block sizes leaving fewer than 4 blocks", () => { expect(blockAverageSem(Array(10).fill(1), [1, 2, 3, 5]).map(b => b.block)).toEqual([1, 2]); });
});

describe("drift", () => {
  it("halves and slope detect a linear ramp; noise gives ≈ 0", () => {
    const ramp = Array.from({ length: 100 }, (_, i) => i * 0.1);
    expect(halves(ramp).diff).toBeCloseTo(5, 10); expect(driftSlope(ramp)).toBeCloseTo(0.1, 10);
    const noise = ar1(10000, 0, 9); expect(Math.abs(driftSlope(noise))).toBeLessThan(1e-3);
  });
  it("running mean", () => { expect(runningMean([1, 3, 5])).toEqual([1, 2, 3]); });
});

describe("projectedSem", () => {
  it("SD·√(g·Δ/L): scales as 1/√L", () => {
    expect(projectedSem(1, 4, 1, 400)).toBeCloseTo(0.1, 12);
    expect(projectedSem(1, 4, 1, 1600) / projectedSem(1, 4, 1, 400)).toBeCloseTo(0.5, 12);
  });
  it("a short AR(1) segment projects the corrected SEM of the full series to within a factor ~1.6", () => {
    const x = ar1(4000, 0.6, 21); const head = x.slice(0, 500);
    const pred = projectedSem(sd(head, 0), statisticalInefficiency(head), 1, x.length);
    const ratio = pred / correctedSem(x, undefined, 0);
    expect(ratio).toBeGreaterThan(0.6); expect(ratio).toBeLessThan(1.6);
  });
});
