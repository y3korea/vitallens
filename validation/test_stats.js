// Tests for js/stats.js:  node validation/test_stats.js
// 1) published reference values (Shrout & Fleiss 1979), 2) hand-computed cases,
// 3) randomized cross-check against an independently written Python implementation.
const assert = require("assert");
const { execFileSync } = require("child_process");
const path = require("path");
const S = require("../js/stats.js");

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log("ok  " + name);
}
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, expected ${b} (±${tol})`);

check("ICC — Shrout & Fleiss (1979) Table 2 example: ICC(1,1)=.17, ICC(2,1)=.29, ICC(3,1)=.71", () => {
  const m = [[9, 2, 5, 8], [6, 1, 3, 2], [8, 4, 6, 8], [7, 1, 2, 6], [10, 5, 6, 9], [6, 2, 4, 7]];
  const r = S.iccFromMatrix(m);
  near(r.icc1_1, 0.17, 0.005, "ICC(1,1)");
  near(r.icc2_1, 0.29, 0.005, "ICC(2,1)");
  near(r.icc3_1, 0.71, 0.005, "ICC(3,1)");
});

check("Bland–Altman hand-computed case", () => {
  const a = S.agreement([60, 70, 80, 90], [62, 69, 83, 90]);
  near(a.bias, 1.0, 1e-12, "bias");
  near(a.sdDiff, Math.sqrt(10 / 3), 1e-12, "SD of differences");
  near(a.loaLow, 1 - 1.96 * Math.sqrt(10 / 3), 1e-12, "lower LoA");
  near(a.loaHigh, 1 + 1.96 * Math.sqrt(10 / 3), 1e-12, "upper LoA");
  near(a.mae, 1.5, 1e-12, "MAE");
  near(a.rmse, Math.sqrt(3.5), 1e-12, "RMSE");
  near(a.mape, ((2 / 60 + 1 / 70 + 3 / 80) / 4) * 100, 1e-12, "MAPE");
  near(a.within5, 1, 1e-12, "within ±5");
});

check("Pearson on exact linear relations", () => {
  near(S.pearson([1, 2, 3, 4], [3, 5, 7, 9]), 1, 1e-12, "r=+1");
  near(S.pearson([1, 2, 3, 4], [9, 7, 5, 3]), -1, 1e-12, "r=-1");
});

check("Lin CCC penalizes a constant offset that Pearson ignores", () => {
  const x = [1, 2, 3, 4, 5];
  near(S.linCcc(x, x), 1, 1e-12, "identical");
  near(S.linCcc(x, x.map((v) => v + 10)), 4 / 104, 1e-12, "offset by 10");
  near(S.pearson(x, x.map((v) => v + 10)), 1, 1e-12, "pearson unaffected");
});

check("small n: MAE/bias from 1 pair, LoA from 2, correlations only from 3", () => {
  const one = S.agreement([70], [73]);
  near(one.mae, 3, 1e-12, "MAE n=1"); near(one.bias, 3, 1e-12, "bias n=1");
  assert.ok(Number.isNaN(one.sdDiff) && Number.isNaN(one.pearson), "SD / r undefined at n=1");
  const two = S.agreement([70, 80], [73, 79]);
  assert.ok(Number.isFinite(two.loaLow) && Number.isNaN(two.pearson), "LoA at n=2, r withheld");
  assert.strictEqual(S.agreement([], []).n, 0);
});

check("Randomized cross-check vs independent Python implementation (20 datasets)", () => {
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let t = 0; t < 20; t++) {
    const n = 10 + Math.floor(rand() * 60);
    const ref = Array.from({ length: n }, () => 55 + rand() * 90);
    const est = ref.map((v) => v + (rand() - 0.45) * 12);
    const js = S.agreement(ref, est);
    const py = JSON.parse(execFileSync("python3", [path.join(__dirname, "crosscheck_stats.py")], { input: JSON.stringify({ ref, est }) }).toString());
    for (const k of Object.keys(py)) near(js[k], py[k], 1e-9, `dataset ${t} ${k}`);
  }
});

let hasSciPy = true;
try { execFileSync("python3", ["-c", "import numpy, pandas, statsmodels"], { stdio: "ignore" }); } catch (e) { hasSciPy = false; }
if (!hasSciPy) console.log("SKIP Bland–Altman 2007 cross-check against statsmodels (pip install -r requirements.txt to run it)");
if (hasSciPy) check("Bland–Altman 2007 repeated measures: matches an independent Python ANOVA and statsmodels REML (balanced)", () => {
  let seed = 11;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const g = () => { let u = 0, v = 0; while (!u) u = rand(); while (!v) v = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  for (let t = 0; t < 6; t++) {
    const records = [];
    const nSub = 12 + t * 3, perSub = 4;
    for (let p = 0; p < nSub; p++) {
      const subjBias = g() * 3;                       // between-subject spread of the bias
      for (let k = 0; k < perSub; k++) { const ref = 60 + rand() * 80; records.push({ pid: "S" + p, ref, est: ref + 1 + subjBias + g() * 2 }); }
    }
    const js = S.agreementRepeated(records);
    const py = JSON.parse(execFileSync("python3", [path.join(__dirname, "crosscheck_stats.py")], { input: JSON.stringify({ records }) }).toString());
    ["bias", "sdTotal", "sdWithin", "sdBetween"].forEach((k) => near(js[k], py[k], 1e-9, `set ${t} ${k}`));
    if (py.remlVarB != null) { near(js.sdBetween ** 2, py.remlVarB, 1e-3 * Math.max(1, py.remlVarB), `set ${t} REML between variance`); near(js.sdWithin ** 2, py.remlVarW, 1e-3 * py.remlVarW, `set ${t} REML within variance`); }
  }
});

check("repeated measures: naive pooled LoA is too narrow when subjects differ; one pair per subject reduces to ordinary BA", () => {
  let seed = 5;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const records = [];
  for (let p = 0; p < 20; p++) { const sb = (rand() - 0.5) * 16; for (let k = 0; k < 5; k++) { const ref = 70 + rand() * 50; records.push({ pid: "P" + p, ref, est: ref + sb + (rand() - 0.5) * 2 }); } }
  const rep = S.agreementRepeated(records);
  const flat = S.agreement(records.map((r) => r.ref), records.map((r) => r.est));
  assert.ok(rep.sdTotal >= flat.sdDiff * 0.99, "variance-components SD is not smaller than the pooled SD here");
  const single = records.filter((r, i) => i % 5 === 0);
  const r1 = S.agreementRepeated(single), f1 = S.agreement(single.map((r) => r.ref), single.map((r) => r.est));
  near(r1.loaLow, f1.loaLow, 1e-12, "reduces to ordinary lower LoA");
  const ci = S.clusterBootstrapCi(records, (rs) => S.agreementRepeated(rs).loaHigh, { B: 400 });
  const ciNaive = S.clusterBootstrapCi(records.map((r, i) => Object.assign({}, r, { pid: "x" + i })), (rs) => S.agreement(rs.map((r) => r.ref), rs.map((r) => r.est)).loaHigh, { B: 400 });
  assert.ok(ci.high - ci.low > ciNaive.high - ciNaive.low, `participant bootstrap CI (${(ci.high - ci.low).toFixed(2)}) must be wider than treating 100 readings as independent (${(ciNaive.high - ciNaive.low).toFixed(2)})`);
});

check("t quantile and the participant-based LoA interval: matches scipy; conservative coverage with repeated readings", () => {
  [[3, 3.182], [5, 2.571], [9, 2.262], [19, 2.093], [47, 2.012], [100, 1.984]].forEach(([df, v]) => near(S.tQuantile975(df), v, 0.002, "t(" + df + ")"));
  let seed = 21;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const g = () => { let u = 0, v = 0; while (!u) u = rand(); while (!v) v = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  let cover = 0; const D = 400, n = 12, sd = Math.sqrt(13);
  for (let d = 0; d < D; d++) {
    const recs = [];
    for (let p = 0; p < n; p++) { const sb = g() * 3; for (let k = 0; k < 4; k++) { const ref = 70 + rand() * 40; recs.push({ pid: "P" + p, ref, est: ref + 1 + sb + g() * 2 }); } }
    const ci = S.loaCi(S.agreementRepeated(recs));
    if (ci.high.low <= 1 + 1.96 * sd && 1 + 1.96 * sd <= ci.high.high) cover++;
  }
  assert.ok(cover / D >= 0.93, `upper-LoA interval coverage ${(cover / D * 100).toFixed(1)}% (expected ≥93%)`);
  const few = S.agreementReport([{ pid: "A", ref: 70, est: 71 }, { pid: "A", ref: 80, est: 79 }, { pid: "B", ref: 90, est: 92 }]);
  assert.ok(!few.ciAvailable && Number.isNaN(few.ci.bias.low), "no intervals below the participant minimum");
});

console.log(`\n${passed} test groups passed`);
