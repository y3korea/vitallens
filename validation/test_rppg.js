// Unit / regression tests for js/rppg-core.js:  node validation/test_rppg.js
const assert = require("assert");
const C = require("../js/rppg-core.js");

let passed = 0;
function check(name, fn) { fn(); passed++; console.log("ok  " + name); }
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, expected ${b} (±${tol})`);
const rms = (a) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);

function jitteredSignal(fn, seconds, seed) {
  let s = seed || 1;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const buf = [];
  let t = 0;
  while (t < seconds) { buf.push({ t, raw: fn(t) }); t += 0.05 + (rand() - 0.5) * 0.008; }
  return buf;
}

check("band-pass: -6 dB (0.5) at both cutoffs, unity in band, respiration removed (zero-phase Butterworth)", () => {
  const fs = 20, n = 240;
  const gain = (f) => {
    const x = Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * f * i) / fs));
    const y = C.bandpassZeroPhase(x, fs, 0.67, 3.0);
    return rms(y.slice(60, 180)) / rms(x.slice(60, 180));
  };
  near(gain(0.67), 0.5, 0.03, "gain at 0.67 Hz");
  near(gain(3.0), 0.5, 0.03, "gain at 3.0 Hz");
  near(gain(1.5), 1.0, 0.02, "gain at 1.5 Hz");
  assert.ok(gain(0.25) < 0.01, "respiration (0.25 Hz) must be removed");
  assert.ok(gain(6.0) < 0.01, "6 Hz must be removed");
});

check("resampleUniform reproduces a linear ramp exactly despite timer jitter", () => {
  const buf = jitteredSignal((t) => 3 * t + 1, 5, 3);
  const x = C.resampleUniform(buf, 20);
  x.forEach((v, i) => near(v, 3 * (buf[0].t + i / 20) + 1, 1e-9, "ramp sample " + i));
});

check("clean sinusoid 40–180 bpm recovered within 0.6 bpm (grid step)", () => {
  for (let bpm = 42; bpm <= 178; bpm += 8) {
    const r = C.processSignal(jitteredSignal((t) => 100 + Math.sin((2 * Math.PI * bpm * t) / 60), 12, bpm));
    assert.ok(r.bpm != null, "estimate withheld at " + bpm);
    near(r.bpm, bpm, 0.61, "bpm " + bpm);
  }
});

check("REGRESSION: 50 bpm pulse with dicrotic wave is not double-counted (v1 bug)", () => {
  const ibi = 60 / 50;
  const pulse = (t) => {
    const dt = ((t % ibi) + ibi) % ibi;
    return Math.exp(-((dt - 0.15 * ibi) ** 2) / (2 * (0.07 * ibi) ** 2)) + 0.45 * Math.exp(-((dt - 0.45 * ibi) ** 2) / (2 * (0.09 * ibi) ** 2));
  };
  const buf = jitteredSignal((t) => 100 + pulse(t), 12, 5);
  near(C.processSignal(buf).bpm, 50, 1, "v1.5 estimate");
  const v1 = C.processSignalV1(buf).bpm;
  assert.ok(v1 == null || Math.abs(v1 - 50) > 5, "sanity: v1 is expected to fail this case (documents the bug)");
});

check("pure noise is withheld, not guessed", () => {
  let s = 9;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  let withheld = 0;
  for (let k = 0; k < 50; k++) {
    const buf = jitteredSignal(() => 100 + (rand() - 0.5), 12, k + 11);
    if (C.processSignal(buf).bpm == null) withheld++;
  }
  assert.ok(withheld >= 45, `withheld ${withheld}/50 pure-noise windows (expected ≥45)`);
});

check("no number before the 12-s window is full (the gate was tuned on full windows only)", () => {
  for (const sec of [3, 8, 11]) {
    const r = C.processSignal(jitteredSignal((t) => 100 + Math.sin(2 * Math.PI * 1.2 * t), sec, 2));
    assert.strictEqual(r.bpm, null, sec + " s");
    assert.ok(r.collecting && /모으는 중/.test(r.quality));
  }
});

check("REGRESSION: time-trimmed window gives a BPM at 20, 60 and 120 Hz sampling (demo simulation bug)", () => {
  // The demo once pushed one sample per animation frame into a buffer capped by COUNT (240),
  // so at 60–120 Hz it never held 6 s and no number ever appeared. pushSample trims by TIME.
  for (const hz of [20, 60, 120]) {
    const buf = [];
    let first = null;
    for (let i = 0; i <= 14 * hz; i++) {
      const t = i / hz;
      C.pushSample(buf, { t, raw: 100 + Math.sin(2 * Math.PI * 1.25 * t) }, C.DEFAULTS.bufferSeconds);
      if (i % Math.round(hz / 5) === 0 && first == null) { const r = C.processSignal(buf); if (r.bpm != null) first = { t, bpm: r.bpm }; }
    }
    assert.ok(first && first.t <= 12.5, `${hz} Hz: first BPM at ${first && first.t}`);
    near(first.bpm, 75, 0.61, `${hz} Hz estimate`);
    assert.ok(C.windowSpan(buf) <= C.DEFAULTS.bufferSeconds + 1e-9);
  }
});

check("sparse or gappy sampling is withheld, not interpolated into a confident number", () => {
  const sparse = [];
  for (let t = 0; t <= 12.2; t += 0.9) sparse.push({ t, raw: 100 + Math.sin(2 * Math.PI * 1.1 * t) });
  const r = C.processSignal(sparse);
  assert.ok(r.bpm == null && r.sparse, "1 Hz sampling must be withheld");
  const gappy = jitteredSignal((t) => 100 + Math.sin(2 * Math.PI * 1.2 * t), 12.3, 4).filter((s) => s.t < 5 || s.t > 5.6);
  assert.strictEqual(C.processSignal(gappy).bpm, null, "a 0.6-s gap must be withheld");
});

check("SNR template counts every in-band harmonic: a clean slow pulse is not penalised (v1.5 issue)", () => {
  const snrAt = (bpm) => {
    const ibi = 60 / bpm;
    const pulse = (t) => { const dt = ((t % ibi) + ibi) % ibi; return Math.exp(-((dt - 0.15 * ibi) ** 2) / (2 * (0.07 * ibi) ** 2)) + 0.45 * Math.exp(-((dt - 0.45 * ibi) ** 2) / (2 * (0.09 * ibi) ** 2)); };
    return C.processSignal(jitteredSignal((t) => 100 + pulse(t), 12, bpm)).snrDb;
  };
  const s50 = snrAt(50), s80 = snrAt(80);
  assert.ok(s50 > 12 && s80 > 12, `clean pulses must score high: 50 bpm ${s50.toFixed(1)} dB, 80 bpm ${s80.toFixed(1)} dB`);
});

check("POS cancels a pure intensity (all-channel) disturbance that corrupts the green channel", () => {
  const pbv = { r: 0.33, g: 0.77, b: 0.53 }, dc = { r: 144, g: 106, b: 86 };
  const buf = [];
  for (let t = 0; t < 12; t += 0.05) {
    const pulse = 0.005 * Math.sin(2 * Math.PI * 1.2 * t);          // 72 bpm
    const inten = 0.02 * Math.sin(2 * Math.PI * 1.7 * t);           // 102 bpm intensity motion, 4x stronger
    const ch = (c) => dc[c] * (1 + pbv[c] * pulse + inten);
    buf.push({ t, r: ch("r"), g: ch("g"), b: ch("b") });
  }
  near(C.processSignal(buf, { method: "pos" }).bpm, 72, 1, "POS estimate");
  near(C.processSignal(buf, { method: "green" }).bpm, 102, 1, "green locks onto the disturbance (expected)");
});

console.log(`\n${passed} test groups passed`);
