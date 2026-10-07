// VitalLens — rPPG heart-rate widget (demo page).
// Camera path: getUserMedia -> fixed centre ROI mean R,G,B at 20 Hz -> shared estimator
//   (js/rppg-core.js v1.6: 12-s window, zero-phase band-pass, spectrum, spectral SNR gate).
// Simulation path: a synthetic pulse sampled at the SAME 20 Hz into the SAME time-trimmed window
//   and estimator, so both modes exercise identical code. Drawing runs on requestAnimationFrame
//   only; sampling never depends on the display refresh rate.
(function () {
  const core = window.VLRppgCore;
  const SAMPLE_HZ = core.DEFAULTS.sampleHz;
  const WINDOW_S = core.DEFAULTS.bufferSeconds;

  let mode = "camera";
  let running = false;
  let gen = 0;                 // start generation: a late getUserMedia from an old start is discarded
  let stream = null, sampleTimer = null, tickTimer = null, rafId = null;
  let buffer = [];
  let lastLevel = null;
  let simBpmTruth = 68 + Math.random() * 12, simT0 = 0, simPhase = 0, simLastT = 0;

  const els = {};
  const q = (id) => document.getElementById(id);

  function secureContextOk() {
    return window.isSecureContext && navigator.mediaDevices && navigator.mediaDevices.getUserMedia;
  }

  function showContextWarningIfNeeded() {
    if (!secureContextOk()) {
      const warn = q("context-warning");
      const originEl = q("context-origin");
      if (warn) warn.style.display = "flex";
      if (originEl) originEl.textContent = location.origin || location.protocol;
      document.querySelectorAll('.mode-switch button[data-mode="camera"]').forEach((b) => { b.disabled = true; b.title = "보안 컨텍스트 필요"; });
    }
  }

  function setNotice(text) {
    const n = q("hr-notice");
    if (!n) return;
    n.hidden = !text;
    n.textContent = text || "";
  }

  function drawWave(canvas, filtered) {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const w = (canvas.width = canvas.clientWidth * devicePixelRatio);
    const h = (canvas.height = canvas.clientHeight * devicePixelRatio);
    ctx.clearRect(0, 0, w, h);
    if (!filtered.length) return;
    const min = Math.min(...filtered, -1e-6), max = Math.max(...filtered, 1e-6);
    const range = Math.max(max - min, 1e-6);
    ctx.beginPath();
    ctx.lineWidth = 2 * devicePixelRatio;
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--cardiac").trim() || "#e34948";
    filtered.forEach((v, i) => {
      const x = (i / (filtered.length - 1 || 1)) * w;
      const y = h - ((v - min) / range) * h;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  function drawSimFace(canvas, bpm) {
    const ctx = canvas.getContext("2d");
    const w = (canvas.width = canvas.clientWidth);
    const h = (canvas.height = canvas.clientHeight);
    const t = performance.now() / 1000;
    const beat = 0.5 + 0.5 * Math.sin(2 * Math.PI * (bpm / 60) * t);
    const r = Math.min(w, h) * (0.16 + 0.035 * beat);
    const grad = ctx.createRadialGradient(w / 2, h / 2, r * 0.2, w / 2, h / 2, r);
    grad.addColorStop(0, "#e3494888");
    grad.addColorStop(1, "#e3494800");
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(w / 2, h / 2, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,.5)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) * 0.22, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = "#fff"; ctx.font = "12px -apple-system, sans-serif"; ctx.textAlign = "center";
    ctx.fillText("시뮬레이션 — 합성 신호", w / 2, h - 16);
  }

  // ---------- camera mode ----------
  async function startCamera(myGen) {
    let s;
    try {
      s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: 320, height: 240 }, audio: false });
    } catch (err) {
      if (myGen !== gen) return;
      stop({ silent: true });
      setNotice("카메라를 쓸 수 없습니다(권한 거부 또는 장치 없음). 시뮬레이션으로 보려면 ‘시뮬레이션’을 선택하고 다시 시작하세요.");
      return;
    }
    if (myGen !== gen || !running) { s.getTracks().forEach((t) => t.stop()); return; } // stopped while the prompt was open
    stream = s;
    els.video.srcObject = stream;
    els.video.style.display = "block";
    els.canvas.style.display = "none";
    try { await els.video.play(); } catch (e) { if (myGen === gen) { stop({ silent: true }); setNotice("카메라 영상을 재생하지 못했습니다. 다시 시도하세요."); } return; }
    if (myGen !== gen) return;
    q("hr-overlay").style.display = "none";
    buffer = [];
    const ctx = els.canvas.getContext("2d", { willReadFrequently: true });
    sampleTimer = setInterval(() => {
      if (!els.video.videoWidth) return;
      els.canvas.width = els.video.videoWidth;
      els.canvas.height = els.video.videoHeight;
      ctx.drawImage(els.video, 0, 0);
      const c = core.roiRgbMean(ctx, els.canvas.width, els.canvas.height);
      core.pushSample(buffer, { t: performance.now() / 1000, r: c.r, g: c.g, b: c.b }, WINDOW_S);
    }, 1000 / SAMPLE_HZ);
    tickTimer = setInterval(tick, 500);
  }

  // ---------- simulation mode ----------
  // Two-Gaussian pulse (systolic + diastolic), small HR drift, sensor noise; sampled at 20 Hz.
  function simSample() {
    const t = performance.now() / 1000;
    simBpmTruth = Math.max(58, Math.min(96, simBpmTruth + (Math.random() - 0.5) * 0.05));
    simPhase += (t - simLastT) * (simBpmTruth / 60);
    simLastT = t;
    const ph = simPhase % 1;
    const pulse = Math.exp(-((ph - 0.15) ** 2) / (2 * 0.07 ** 2)) + 0.3 * Math.exp(-((ph - 0.45) ** 2) / (2 * 0.09 ** 2));
    const noise = (Math.random() - 0.5) * 0.6;
    core.pushSample(buffer, { t, raw: 100 + pulse + 0.2 * Math.sin(2 * Math.PI * 0.25 * (t - simT0)) + noise }, WINDOW_S);
  }
  function startSim() {
    buffer = [];
    els.video.style.display = "none";
    els.canvas.style.display = "block";
    q("hr-overlay").style.display = "none";
    simT0 = simLastT = performance.now() / 1000;
    sampleTimer = setInterval(simSample, 1000 / SAMPLE_HZ);
    tickTimer = setInterval(tick, 500);
    const draw = () => { if (!running) return; drawSimFace(els.canvas, simBpmTruth); rafId = requestAnimationFrame(draw); };
    rafId = requestAnimationFrame(draw);
  }

  function tick() {
    const result = core.processSignal(buffer);
    q("hr-bpm").textContent = result.bpm ? Math.round(result.bpm) : "--";
    q("hr-quality").textContent = result.quality + (result.snrDb != null && result.bpm ? ` · 스펙트럼 SNR ${result.snrDb.toFixed(1)} dB` : "");
    drawWave(q("hr-wave"), result.filtered);
    const level = result.bpm ? "value" : result.collecting ? "collecting" : "withheld";
    if (level !== lastLevel) {
      lastLevel = level;
      const sr = q("hr-sr");
      if (sr) sr.textContent = level === "value" ? `심박 추정 ${Math.round(result.bpm)} bpm, 품질 ${result.quality}` : level === "withheld" ? "측정 보류 — 신호 품질이 낮습니다" : "";
    }
  }

  function switchMode(next) {
    mode = next;
    document.querySelectorAll('.mode-switch[data-widget="hr"] button').forEach((b) => {
      const on = b.dataset.mode === next;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", String(on));
    });
  }

  function start() {
    if (running) return;
    running = true;
    const myGen = ++gen;
    lastLevel = null;
    setNotice("");
    q("hr-start").disabled = true;
    q("hr-stop").disabled = false;
    q("hr-bpm").textContent = "--";
    q("hr-quality").textContent = mode === "camera" ? "카메라 권한을 기다리는 중…" : "신호 모으는 중…";
    if (mode === "camera" && secureContextOk()) startCamera(myGen);
    else { switchMode("sim"); startSim(); }
  }

  function stop(opts) {
    gen++;
    running = false;
    q("hr-start").disabled = false;
    q("hr-stop").disabled = true;
    if (sampleTimer) clearInterval(sampleTimer);
    if (tickTimer) clearInterval(tickTimer);
    if (rafId) cancelAnimationFrame(rafId);
    sampleTimer = tickTimer = rafId = null;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    if (els.video) { els.video.srcObject = null; els.video.style.display = "none"; }
    els.canvas.style.display = "none";
    q("hr-overlay").style.display = "grid";
    q("hr-overlay").textContent = "측정이 종료되었습니다. 다시 시작하려면 버튼을 눌러주세요.";
    if (!(opts && opts.silent)) q("hr-quality").textContent = "정지됨";
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (!q("hr-start")) return; // not on this page
    els.video = q("hr-video");
    els.canvas = q("hr-canvas");
    showContextWarningIfNeeded();
    switchMode(secureContextOk() ? "camera" : "sim");
    document.querySelectorAll('.mode-switch[data-widget="hr"] button').forEach((b) => {
      b.addEventListener("click", () => {
        if (b.disabled) return;
        if (running) stop();
        switchMode(b.dataset.mode);
        setNotice("");
      });
    });
    q("hr-start").addEventListener("click", start);
    q("hr-stop").addEventListener("click", () => stop());
    window.addEventListener("pagehide", () => { if (running) stop({ silent: true }); });
  });
})();
