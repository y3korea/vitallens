// VitalLens rPPG core — the single implementation shared by the browser demo,
// the validation tool, and the Node simulation verifier (validation/sim_verify.js).
//
// v1.6 estimator (processSignal):
//   12-s window (time-trimmed, see pushSample) -> uniform resampling -> 4th-order Butterworth
//   band-pass 0.67–3.0 Hz, zero-phase (forward+backward) -> Hann-windowed spectrum on a 0.01 Hz grid
//   -> dominant frequency -> spectral SNR gate (estimates below the gate are withheld, not guessed).
// No number is produced until the window is full (minSeconds ≈ bufferSeconds), because the gate was
// tuned on full 12-s windows only.
// Default channel is green; POS (RGB) is available for side-by-side comparison on real recordings.
// The SNR gate was chosen by 5-fold cross-validation in validation/sim_verify.js.
// v1.5 -> v1.6: SNR template counts every in-band harmonic (v1.5 counted only f and 2f, which
// penalised slow heart rates), and displayed values need a full window.
// v1 estimator (processSignalV1) is kept only so the simulation can report before/after.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.VLRppgCore = api;
})(typeof self !== "undefined" ? self : this, function () {
  const DEFAULTS = {
    method: "green",  // "green" (single channel) or "pos" (RGB)
    posWindowS: 1.6,  // POS temporal-normalization window (Wang et al. 2017 use ~1.6 s)
    sampleHz: 20,
    bufferSeconds: 12,
    minSeconds: 11.5, // a full 12-s window, allowing for timer jitter
    bandLoHz: 0.67,   // 40 bpm
    bandHiHz: 3.0,    // 180 bpm
    gridStepHz: 0.01, // 0.6 bpm spectral grid
    peakHalfWidthHz: 0.12,
    snrRejectDb: 2,   // withhold estimate below this
    snrGoodDb: 5,
    minFillFraction: 0.8, // at least 80% of the expected samples in the window
    maxGapS: 0.25,        // and no gap longer than this (background-tab throttling, stalls)
  };

  function movingAverage(arr, windowSize) {
    const out = new Array(arr.length).fill(0);
    let sum = 0;
    for (let i = 0; i < arr.length; i++) {
      sum += arr[i];
      if (i >= windowSize) sum -= arr[i - windowSize];
      out[i] = sum / Math.min(i + 1, windowSize);
    }
    return out;
  }

  // Linear interpolation of jittered {t, <key>} samples onto a uniform grid.
  function resampleUniform(buf, fs, key) {
    key = key || "raw";
    const t0 = buf[0].t, t1 = buf[buf.length - 1].t;
    const n = Math.floor((t1 - t0) * fs) + 1;
    const x = new Array(n);
    let j = 0;
    for (let i = 0; i < n; i++) {
      const t = t0 + i / fs;
      while (j < buf.length - 2 && buf[j + 1].t < t) j++;
      const a = buf[j], b = buf[j + 1] || a;
      const span = b.t - a.t;
      x[i] = span > 0 ? a[key] + ((b[key] - a[key]) * (t - a.t)) / span : a[key];
    }
    return x;
  }

  // Plane-Orthogonal-to-Skin (POS), Wang, den Brinker, Stuijk & de Haan, IEEE TBME 2017.
  // Temporal normalization per short window cancels intensity changes shared by R, G, B
  // (illumination, much of the motion); projection onto the plane orthogonal to the skin tone
  // keeps the blood-volume pulse. Windows are overlap-added.
  function posSignal(buf, fs, windowS) {
    const R = resampleUniform(buf, fs, "r"), G = resampleUniform(buf, fs, "g"), B = resampleUniform(buf, fs, "b");
    const n = G.length, l = Math.max(4, Math.round(windowS * fs));
    const H = new Array(n).fill(0);
    const s1 = new Array(l), s2 = new Array(l);
    for (let t = 0; t + l <= n; t++) {
      let mr = 0, mg = 0, mb = 0;
      for (let i = t; i < t + l; i++) { mr += R[i]; mg += G[i]; mb += B[i]; }
      mr /= l; mg /= l; mb /= l;
      if (!(mr > 0 && mg > 0 && mb > 0)) continue;
      let m1 = 0, m2 = 0;
      for (let j = 0; j < l; j++) {
        const rn = R[t + j] / mr, gn = G[t + j] / mg, bn = B[t + j] / mb;
        s1[j] = gn - bn;
        s2[j] = -2 * rn + gn + bn;
        m1 += s1[j]; m2 += s2[j];
      }
      m1 /= l; m2 /= l;
      let v1 = 0, v2 = 0;
      for (let j = 0; j < l; j++) { v1 += (s1[j] - m1) ** 2; v2 += (s2[j] - m2) ** 2; }
      const alpha = v2 > 0 ? Math.sqrt(v1 / v2) : 0;
      let hm = 0;
      for (let j = 0; j < l; j++) hm += s1[j] + alpha * s2[j];
      hm /= l;
      for (let j = 0; j < l; j++) H[t + j] += s1[j] + alpha * s2[j] - hm;
    }
    return H;
  }

  // RBJ audio-EQ-cookbook biquad coefficients, normalized by a0.
  function biquad(type, f0, fs, Q) {
    const w0 = (2 * Math.PI * f0) / fs, cw = Math.cos(w0), alpha = Math.sin(w0) / (2 * Q);
    let b0, b1, b2;
    if (type === "lowpass") { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2; }
    else { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2; }
    const a0 = 1 + alpha;
    return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: (-2 * cw) / a0, a2: (1 - alpha) / a0 };
  }

  function applyBiquad(c, x) {
    const y = new Array(x.length);
    let x1 = x[0], x2 = x[0], y1 = x[0] * (c.b0 + c.b1 + c.b2) / (1 + c.a1 + c.a2), y2 = y1; // steady-state init
    if (!isFinite(y1)) { y1 = 0; y2 = 0; }
    for (let i = 0; i < x.length; i++) {
      const v = c.b0 * x[i] + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
      x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
    }
    return y;
  }

  const BUTTER4_Q = [0.5411961, 1.3065630]; // 4th-order Butterworth section Qs

  function bandpassZeroPhase(x, fs, lo, hi) {
    const sections = [];
    BUTTER4_Q.forEach((q) => sections.push(biquad("highpass", lo, fs, q)));
    BUTTER4_Q.forEach((q) => sections.push(biquad("lowpass", hi, fs, q)));
    const mean = x.reduce((a, b) => a + b, 0) / x.length;
    let y = x.map((v) => v - mean);
    sections.forEach((c) => { y = applyBiquad(c, y); });
    y.reverse();
    sections.forEach((c) => { y = applyBiquad(c, y); });
    y.reverse();
    return y;
  }

  // Power of a Hann-windowed signal at each frequency on a fine grid (direct DFT per bin).
  function spectrum(x, fs, fLo, fHi, step) {
    const n = x.length;
    const w = x.map((v, i) => v * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1))));
    const freqs = [], power = [];
    for (let f = fLo; f <= fHi + 1e-9; f += step) {
      let re = 0, im = 0;
      const k = (2 * Math.PI * f) / fs;
      for (let i = 0; i < n; i++) { re += w[i] * Math.cos(k * i); im -= w[i] * Math.sin(k * i); }
      freqs.push(f); power.push(re * re + im * im);
    }
    return { freqs, power };
  }

  // Spectral SNR, adapted from de Haan & Jeanne (2013). They centre the template on the reference
  // heart rate, which makes it a correctness metric; here it is centred on the detected peak, so it
  // measures how distinct the peak is, not whether it is right — a periodic motion artifact makes a
  // distinct peak and can pass. Signal = power within ±hw of the peak and ±1.5·hw of every harmonic
  // inside the band; noise = the rest of the band. Result in dB.
  function spectralSnrDb(spec, f, hw) {
    const fMax = spec.freqs[spec.freqs.length - 1];
    const K = Math.max(1, Math.floor((fMax + hw) / f));
    let sig = 0, noise = 0;
    for (let i = 0; i < spec.freqs.length; i++) {
      const fi = spec.freqs[i];
      let inSig = Math.abs(fi - f) <= hw;
      for (let k = 2; k <= K && !inSig; k++) inSig = Math.abs(fi - k * f) <= 1.5 * hw;
      if (inSig) sig += spec.power[i];
      else noise += spec.power[i];
    }
    return 10 * Math.log10((sig + 1e-12) / (noise + 1e-12));
  }

  // Append a sample and drop samples older than the window, by time (not by count), so the window
  // holds the same 12 s whatever the sampling rate. Shared by the demo, validation tool and agent.
  function pushSample(buf, sample, windowS) {
    const w = windowS || DEFAULTS.bufferSeconds;
    buf.push(sample);
    while (buf.length > 1 && sample.t - buf[0].t > w) buf.shift();
    return buf;
  }
  function windowSpan(buf) { return buf.length > 1 ? buf[buf.length - 1].t - buf[0].t : 0; }

  // Heavy part: build the pulse signal (green channel, or POS when method "pos" and RGB are present),
  // then filter + spectrum. Independent of the decision threshold.
  function samplingOk(buf, o) {
    if (buf.length < o.minFillFraction * o.sampleHz * o.minSeconds) return false;
    for (let i = 1; i < buf.length; i++) if (buf[i].t - buf[i - 1].t > o.maxGapS) return false;
    return true;
  }

  function analyzeSignal(buf, opts) {
    const o = Object.assign({}, DEFAULTS, opts || {});
    if (buf.length < 2 || buf[buf.length - 1].t - buf[0].t < o.minSeconds) return null;
    if (!samplingOk(buf, o)) return null;   // interpolating across sparse samples invents structure
    const hasRgb = buf[0].r != null && buf[0].g != null && buf[0].b != null;
    const x = o.method === "pos" && hasRgb
      ? posSignal(buf, o.sampleHz, o.posWindowS)
      : resampleUniform(buf, o.sampleHz, buf[0].g != null ? "g" : "raw");
    const filtered = bandpassZeroPhase(x, o.sampleHz, o.bandLoHz, o.bandHiHz);
    const spec = spectrum(filtered, o.sampleHz, o.bandLoHz, o.bandHiHz, o.gridStepHz);
    return { filtered, spec };
  }

  // buf: [{t: seconds, g: number} or {t, raw}], optionally with r, b; time-ordered (timestamps may jitter)
  function processSignal(buf, opts) {
    const a = analyzeSignal(buf, opts);
    if (!a) {
      const o = Object.assign({}, DEFAULTS, opts || {});
      const left = Math.max(0, Math.ceil(o.minSeconds - windowSpan(buf)));
      if (left === 0 && buf.length > 1) return { bpm: null, quality: "측정 보류 — 표본이 부족합니다(화면을 켜 두고 다시)", qualityLevel: "none", filtered: [], sparse: true };
      return { bpm: null, quality: `신호 모으는 중… ${left}초`, qualityLevel: "none", filtered: [], collecting: true };
    }
    return decide(a, opts);
  }

  // Light part: pick the dominant frequency and apply the SNR gate.
  function decide(analysis, opts) {
    const o = Object.assign({}, DEFAULTS, opts || {});
    const { filtered, spec } = analysis;
    let iPeak = 0;
    for (let i = 1; i < spec.power.length; i++) if (spec.power[i] > spec.power[iPeak]) iPeak = i;
    const f = spec.freqs[iPeak];
    const snrDb = spectralSnrDb(spec, f, o.peakHalfWidthHz);
    const bpm = f * 60;
    if (snrDb < o.snrRejectDb) {
      return { bpm: null, rawBpm: bpm, snrDb, quality: "측정 보류 — 가만히, 밝은 곳에서 다시", qualityLevel: "none", filtered };
    }
    const good = snrDb >= o.snrGoodDb;
    return { bpm, snrDb, quality: good ? "양호" : "보통", qualityLevel: good ? "good" : "fair", filtered };
  }

  // v1 (peak counting) — retained for before/after comparison in the simulation report only.
  function processSignalV1(buf) {
    const FS = 20;
    if (buf.length < FS * 3) return { bpm: null };
    const raw = buf.map((s) => s.raw);
    const slow = movingAverage(raw, Math.round(FS * 1.5));
    const filtered = movingAverage(raw.map((v, i) => v - slow[i]), 2);
    const minDist = Math.round(FS * 0.35);
    const rms = Math.sqrt(filtered.reduce((a, v) => a + v * v, 0) / filtered.length) || 1;
    const peaks = [];
    for (let i = 2; i < filtered.length - 2; i++) {
      if (filtered[i] > rms * 0.35 && filtered[i] > filtered[i - 1] && filtered[i] >= filtered[i + 1] &&
          (peaks.length === 0 || i - peaks[peaks.length - 1] >= minDist)) peaks.push(i);
    }
    if (peaks.length < 3) return { bpm: null };
    const intervals = [];
    for (let i = 1; i < peaks.length; i++) intervals.push(buf[peaks[i]].t - buf[peaks[i - 1]].t);
    const bpm = 60 / (intervals.reduce((a, b) => a + b, 0) / intervals.length);
    return { bpm: bpm < 40 || bpm > 200 ? null : bpm };
  }

  // Mean R, G, B inside a fixed box at the centre of the frame (no face detection): the user lines
  // their face up with the on-screen guide oval.
  function roiRgbMean(ctx, w, h) {
    const bx = Math.round(w * 0.32), by = Math.round(h * 0.22);
    const bw = Math.max(1, Math.round(w * 0.36)), bh = Math.max(1, Math.round(h * 0.5));
    const frame = ctx.getImageData(bx, by, bw, bh).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < frame.length; i += 4) { r += frame[i]; g += frame[i + 1]; b += frame[i + 2]; n++; }
    return n ? { r: r / n, g: g / n, b: b / n } : { r: 0, g: 0, b: 0 };
  }

  return {
    DEFAULTS, movingAverage, resampleUniform, posSignal, biquad, bandpassZeroPhase, spectrum, spectralSnrDb,
    analyzeSignal, decide, processSignal, processSignalV1, roiRgbMean, pushSample, windowSpan, samplingOk, VERSION: "1.6",
  };
});
