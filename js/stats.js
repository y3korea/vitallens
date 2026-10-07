// VitalLens agreement statistics for method-comparison studies (rPPG vs reference device).
// Readings are clustered by participant, so limits of agreement use Bland & Altman (2007) and
// confidence intervals come from a participant-level bootstrap.
// Shared by validation.html and the Node tests (validation/test_stats.js).
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.VLStats = api;
})(typeof self !== "undefined" ? self : this, function () {
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const sampleSd = (a) => {
    if (a.length < 2) return NaN;
    const m = mean(a);
    return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
  };

  function pearson(x, y) {
    const mx = mean(x), my = mean(y);
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < x.length; i++) {
      sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2;
    }
    return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : NaN;
  }

  // Lin's concordance correlation coefficient (population moments, Lin 1989).
  function linCcc(x, y) {
    const n = x.length, mx = mean(x), my = mean(y);
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i++) {
      sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2;
    }
    sxy /= n; sxx /= n; syy /= n;
    const d = sxx + syy + (mx - my) ** 2;
    return d > 0 ? (2 * sxy) / d : NaN;
  }

  // Shrout & Fleiss (1979) ICCs from an n-targets x k-raters matrix (two-way ANOVA mean squares).
  function iccFromMatrix(m) {
    const n = m.length, k = m[0].length;
    const grand = mean(m.flat());
    const rowMeans = m.map((r) => mean(r));
    const colMeans = Array.from({ length: k }, (_, j) => mean(m.map((r) => r[j])));
    let ssTotal = 0;
    m.forEach((r) => r.forEach((v) => { ssTotal += (v - grand) ** 2; }));
    const ssRows = k * rowMeans.reduce((s, v) => s + (v - grand) ** 2, 0);
    const ssCols = n * colMeans.reduce((s, v) => s + (v - grand) ** 2, 0);
    const ssErr = ssTotal - ssRows - ssCols;
    const bms = ssRows / (n - 1);
    const jms = ssCols / (k - 1);
    const ems = ssErr / ((n - 1) * (k - 1));
    const wms = (ssCols + ssErr) / (n * (k - 1));
    return {
      icc1_1: (bms - wms) / (bms + (k - 1) * wms),
      icc2_1: (bms - ems) / (bms + (k - 1) * ems + (k * (jms - ems)) / n), // absolute agreement
      icc3_1: (bms - ems) / (bms + (k - 1) * ems),                         // consistency
    };
  }

  // Method comparison: est (e.g. rPPG) vs ref (e.g. pulse oximeter). Differences are est - ref.
  // Error measures need n >= 1; SD / limits of agreement need n >= 2; correlation-type
  // coefficients need n >= 3 to mean anything (with 2 points r is always ±1).
  function agreement(ref, est) {
    const n = Math.min(ref.length, est.length);
    if (n < 1) return { n: 0 };
    const r = ref.slice(0, n), e = est.slice(0, n);
    const diff = e.map((v, i) => v - r[i]);
    const bias = mean(diff);
    const sdDiff = n >= 2 ? sampleSd(diff) : NaN;
    return {
      n,
      bias,
      sdDiff,
      loaLow: bias - 1.96 * sdDiff,
      loaHigh: bias + 1.96 * sdDiff,
      mae: mean(diff.map(Math.abs)),
      rmse: Math.sqrt(mean(diff.map((d) => d * d))),
      mape: mean(diff.map((d, i) => Math.abs(d) / r[i])) * 100,
      within5: diff.filter((d) => Math.abs(d) <= 5).length / n,
      pearson: n >= 3 ? pearson(r, e) : NaN,
      ccc: n >= 3 ? linCcc(r, e) : NaN,
      icc2_1: n >= 3 ? iccFromMatrix(r.map((v, i) => [v, e[i]])).icc2_1 : NaN,
    };
  }

  // Bland & Altman (2007), multiple observations per subject where the true value varies:
  // one-way ANOVA of the differences by subject gives within- (MSw) and between-subject (MSb)
  // mean squares; sigma²_between = (MSb − MSw) / [(N² − Σm²) / ((n − 1)·N)], and the limits use
  // sigma_d = sqrt(sigma²_between + sigma²_within) around the mean of all differences.
  // records: [{pid, ref, est}]. With one pair per subject it reduces to the ordinary method.
  function agreementRepeated(records) {
    const groups = new Map();
    records.forEach((r) => { if (!groups.has(r.pid)) groups.set(r.pid, []); groups.get(r.pid).push(r.est - r.ref); });
    const subj = Array.from(groups.values());
    const n = subj.length, N = records.length;
    if (N < 2 || n < 1) return { N, n, bias: N ? mean(records.map((r) => r.est - r.ref)) : NaN, sdTotal: NaN, loaLow: NaN, loaHigh: NaN };
    const all = records.map((r) => r.est - r.ref);
    const bias = mean(all);
    if (N === n) {
      const sd = sampleSd(all);
      return { N, n, bias, sdWithin: NaN, sdBetween: NaN, sdTotal: sd, loaLow: bias - 1.96 * sd, loaHigh: bias + 1.96 * sd, method: "one pair per subject" };
    }
    if (n < 2) {
      const sd = sampleSd(all);
      return { N, n, bias, sdWithin: sd, sdBetween: NaN, sdTotal: sd, loaLow: bias - 1.96 * sd, loaHigh: bias + 1.96 * sd, method: "single subject (within-subject only)" };
    }
    let ssb = 0, ssw = 0, sumM2 = 0;
    subj.forEach((d) => {
      const m = mean(d);
      ssb += d.length * (m - bias) ** 2;
      d.forEach((v) => { ssw += (v - m) ** 2; });
      sumM2 += d.length * d.length;
    });
    const msb = ssb / (n - 1), msw = ssw / (N - n);
    const divisor = (N * N - sumM2) / ((n - 1) * N);
    const varB = Math.max(0, (msb - msw) / divisor);
    const sdTotal = Math.sqrt(varB + msw);
    return { N, n, bias, sdWithin: Math.sqrt(msw), sdBetween: Math.sqrt(varB), sdTotal, loaLow: bias - 1.96 * sdTotal, loaHigh: bias + 1.96 * sdTotal, msb, msw, method: "Bland–Altman 2007 (true value varies)" };
  }

  // Percentile bootstrap that resamples SUBJECTS (clusters) with replacement, so the interval
  // reflects how many people were measured, not how many readings. statFn(records) -> number.
  function clusterBootstrapCi(records, statFn, opts) {
    const o = Object.assign({ B: 2000, seed: 20260923, level: 0.95 }, opts || {});
    const byPid = new Map();
    records.forEach((r) => { if (!byPid.has(r.pid)) byPid.set(r.pid, []); byPid.get(r.pid).push(r); });
    const ids = Array.from(byPid.keys());
    if (ids.length < 3) return { low: NaN, high: NaN, B: 0 };
    let s = o.seed >>> 0;
    const rand = () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const vals = [];
    for (let b = 0; b < o.B; b++) {
      const sample = [];
      for (let i = 0; i < ids.length; i++) {
        const id = ids[Math.floor(rand() * ids.length)];
        byPid.get(id).forEach((r) => sample.push(Object.assign({}, r, { pid: id + "#" + i })));
      }
      const v = statFn(sample);
      if (Number.isFinite(v)) vals.push(v);
    }
    vals.sort((x, y) => x - y);
    const a = (1 - o.level) / 2;
    const pick = (p) => vals[Math.min(vals.length - 1, Math.max(0, Math.round(p * (vals.length - 1))))];
    return { low: pick(a), high: pick(1 - a), B: vals.length };
  }

  // 97.5% Student-t quantile: table for df ≤ 9, Cornish–Fisher expansion above (error < 0.001).
  const T975 = [NaN, 12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262];
  function tQuantile975(df) {
    if (df < 1) return NaN;
    if (df <= 9) return T975[Math.floor(df)];
    const z = 1.959963985;
    const g1 = (z ** 3 + z) / 4, g2 = (5 * z ** 5 + 16 * z ** 3 + 3 * z) / 96;
    const g3 = (3 * z ** 7 + 19 * z ** 5 + 17 * z ** 3 - 15 * z) / 384;
    const g4 = (79 * z ** 9 + 776 * z ** 7 + 1482 * z ** 5 - 1920 * z ** 3 - 945 * z) / 92160;
    return z + g1 / df + g2 / df ** 2 + g3 / df ** 3 + g4 / df ** 4;
  }

  // CI for each limit of agreement: Bland & Altman's (1986/1999) approximation with the number of
  // PARTICIPANTS as n — half-width = t(n−1)·SD_total·sqrt(1/n + 1.96²/(2(n−1))). With repeated
  // readings this is conservative; in our coverage simulation it held ≥94% from 10 participants,
  // whereas a percentile bootstrap covered only 80–90%.
  function loaCi(rep) {
    const n = rep.n;
    if (!(n >= 2) || !Number.isFinite(rep.sdTotal)) return null;
    const hw = tQuantile975(n - 1) * rep.sdTotal * Math.sqrt(1 / n + (1.96 * 1.96) / (2 * (n - 1)));
    return { low: { low: rep.loaLow - hw, high: rep.loaLow + hw }, high: { low: rep.loaHigh - hw, high: rep.loaHigh + hw }, halfWidth: hw };
  }

  const MIN_PARTICIPANTS_FOR_CI = 10;

  // Everything the validation page reports, with subject-level uncertainty. Intervals are only
  // produced from MIN_PARTICIPANTS_FOR_CI participants on; below that they are reported as not estimable.
  function agreementReport(records, opts) {
    const ref = records.map((r) => r.ref), est = records.map((r) => r.est);
    const flat = agreement(ref, est);
    const rep = agreementRepeated(records);
    const enough = rep.n >= MIN_PARTICIPANTS_FOR_CI;
    const ci = (fn) => (enough ? clusterBootstrapCi(records, fn, opts) : { low: NaN, high: NaN, B: 0 });
    const icc = (rs) => (rs.length >= 3 ? iccFromMatrix(rs.map((r) => [r.ref, r.est])).icc2_1 : NaN);
    const lc = enough ? loaCi(rep) : null;
    return Object.assign({}, flat, {
      participants: rep.n, pairs: rep.N, repeated: rep, ciAvailable: enough, minParticipantsForCi: MIN_PARTICIPANTS_FOR_CI,
      ci: {
        bias: ci((rs) => mean(rs.map((r) => r.est - r.ref))),
        loaLow: lc ? lc.low : { low: NaN, high: NaN },
        loaHigh: lc ? lc.high : { low: NaN, high: NaN },
        mae: ci((rs) => mean(rs.map((r) => Math.abs(r.est - r.ref)))),
        icc2_1: ci(icc),
      },
    });
  }

  return { mean, sampleSd, pearson, linCcc, iccFromMatrix, agreement, agreementRepeated, clusterBootstrapCi, agreementReport, tQuantile975, loaCi, MIN_PARTICIPANTS_FOR_CI };
});
