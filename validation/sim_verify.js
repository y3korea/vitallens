// Simulation-based verification + cross-validation of the VitalLens rPPG estimators.
// Runs the exact browser code (js/rppg-core.js) on synthetic RGB signals with known ground truth.
// This measures ALGORITHM error under a stated signal model — it is NOT clinical accuracy.
//
//   node validation/sim_verify.js          -> full run (+ replications, sensitivity), writes data/sim_results.js
//   node validation/sim_verify.js --quick  -> small smoke test, writes nothing
//
// Estimators compared on identical signals:
//   v1    peak counting on the green channel (original demo)
//   green spectral + SNR gate on the green channel
//   pos   POS (Wang et al. 2017) on RGB, then the same spectral + SNR gate
//
// Protocol
//  1. Dataset: scenario (rest / periodic motion / illumination step) x SNR x true HR x trials.
//  2. 5-fold CV over trial index: for each spectral estimator, tune its SNR gate on 4 folds,
//     score on the held-out fold. (An earlier sub-harmonic check was dropped: every fold chose
//     "never switch", i.e. it never helped.)
//  3. Replication: new datasets from independent seeds, scored with the final parameters.
//  4. Sensitivity: (a) larger non-intensity (chromatic) share of the motion artifact;
//     (b) weaker diastolic wave (0.45 -> 0.15 of systolic), since facial rPPG in older, stiffer
//     arteries often shows little diastolic peak.
//  5. Risk–coverage: correct/wrong/output rates across the whole gate grid, and the gate each
//     wrong-answer penalty would pick (the 2 dB-type choice is a cost trade-off, not a data fact).
//  6. Recovery bias: heart rate falling after exercise stops, measured with the same 12-s still
//     window the agent uses, compared with the heart rate at the moment exercise stopped.
const fs = require("fs");
const path = require("path");
const core = require("../js/rppg-core.js");

const QUICK = process.argv.includes("--quick");
const MASTER_SEED = 20260923;
const REPLICATION_SEEDS = [11, 22, 33];
const HRS = [50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150];
const SNRS_DB = [10, 5, 0, -5, -10];
const SCENARIOS = [
  { key: "rest", label: "안정 — 백색잡음만" },
  { key: "motion", label: "주기적 움직임 (심박 대역 안, 녹색 채널에서 맥파와 같은 세기 — 실제 운동 움직임보다 약한 조건)" },
  { key: "step", label: "작은 밝기 변화 (창 안에서 1회, 맥파의 5배 = 밝기의 약 2.5%)" },
];
const TRIALS = QUICK ? 5 : 40;
const FOLDS = 5;
const DURATION_S = 20;
const FS = core.DEFAULTS.sampleHz;
const WINDOW_S = core.DEFAULTS.bufferSeconds;
const TOL_BPM = 5;
const WRONG_PENALTY = 3; // a confidently wrong reading costs 3x a withheld one (a design choice)
const PENALTIES = [1, 2, 3, 5];
const GRID = { snrRejectDb: [-9, -7, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 6, 8] };
const DC = { r: 144, g: 106, b: 86 };          // typical skin ROI means (8-bit)
const PBV = { r: 0.33, g: 0.77, b: 0.53 };      // blood-volume-pulse color signature (normalized RGB)
const CHROMA_MAIN = 0.3;                         // share of motion/step artifact NOT along the intensity axis
const CHROMA_SENSITIVITY = 0.6;
const DIA_MAIN = 0.45, DIA_SENSITIVITY = 0.15;   // diastolic wave amplitude relative to systolic
const RECOVERY = { hr0: [100, 120, 140], slopeBpmPerS: [0.3, 0.6, 1.0], delayS: 3, snrDb: 5, trials: 20 };
const METHODS = ["green", "pos"];

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(rand) {
  let u = 0, v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function randomUnit(rand) {
  const v = [gauss(rand), gauss(rand), gauss(rand)];
  const n = Math.hypot(v[0], v[1], v[2]) || 1;
  return { r: v[0] / n, g: v[1] / n, b: v[2] / n };
}

// Beat times with HRV (SDNN ~3% of mean IBI) + respiratory sinus arrhythmia (0.25 Hz).
// hr may be a number or a function of time (recovery analysis).
function beatTimes(hr, duration, rand) {
  const hrAt = typeof hr === "function" ? hr : () => hr;
  const times = [];
  let t = -(60 / hrAt(0)) * rand();
  while (t < duration + 2) {
    const ibi0 = 60 / hrAt(Math.max(0, t));
    const rsa = 0.03 * ibi0 * Math.sin(2 * Math.PI * 0.25 * t);
    t += Math.max(0.25, ibi0 + rsa + gauss(rand) * 0.03 * ibi0);
    times.push(t);
  }
  return times;
}

// Two-Gaussian PPG pulse: systolic peak + diastolic/dicrotic wave (amplitude `dia` of systolic,
// 0.30·IBI after it), scaled to beat period.
function pulseShape(dt, ibi, dia) {
  const sys = Math.exp(-((dt - 0.15 * ibi) ** 2) / (2 * (0.07 * ibi) ** 2));
  const d = dia * Math.exp(-((dt - 0.45 * ibi) ** 2) / (2 * (0.09 * ibi) ** 2));
  return sys + d;
}

function simulateSignal(hr, snrDb, rand, scenario, chroma, opts) {
  const dia = opts && opts.dia != null ? opts.dia : DIA_MAIN;
  const hr0 = typeof hr === "function" ? hr(0) : hr;
  const beats = beatTimes(hr, DURATION_S, rand);
  const ts = [];
  let t = 0;
  while (t < DURATION_S) {           // browser setInterval jitter: ±4 ms, occasional 20–60 ms stalls
    ts.push(t);
    let step = 1 / FS + (rand() - 0.5) * 0.008;
    if (rand() < 0.03) step += 0.02 + rand() * 0.04;
    t += step;
  }
  let bi = 0;
  const p = ts.map((tt) => {
    while (bi < beats.length - 1 && beats[bi] <= tt) bi++;
    const end = beats[bi];
    const start = bi === 0 ? end - 60 / hr0 : beats[bi - 1];
    return tt >= start && tt < end ? pulseShape(tt - start, end - start, dia) : 0;
  });
  const pm = p.reduce((a, b) => a + b, 0) / p.length;
  const pSd = Math.sqrt(p.reduce((a, v) => a + (v - pm) ** 2, 0) / p.length);
  // relative pulse modulation: green pulse RMS = 0.5% of DC (typical rPPG order of magnitude)
  const k = 0.005 / (PBV.g * pSd);
  const pulseRelG = PBV.g * k * pSd;                        // green pulse RMS, relative units
  const sigmaAbs = (DC.g * pulseRelG) / Math.sqrt(Math.pow(10, snrDb / 10)); // sensor noise per channel (abs)
  const phiResp = rand() * 2 * Math.PI;
  const fMotion = 0.8 + rand() * 1.7, phiMotion = rand() * 2 * Math.PI;
  const motionRms = pulseRelG;                              // equal to the pulse in green (relative)
  const motionAmp = (motionRms * Math.SQRT2) / Math.sqrt(1 + 0.3 * 0.3);
  const dirMotion = randomUnit(rand), dirStep = randomUnit(rand);
  const tStep = DURATION_S - WINDOW_S + 1 + rand() * (WINDOW_S - 2);
  let drift = 0;
  const all = ts.map((tt, i) => {
    drift += gauss(rand) * 0.02 * pulseRelG;
    let inten = 0.5 * pulseRelG * Math.sin(2 * Math.PI * 0.25 * tt + phiResp) + drift; // respiration + drift
    let chromaMod = { r: 0, g: 0, b: 0 };
    if (scenario === "motion") {
      const m = motionAmp * (Math.sin(2 * Math.PI * fMotion * tt + phiMotion) + 0.3 * Math.sin(4 * Math.PI * fMotion * tt + phiMotion));
      inten += (1 - chroma) * m;
      chromaMod = { r: chroma * m * dirMotion.r * Math.sqrt(3), g: chroma * m * dirMotion.g * Math.sqrt(3), b: chroma * m * dirMotion.b * Math.sqrt(3) };
    }
    if (scenario === "step" && tt >= tStep) {
      const s = 5 * pulseRelG;
      inten += (1 - chroma) * s;
      chromaMod = { r: chroma * s * dirStep.r * Math.sqrt(3), g: chroma * s * dirStep.g * Math.sqrt(3), b: chroma * s * dirStep.b * Math.sqrt(3) };
    }
    const pulse = k * (p[i] - pm);
    const ch = (c) => DC[c] * (1 + PBV[c] * pulse + inten + chromaMod[c]) + gauss(rand) * sigmaAbs;
    const r = ch("r"), g = ch("g"), b = ch("b");
    return { t: tt, r, g, b, raw: g };
  });
  const buf = [];                      // the browser's time-trimmed window (core.pushSample)
  all.forEach((smp) => core.pushSample(buf, smp, WINDOW_S));
  const inWin = beats.filter((bt) => bt >= buf[0].t && bt <= buf[buf.length - 1].t);
  const truth = inWin.length >= 2 ? 60 / ((inWin[inWin.length - 1] - inWin[0]) / (inWin.length - 1)) : hr;
  return { buf, truth };
}

function strip(a) { return a && a.spec ? { spec: a.spec, filtered: [] } : null; }

function buildDataset(seed, chroma, trials, opts) {
  const rand = mulberry32(seed);
  const rows = [];
  for (const sc of SCENARIOS) for (const snr of SNRS_DB) for (const hr of HRS) for (let k = 0; k < trials; k++) {
    const { buf, truth } = simulateSignal(hr, snr, rand, sc.key, chroma, opts);
    rows.push({
      scenario: sc.key, snrDb: snr, hr, trial: k, truth,
      an: { green: strip(core.analyzeSignal(buf, { method: "green" })), pos: strip(core.analyzeSignal(buf, { method: "pos" })) },
      estV1: core.processSignalV1(buf).bpm,
    });
  }
  return rows;
}

function est(row, method, params) {
  if (method === "v1") return row.estV1;
  const a = row.an[method];
  return a ? core.decide(a, params).bpm : null;
}

function metrics(pairs) {
  const n = pairs.length;
  const out = pairs.filter((p) => p.est != null);
  const errs = out.map((p) => p.est - p.truth);
  const abs = errs.map(Math.abs);
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const correct = abs.filter((e) => e <= TOL_BPM).length;
  return {
    n,
    outputRate: out.length / n,
    correctRate: correct / n,                  // of ALL trials: output and within ±5 bpm
    wrongRate: (out.length - correct) / n,     // of ALL trials: output but off by > 5 bpm
    mae: out.length ? avg(abs) : null,
    rmse: out.length ? Math.sqrt(avg(errs.map((e) => e * e))) : null,
    bias: out.length ? avg(errs) : null,
    within5OfOutput: out.length ? correct / out.length : null,
  };
}
const evalRows = (rows, method, params) => metrics(rows.map((r) => ({ truth: r.truth, est: est(r, method, params) })));
const objective = (m, penalty) => m.correctRate - (penalty || WRONG_PENALTY) * m.wrongRate;

function tune(rows, method, penalty) {
  let best = null;
  for (const s of GRID.snrRejectDb) {
    const params = { snrRejectDb: s };
    const sc = objective(evalRows(rows, method, params), penalty);
    if (!best || sc > best.score + 1e-12) best = { params, score: sc };
  }
  const g = GRID.snrRejectDb;
  const onEdge = best.params.snrRejectDb === g[0] || best.params.snrRejectDb === g[g.length - 1];
  return Object.assign(best, { onEdge });
}

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1 || 1)); };

function breakdown(rows, finalParams, keyFn) {
  const groups = {};
  rows.forEach((r) => { const k = keyFn(r); (groups[k] = groups[k] || []).push(r); });
  const res = {};
  for (const k of Object.keys(groups)) {
    res[k] = { v1: evalRows(groups[k], "v1") };
    METHODS.forEach((m) => { res[k][m] = evalRows(groups[k], m, finalParams[m]); });
  }
  return res;
}

// ---------------- run ----------------
const t0 = Date.now();
const data = buildDataset(MASTER_SEED, CHROMA_MAIN, TRIALS);
console.log(`dataset: ${data.length} signals (${SCENARIOS.length} scenarios x ${SNRS_DB.length} SNR x ${HRS.length} HR x ${TRIALS}) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

const cv = {};
for (const m of METHODS) {
  const folds = [];
  for (let f = 0; f < FOLDS; f++) {
    const train = data.filter((r) => r.trial % FOLDS !== f);
    const test = data.filter((r) => r.trial % FOLDS === f);
    const best = tune(train, m);
    folds.push({ fold: f, params: best.params, onEdge: best.onEdge, test: evalRows(test, m, best.params) });
  }
  const summary = {};
  ["outputRate", "correctRate", "wrongRate", "mae", "within5OfOutput"].forEach((k) => {
    const vals = folds.map((fr) => fr.test[k]).filter((v) => v != null);
    summary[k] = { mean: mean(vals), sd: sd(vals) };
  });
  cv[m] = { folds, summary };
}
const v1Held = (() => { // v1 has no parameters; report the same folds for comparability
  const folds = [];
  for (let f = 0; f < FOLDS; f++) folds.push(evalRows(data.filter((r) => r.trial % FOLDS === f), "v1"));
  const s = {};
  ["outputRate", "correctRate", "wrongRate", "mae", "within5OfOutput"].forEach((k) => { const v = folds.map((x) => x[k]).filter((x) => x != null); s[k] = { mean: mean(v), sd: sd(v) }; });
  return s;
})();

const finalParams = {}, finalTune = {};
METHODS.forEach((m) => { const b = tune(data, m); finalParams[m] = b.params; finalTune[m] = b; });
const defaultsMatch = finalParams[core.DEFAULTS.method].snrRejectDb === core.DEFAULTS.snrRejectDb;
if (!defaultsMatch) console.warn(`WARNING: tuned gate for default method (${finalParams[core.DEFAULTS.method].snrRejectDb} dB) != rppg-core DEFAULTS.snrRejectDb (${core.DEFAULTS.snrRejectDb} dB)`);

const byScenarioSnr = breakdown(data, finalParams, (r) => r.scenario + "|" + r.snrDb);
const byScenario = breakdown(data, finalParams, (r) => r.scenario);
const byHrRest = breakdown(data.filter((r) => r.scenario === "rest"), finalParams, (r) => String(r.hr));

// Risk–coverage over the whole gate grid, and the gate each penalty would pick (on the full dataset).
const riskCoverage = {}, penaltySensitivity = {};
METHODS.forEach((m) => {
  riskCoverage[m] = GRID.snrRejectDb.map((g) => Object.assign({ gate: g }, evalRows(data, m, { snrRejectDb: g })));
  penaltySensitivity[m] = PENALTIES.map((p) => { const b = tune(data, m, p); return Object.assign({ penalty: p, gate: b.params.snrRejectDb, onEdge: b.onEdge }, evalRows(data, m, b.params)); });
});

// Recovery bias: HR constant until exercise stops, then falls linearly; the 12-s still window
// starts RECOVERY.delayS after the stop (time to open the check-in and press measure).
function recoveryAnalysis(seed) {
  const rand = mulberry32(seed);
  const out = [];
  const tStop = DURATION_S - WINDOW_S - RECOVERY.delayS;
  for (const hr0 of RECOVERY.hr0) for (const slope of RECOVERY.slopeBpmPerS) {
    const hrFn = (t) => (t < tStop ? hr0 : hr0 - slope * (t - tStop));
    const errStop = [], errMean = [];
    let n = 0;
    for (let k = 0; k < RECOVERY.trials; k++) {
      n++;
      const { buf } = simulateSignal(hrFn, RECOVERY.snrDb, rand, "rest", CHROMA_MAIN);
      const r = core.processSignal(buf, { method: "green", snrRejectDb: finalParams.green.snrRejectDb });
      if (r.bpm == null) continue;
      const w0 = buf[0].t, w1 = buf[buf.length - 1].t;
      errStop.push(r.bpm - hr0);
      errMean.push(r.bpm - (hrFn(w0) + hrFn(w1)) / 2);
    }
    out.push({ hr0, slope, n, outputRate: errStop.length / n, biasVsStop: errStop.length ? mean(errStop) : null, biasVsWindowMean: errMean.length ? mean(errMean) : null, dropByWindowEnd: slope * (RECOVERY.delayS + WINDOW_S) });
  }
  return out;
}
const recovery = recoveryAnalysis(MASTER_SEED + 7);

const replications = [];
let sensitivity = null, diastolicSensitivity = null;
if (!QUICK) {
  for (const seed of REPLICATION_SEEDS) {
    const rep = buildDataset(seed, CHROMA_MAIN, TRIALS);
    const entry = { seed };
    ["v1", ...METHODS].forEach((m) => {
      entry[m] = { all: evalRows(rep, m, finalParams[m]) };
      SCENARIOS.forEach((sc) => { entry[m][sc.key] = evalRows(rep.filter((r) => r.scenario === sc.key), m, finalParams[m]); });
    });
    replications.push(entry);
  }
  const sens = buildDataset(MASTER_SEED + 1, CHROMA_SENSITIVITY, Math.max(10, Math.floor(TRIALS / 2)));
  sensitivity = { chroma: CHROMA_SENSITIVITY, byScenario: breakdown(sens, finalParams, (r) => r.scenario) };
  const weakDia = buildDataset(MASTER_SEED + 2, CHROMA_MAIN, Math.max(10, Math.floor(TRIALS / 2)), { dia: DIA_SENSITIVITY });
  diastolicSensitivity = { dia: DIA_SENSITIVITY, byScenario: breakdown(weakDia, finalParams, (r) => r.scenario), byHrRest: breakdown(weakDia.filter((r) => r.scenario === "rest"), finalParams, (r) => String(r.hr)) };
}

// ---------------- report ----------------
const f1 = (v) => (v == null ? "    -" : v.toFixed(1).padStart(5));
const pc = (v) => (v == null ? "    -" : (v * 100).toFixed(1).padStart(5));
const ms = (s, k, scale = 100, d = 1) => `${(s[k].mean * scale).toFixed(d)}±${(s[k].sd * scale).toFixed(d)}`;
console.log("\n=== 5-fold cross-validation, held-out folds (mean±SD) ===");
console.log(`v1     correct ${ms(v1Held, "correctRate")}%  wrong ${ms(v1Held, "wrongRate")}%  output ${ms(v1Held, "outputRate")}%  MAE ${ms(v1Held, "mae", 1, 2)}`);
METHODS.forEach((m) => {
  const s = cv[m].summary;
  console.log(`${m.padEnd(6)} correct ${ms(s, "correctRate")}%  wrong ${ms(s, "wrongRate")}%  output ${ms(s, "outputRate")}%  MAE ${ms(s, "mae", 1, 2)}`);
  console.log("       picked per fold: " + cv[m].folds.map((fr) => `${fr.params.snrRejectDb}dB${fr.onEdge ? " EDGE" : ""}`).join(" "));
});
console.log("\nfinal params: " + METHODS.map((m) => `${m}: snrReject=${finalParams[m].snrRejectDb} dB${finalTune[m].onEdge ? " [ON GRID EDGE]" : ""}`).join("   "));

for (const sc of SCENARIOS) {
  console.log(`\n[${sc.key}] ${sc.label}`);
  console.log("SNR  |  v1 wrong%   MAE | green out% corr% wrong%   MAE |  pos out% corr% wrong%   MAE");
  SNRS_DB.forEach((s) => {
    const c = byScenarioSnr[sc.key + "|" + s];
    console.log(`${String(s).padStart(4)} |     ${pc(c.v1.wrongRate)} ${f1(c.v1.mae)} |      ${pc(c.green.outputRate)} ${pc(c.green.correctRate)} ${pc(c.green.wrongRate)} ${f1(c.green.mae)} |     ${pc(c.pos.outputRate)} ${pc(c.pos.correctRate)} ${pc(c.pos.wrongRate)} ${f1(c.pos.mae)}`);
  });
}
if (replications.length) {
  console.log("\n=== Replication (independent seeds, final params): correct% / wrong% ===");
  replications.forEach((r) => console.log(`seed ${String(r.seed).padStart(2)}: ` + ["v1", ...METHODS].map((m) =>
    `${m} all ${pc(r[m].all.correctRate)}/${pc(r[m].all.wrongRate)} [` + SCENARIOS.map((sc) => `${sc.key} ${pc(r[m][sc.key].correctRate)}/${pc(r[m][sc.key].wrongRate)}`).join(", ") + "]").join("  ")));
  console.log(`\n=== Sensitivity: chromatic share of artifacts ${CHROMA_MAIN} -> ${CHROMA_SENSITIVITY}: correct% / wrong% ===`);
  SCENARIOS.forEach((sc) => {
    const b = sensitivity.byScenario[sc.key];
    console.log(`${sc.key.padEnd(7)} v1 ${pc(b.v1.correctRate)}/${pc(b.v1.wrongRate)}  green ${pc(b.green.correctRate)}/${pc(b.green.wrongRate)}  pos ${pc(b.pos.correctRate)}/${pc(b.pos.wrongRate)}`);
  });
}
console.log("\n=== Risk–coverage (green): gate -> output% / correct% / wrong% ===");
console.log(riskCoverage.green.map((r) => `${r.gate}dB ${pc(r.outputRate)}/${pc(r.correctRate)}/${pc(r.wrongRate)}`).join("  "));
console.log("=== Gate picked by wrong-answer penalty ===");
METHODS.forEach((m) => console.log(`${m.padEnd(6)} ` + penaltySensitivity[m].map((p) => `x${p.penalty}: ${p.gate}dB (correct ${pc(p.correctRate)}, wrong ${pc(p.wrongRate)})`).join("  ")));
console.log("=== Recovery bias (green, still window starts " + RECOVERY.delayS + " s after exercise stops) ===");
recovery.forEach((r) => console.log(`HR0 ${r.hr0}  slope ${r.slope} bpm/s  output ${pc(r.outputRate)}%  bias vs HR at stop ${f1(r.biasVsStop)}  vs window mean ${f1(r.biasVsWindowMean)}`));
if (diastolicSensitivity) {
  console.log(`=== Sensitivity: diastolic wave ${DIA_MAIN} -> ${DIA_SENSITIVITY}: correct% / wrong% ===`);
  SCENARIOS.forEach((sc) => { const b = diastolicSensitivity.byScenario[sc.key]; console.log(`${sc.key.padEnd(7)} v1 ${pc(b.v1.correctRate)}/${pc(b.v1.wrongRate)}  green ${pc(b.green.correctRate)}/${pc(b.green.wrongRate)}  pos ${pc(b.pos.correctRate)}/${pc(b.pos.wrongRate)}`); });
}
console.log(`\ntotal ${((Date.now() - t0) / 1000).toFixed(1)}s`);

if (!QUICK) {
  const out = {
    generatedBy: "node validation/sim_verify.js",
    masterSeed: MASTER_SEED, replicationSeeds: REPLICATION_SEEDS,
    trialsPerCell: TRIALS, folds: FOLDS, durationS: DURATION_S, windowS: WINDOW_S, sampleHz: FS,
    tolBpm: TOL_BPM, wrongPenalty: WRONG_PENALTY, grid: GRID, chromaMain: CHROMA_MAIN,
    hrs: HRS, snrsDb: SNRS_DB, scenarios: SCENARIOS, methods: ["v1", ...METHODS],
    estimatorVersion: core.VERSION, penalties: PENALTIES, recoverySetup: RECOVERY, diaMain: DIA_MAIN,
    model: "RGB skin ROI (DC 144/106/86); pulse along PBV signature [0.33,0.77,0.53], 2-Gaussian PPG shape (diastolic wave 45% of systolic, 0.30·IBI later), green pulse 0.5% of DC; HRV 3% SDNN + 0.25 Hz RSA; respiratory wander + illumination random walk (intensity axis); per-channel white sensor noise at the stated input SNR (green pulse RMS vs per-sample noise, 20 Hz); browser timer jitter; 12-s time-trimmed window as in the browser; motion = in-band periodic 0.8–2.5 Hz (+2nd harmonic) with RMS equal to green pulse, 70% intensity / 30% random chromatic direction; step = 5x pulse (about 2.5% of brightness), same split",
    defaultMethod: core.DEFAULTS.method, defaultsMatch, cv, v1Held, finalParams, byScenarioSnr, byScenario, byHrRest, replications, sensitivity,
    diastolicSensitivity, riskCoverage, penaltySensitivity, recovery,
  };
  fs.writeFileSync(path.join(__dirname, "..", "data", "sim_results.js"),
    "// Generated by validation/sim_verify.js — do not edit by hand.\nwindow.SIM_RESULTS = " + JSON.stringify(out) + ";\n");
  console.log("wrote data/sim_results.js");
}
