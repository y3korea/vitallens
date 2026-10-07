// VitalLens — 30-second sit-to-stand (STS) counter, v1 prototype (NOT validated).
// Camera path: downsampled frame-differencing motion magnitude at 10 Hz.
// Counting: one repetition has TWO motion bursts (rising, then sitting back down) separated by a
// still moment at full stand. A hysteresis state machine finds bursts (enter above the high
// threshold, leave after staying below the low threshold) and counts a stand at the end of every
// odd burst — so a rep is not counted twice. Thresholds adapt to the last 6 s of motion.
// The 30-s clock starts only after the camera delivers frames. The agent page does NOT use this
// counter (patients type the count there); pose-based counting is on the roadmap.
(function () {
  const DURATION_S = 30;
  const SAMPLE_MS = 100;           // 10 Hz motion sampling
  const SMALL_W = 48, SMALL_H = 36;
  const MIN_BURST_S = 0.2, MIN_QUIET_S = 0.2, MIN_SPREAD = 2;

  let mode = "camera";
  let running = false, gen = 0;
  let stream = null, timerId = null, sampleTimer = null;
  let remaining = DURATION_S, bursts = 0;
  let prevFrame = null, motionBuf = [];
  let state = "quiet", stateSince = 0, aboveSince = null, belowSince = null;
  let clockStarted = false;
  let els = {};
  let simT0 = 0;

  const q = (id) => document.getElementById(id);
  const secureContextOk = () => window.isSecureContext && navigator.mediaDevices && navigator.mediaDevices.getUserMedia;
  const reps = () => Math.ceil(bursts / 2);   // stands completed (first burst is a rise)

  function drawWave(canvas, buf) {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const w = (canvas.width = canvas.clientWidth * devicePixelRatio);
    const h = (canvas.height = canvas.clientHeight * devicePixelRatio);
    ctx.clearRect(0, 0, w, h);
    if (buf.length < 2) return;
    const slice = buf.slice(-150);
    const max = Math.max(...slice.map((s) => s.val), 1e-6);
    ctx.beginPath();
    ctx.lineWidth = 2 * devicePixelRatio;
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--pulmonary").trim() || "#1baf7a";
    slice.forEach((s, i) => {
      const x = (i / (slice.length - 1 || 1)) * w;
      const y = h - (s.val / max) * h;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  function quantile(arr, p) {
    const a = arr.slice().sort((x, y) => x - y);
    return a[Math.min(a.length - 1, Math.max(0, Math.floor(p * (a.length - 1))))];
  }

  function registerMotionSample(val, t) {
    motionBuf.push({ t, val });
    while (motionBuf.length && t - motionBuf[0].t > 6) motionBuf.shift();
    drawWave(q("sts-wave"), motionBuf);
    if (motionBuf.length < 10) return;
    const vals = motionBuf.map((s) => s.val);
    const lo = quantile(vals, 0.2), hi = quantile(vals, 0.9);
    if (hi - lo < MIN_SPREAD) return;              // nothing is moving
    const high = lo + 0.5 * (hi - lo), low = lo + 0.25 * (hi - lo);
    if (state === "quiet") {
      if (val > high) { if (aboveSince == null) aboveSince = t; if (t - aboveSince >= MIN_BURST_S) { state = "burst"; stateSince = t; belowSince = null; } }
      else aboveSince = null;
    } else {
      if (val < low) { if (belowSince == null) belowSince = t; if (t - belowSince >= MIN_QUIET_S) { state = "quiet"; aboveSince = null; bursts++; q("sts-reps").textContent = reps(); } }
      else belowSince = null;
    }
  }

  function startClock() {
    if (clockStarted) return;
    clockStarted = true;
    q("sts-status").textContent = "시작! 팔짱을 끼고 완전히 일어섰다 앉기를 반복하세요.";
    const end = performance.now() + DURATION_S * 1000;   // wall-clock deadline, not a tick counter
    timerId = setInterval(() => {
      remaining = Math.max(0, Math.ceil((end - performance.now()) / 1000));
      q("sts-timer").textContent = formatTime(remaining);
      if (remaining <= 0) finish();
    }, 250);
  }

  // ---------- camera ----------
  async function startCamera(myGen) {
    q("sts-status").textContent = "카메라 권한을 기다리는 중… (시간은 아직 흐르지 않습니다)";
    let s;
    try {
      s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: 320, height: 240 }, audio: false });
    } catch (err) {
      if (myGen !== gen) return;
      reset();
      q("sts-status").textContent = "카메라를 쓸 수 없습니다. 시뮬레이션으로 보려면 ‘시뮬레이션’을 선택하고 다시 시작하세요.";
      return;
    }
    if (myGen !== gen || !running) { s.getTracks().forEach((t) => t.stop()); return; }
    stream = s;
    els.video.srcObject = stream;
    els.video.style.display = "block";
    els.canvas.style.display = "none";
    try { await els.video.play(); } catch (e) { if (myGen === gen) { reset(); q("sts-status").textContent = "카메라 영상을 재생하지 못했습니다."; } return; }
    if (myGen !== gen) return;
    q("sts-overlay").style.display = "none";
    prevFrame = null;
    const small = document.createElement("canvas");
    small.width = SMALL_W; small.height = SMALL_H;
    const sctx = small.getContext("2d", { willReadFrequently: true });
    sampleTimer = setInterval(() => {
      if (!els.video.videoWidth) return;
      sctx.drawImage(els.video, 0, 0, SMALL_W, SMALL_H);
      const frame = sctx.getImageData(0, 0, SMALL_W, SMALL_H).data;
      if (prevFrame) {
        let diff = 0;
        for (let i = 0; i < frame.length; i += 4) diff += Math.abs(frame[i] - prevFrame[i]);
        startClock();
        registerMotionSample(diff / (SMALL_W * SMALL_H), performance.now() / 1000);
      }
      prevFrame = frame;
    }, SAMPLE_MS);
  }

  // ---------- simulation ----------
  // One 2.6-s cycle: rise (0–0.9 s), still standing (0.9–1.3), sit (1.3–2.2), still seated (2.2–2.6).
  function simStand(c) { return c < 0.9 ? c / 0.9 : c < 1.3 ? 1 : c < 2.2 ? 1 - (c - 1.3) / 0.9 : 0; }
  function simMotion(c) {
    const bump = (a, b) => (c >= a && c < b ? Math.sin((Math.PI * (c - a)) / (b - a)) : 0);
    return 3 + 30 * (bump(0, 0.9) + bump(1.3, 2.2)) + Math.random() * 3;
  }
  function drawSimFigure(canvas, stand) {
    const ctx = canvas.getContext("2d");
    const w = (canvas.width = canvas.clientWidth);
    const h = (canvas.height = canvas.clientHeight);
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, w, h);
    const bodyH = h * (0.32 + 0.14 * stand);
    const cx = w / 2, groundY = h * 0.82;
    ctx.strokeStyle = "#1baf7a"; ctx.lineWidth = 6; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(cx, groundY); ctx.lineTo(cx, groundY - bodyH); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, groundY - bodyH - 14, 12, 0, Math.PI * 2); ctx.fillStyle = "#1baf7a"; ctx.fill();
    ctx.fillStyle = "#fff"; ctx.font = "12px -apple-system, sans-serif"; ctx.textAlign = "center";
    ctx.fillText("시뮬레이션 — 2.6초마다 1회", w / 2, h - 10);
  }
  function startSim() {
    q("sts-overlay").style.display = "none";
    els.video.style.display = "none";
    els.canvas.style.display = "block";
    simT0 = performance.now() / 1000;
    startClock();
    sampleTimer = setInterval(() => {
      const t = performance.now() / 1000;
      const c = (t - simT0) % 2.6;
      registerMotionSample(simMotion(c), t);
      drawSimFigure(els.canvas, simStand(c));
    }, SAMPLE_MS);
  }

  function stopCapture() {
    if (sampleTimer) clearInterval(sampleTimer);
    if (timerId) clearInterval(timerId);
    sampleTimer = timerId = null;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    if (els.video) { els.video.srcObject = null; els.video.style.display = "none"; }
    prevFrame = null;
  }

  function switchMode(next) {
    mode = next;
    document.querySelectorAll('.mode-switch[data-widget="sts"] button').forEach((b) => {
      const on = b.dataset.mode === next;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", String(on));
    });
  }

  function formatTime(s) { return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); }

  function resetCounters() {
    bursts = 0; remaining = DURATION_S; motionBuf = []; state = "quiet"; aboveSince = belowSince = null; clockStarted = false;
    q("sts-reps").textContent = "0";
    q("sts-timer").textContent = formatTime(remaining);
  }

  function start() {
    if (running) return;
    running = true;
    const myGen = ++gen;
    resetCounters();
    q("sts-start").disabled = true;
    if (mode === "camera" && secureContextOk()) startCamera(myGen);
    else { switchMode("sim"); startSim(); }
  }

  function finish() {
    gen++;
    running = false;
    stopCapture();
    q("sts-start").disabled = false;
    const n = reps();
    const how = mode === "sim" ? "시뮬레이션" : "카메라 자동 계수 — 검증 전 시험 기능이므로 직접 센 횟수와 비교하세요";
    q("sts-overlay").style.display = "grid";
    q("sts-overlay").innerHTML = `완료 — 총 ${n}회 (${how}). <a href="evidence.html#effects">30초 앉았다일어서기 근거 보기</a>`;
    q("sts-status").textContent = `30초 종료 — 총 ${n}회`;
    els.canvas.style.display = "none";
  }

  function reset() {
    gen++;
    running = false;
    stopCapture();
    resetCounters();
    q("sts-start").disabled = false;
    q("sts-overlay").style.display = "grid";
    q("sts-overlay").textContent = "전신이 보이도록 카메라를 배치한 뒤 시작하세요.";
    q("sts-status").textContent = "";
    els.canvas.style.display = "none";
    els.video.style.display = "none";
    const ctx = q("sts-wave").getContext("2d");
    ctx.clearRect(0, 0, q("sts-wave").width, q("sts-wave").height);
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (!q("sts-start")) return;
    els.video = q("sts-video");
    els.canvas = q("sts-canvas");
    q("sts-timer").textContent = formatTime(DURATION_S);
    if (!secureContextOk()) document.querySelectorAll('.mode-switch[data-widget="sts"] button[data-mode="camera"]').forEach((b) => (b.disabled = true));
    switchMode(secureContextOk() ? "camera" : "sim");
    document.querySelectorAll('.mode-switch[data-widget="sts"] button').forEach((b) => {
      b.addEventListener("click", () => { if (!b.disabled && !running) switchMode(b.dataset.mode); });
    });
    q("sts-start").addEventListener("click", start);
    q("sts-reset").addEventListener("click", reset);
    window.addEventListener("pagehide", () => { if (running) reset(); });
  });
})();
