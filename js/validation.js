// VitalLens validation page: (A) simulation cross-validation report, (C) paired measurement tool,
// (D) agreement analysis. All data stays in this browser (localStorage); export CSV to keep it.
(function () {
  const core = window.VLRppgCore;
  const S = window.VLStats;
  const STORE_KEY = "vitallens-validation-v1";
  const q = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const f = (v, d = 1) => (v == null || Number.isNaN(v) ? "–" : Number(v).toFixed(d));
  const pct = (v, d = 1) => (v == null || Number.isNaN(v) ? "–" : (v * 100).toFixed(d) + "%");
  const V = "v" + core.VERSION;

  // ---------------- A. simulation report ----------------
  function renderSim() {
    const R = window.SIM_RESULTS;
    if (!R || !q("sim-headline")) return;
    const methods = [
      { key: "v1", label: "v1 · 피크 계수 (초기 데모)", s: R.v1Held },
      { key: "green", label: `${V} · 녹색 스펙트럼 + 품질 기준 (기본값)`, s: R.cv.green.summary },
      { key: "pos", label: "POS · RGB + 품질 기준 (실측 비교용)", s: R.cv.pos.summary },
    ];
    const ms = (s, k, scale = 100, d = 1) => `${(s[k].mean * scale).toFixed(d)} ± ${(s[k].sd * scale).toFixed(d)}`;
    const rows = methods.map((m) => `<tr${m.key === "green" ? ' class="hl"' : ""}><th scope="row">${m.label}</th>
      <td>${ms(m.s, "correctRate")}%</td><td>${ms(m.s, "wrongRate")}%</td>
      <td>${(100 - m.s.outputRate.mean * 100).toFixed(1)}%</td><td>${((1 - m.s.within5OfOutput.mean) * 100).toFixed(1)}%</td><td>${ms(m.s, "mae", 1, 2)}</td></tr>`).join("");
    const gates = R.cv.green.folds.map((fo) => fo.params.snrRejectDb + " dB").join(" · ");
    const gatesPos = R.cv.pos.folds.map((fo) => fo.params.snrRejectDb + " dB").join(" · ");
    const n = R.trialsPerCell * R.hrs.length * R.snrsDb.length * R.scenarios.length;
    q("sim-headline").innerHTML = `
      <div class="table-scroll"><table class="data-table">
        <caption>5겹 교차검증 — 튜닝에 쓰지 않은 폴드에서 잰 성능 (평균 ± 표준편차, 전체 ${n.toLocaleString()}개 신호). 앞의 세 열은 <strong>전체 신호</strong> 대비 비율이고, "표시된 값 중 오답"은 숫자를 낸 경우만 분모로 합니다.</caption>
        <thead><tr><th scope="col">추정기</th><th scope="col">정답 출력<br><span class="small">±${R.tolBpm} bpm 이내</span></th><th scope="col">오답 출력<br><span class="small">±${R.tolBpm} bpm 초과</span></th><th scope="col">측정 보류</th><th scope="col">표시된 값 중 오답</th><th scope="col">MAE (bpm)<br><span class="small">출력된 값 기준</span></th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <p class="small">폴드별로 고른 품질 기준 — 녹색: ${gates} / POS: ${gatesPos}. 다섯 폴드가 같은 값을 골라 선택이 표본 변동에는 안정적입니다. 다만 학습·검증 데이터가 모두 같은 시뮬레이터에서 나왔으므로, 신호 모델에 과적합되지 않았는지는 실측 검증으로만 판정할 수 있습니다.</p>`;

    // scenario x input-SNR tables
    let html = "";
    R.scenarios.forEach((sc) => {
      html += `<div class="table-scroll"><table class="data-table compact"><caption>${esc(sc.label)}</caption>
        <thead><tr><th scope="col">입력 SNR</th><th scope="col">v1 오답</th><th scope="col">${V} 정답</th><th scope="col">${V} 오답</th><th scope="col">POS 정답</th><th scope="col">POS 오답</th></tr></thead><tbody>`;
      R.snrsDb.forEach((snr) => {
        const c = R.byScenarioSnr[sc.key + "|" + snr];
        html += `<tr><th scope="row">${snr} dB</th><td>${pct(c.v1.wrongRate, 0)}</td><td>${pct(c.green.correctRate, 0)}</td><td class="${c.green.wrongRate > 0.05 ? "bad" : ""}">${pct(c.green.wrongRate, 0)}</td><td>${pct(c.pos.correctRate, 0)}</td><td class="${c.pos.wrongRate > 0.05 ? "bad" : ""}">${pct(c.pos.wrongRate, 0)}</td></tr>`;
      });
      html += "</tbody></table></div>";
    });
    q("sim-scenarios").innerHTML = html;

    q("sim-hr").innerHTML = `<div class="table-scroll"><table class="data-table compact"><caption>안정 조건에서 실제 심박별 — 숫자를 낸 비율 / 정답 비율 (심박에 따라 측정 가능성이 달라짐)</caption>
      <thead><tr><th scope="col">실제 심박</th>${R.hrs.map((h) => `<th scope="col">${h}</th>`).join("")}</tr></thead><tbody>
      <tr><th scope="row">${V} 출력</th>${R.hrs.map((h) => `<td>${pct(R.byHrRest[h].green.outputRate, 0)}</td>`).join("")}</tr>
      <tr><th scope="row">${V} 정답</th>${R.hrs.map((h) => `<td>${pct(R.byHrRest[h].green.correctRate, 0)}</td>`).join("")}</tr>
      <tr><th scope="row">POS 출력</th>${R.hrs.map((h) => `<td>${pct(R.byHrRest[h].pos.outputRate, 0)}</td>`).join("")}</tr>
      </tbody></table></div>`;

    q("sim-replication").innerHTML = `<div class="table-scroll"><table class="data-table compact"><caption>독립 시드 재현 — 최종 파라미터로 새 데이터셋 채점 (정답 / 오답, 전체 신호 대비)</caption>
      <thead><tr><th scope="col">시드</th><th scope="col">v1</th><th scope="col">${V} 녹색</th><th scope="col">POS</th><th scope="col">${V} 움직임 오답</th></tr></thead><tbody>` +
      R.replications.map((r) => `<tr><th scope="row">${r.seed}</th><td>${pct(r.v1.all.correctRate)} / ${pct(r.v1.all.wrongRate)}</td><td>${pct(r.green.all.correctRate)} / ${pct(r.green.all.wrongRate)}</td><td>${pct(r.pos.all.correctRate)} / ${pct(r.pos.all.wrongRate)}</td><td>${pct(r.green.motion.wrongRate)}</td></tr>`).join("") +
      "</tbody></table></div>";

    const sen = R.sensitivity && R.sensitivity.byScenario.motion, base = R.byScenario.motion;
    const dia = R.diastolicSensitivity;
    q("sim-sensitivity").innerHTML = (sen ? `<strong>색 방향 잡음.</strong> 움직임 잡음 중 POS가 지울 수 없는 색 방향 성분을 ${Math.round(R.chromaMain * 100)}% → ${Math.round(R.sensitivity.chroma * 100)}%로 늘리면, 움직임 조건의 오답 출력은 녹색 ${pct(base.green.wrongRate)} → ${pct(sen.green.wrongRate)}, POS ${pct(base.pos.wrongRate)} → ${pct(sen.pos.wrongRate)}로 바뀝니다. POS의 이점은 잡음 모델에 크게 의존하므로 두 방식의 우열은 실측으로 판정합니다. ` : "") +
      (dia ? `<strong>이완기 봉우리.</strong> 맥파의 이완기 봉우리를 수축기의 ${Math.round(R.diaMain * 100)}% → ${Math.round(dia.dia * 100)}%로 줄여도(이완기 봉우리가 약한 맥파) 안정 조건 v1 오답은 ${pct(R.byScenario.rest.v1.wrongRate)} → ${pct(dia.byScenario.rest.v1.wrongRate)}, ${V} 오답은 ${pct(R.byScenario.rest.green.wrongRate)} → ${pct(dia.byScenario.rest.green.wrongRate)}입니다.` : "");

    renderRiskCoverage(R);
    const pen = R.penaltySensitivity;
    const edge = (x) => (x.onEdge ? " (탐색 범위 끝)" : "");
    q("sim-penalty").innerHTML = `<div class="table-scroll"><table class="data-table compact"><caption>교차검증은 "정답 비율 − k × 오답 비율"을 최대화하는 기준을 고릅니다. k=3이면 오답 1건의 손해가 보류 4건(정답을 놓친 1건 + 가중치 3)과 같습니다. (전체 데이터)</caption>
      <thead><tr><th scope="col">k (오답 1건 = 보류 k+1건)</th><th scope="col">${V} 기준</th><th scope="col">정답 / 오답 / 보류</th><th scope="col">POS 기준</th><th scope="col">정답 / 오답 / 보류</th></tr></thead><tbody>` +
      pen.green.map((g, i) => { const p = pen.pos[i]; return `<tr${g.penalty === R.wrongPenalty ? ' class="hl"' : ""}><th scope="row">k=${g.penalty} (보류 ${g.penalty + 1}건)${g.penalty === R.wrongPenalty ? " · 채택" : ""}</th><td>${g.gate} dB${edge(g)}</td><td>${pct(g.correctRate)} / ${pct(g.wrongRate)} / ${pct(1 - g.outputRate)}</td><td>${p.gate} dB${edge(p)}</td><td>${pct(p.correctRate)} / ${pct(p.wrongRate)} / ${pct(1 - p.outputRate)}</td></tr>`; }).join("") +
      "</tbody></table></div>";

    const rec = R.recovery;
    q("sim-recovery").innerHTML = `<div class="table-scroll"><table class="data-table compact"><caption>운동을 멈춘 뒤 심박이 떨어지는 동안 ${R.recoverySetup.delayS}초 뒤부터 12초 창으로 잰 값 — 멈춘 순간 심박 대비 편향 (bpm, ${V}, 입력 SNR ${R.recoverySetup.snrDb} dB)</caption>
      <thead><tr><th scope="col">멈춘 순간 심박</th>${R.recoverySetup.slopeBpmPerS.map((s) => `<th scope="col">초당 ${s} bpm 감소</th>`).join("")}</tr></thead><tbody>` +
      R.recoverySetup.hr0.map((h) => `<tr><th scope="row">${h}</th>${R.recoverySetup.slopeBpmPerS.map((s) => { const r = rec.find((x) => x.hr0 === h && x.slope === s); return `<td>${f(r.biasVsStop)}</td>`; }).join("")}</tr>`).join("") +
      "</tbody></table></div>";
  }

  // Risk–coverage chart: correct / wrong / output (%) across the gate grid, chosen gate marked.
  function renderRiskCoverage(R) {
    const box = q("sim-riskcov");
    if (!box) return;
    const data = R.riskCoverage.green;
    const series = [
      { key: "correctRate", label: "정답 출력", color: "var(--combined)", text: "var(--combined-text)" },
      { key: "wrongRate", label: "오답 출력", color: "var(--cardiac)", text: "var(--cardiac-text)" },
      { key: "outputRate", label: "숫자를 낸 비율", color: "var(--pulmonary)", text: "var(--pulmonary-text)", dash: "6 4" },
    ];
    const W = 640, H = 300, P = { l: 44, r: 108, t: 16, b: 42 };
    const gx = data.map((d) => d.gate), x0 = Math.min(...gx), x1 = Math.max(...gx);
    const sx = (v) => P.l + ((v - x0) / (x1 - x0)) * (W - P.l - P.r);
    const sy = (v) => P.t + (1 - v) * (H - P.t - P.b);
    let g = "";
    for (let v = 0; v <= 1.0001; v += 0.25) g += `<line x1="${P.l}" x2="${W - P.r}" y1="${sy(v)}" y2="${sy(v)}" stroke="var(--gridline)"/><text x="${P.l - 6}" y="${sy(v) + 4}" text-anchor="end" class="axis-label">${Math.round(v * 100)}%</text>`;
    gx.forEach((v) => { g += `<text x="${sx(v)}" y="${H - P.b + 16}" text-anchor="middle" class="axis-label">${v}</text>`; });
    const chosen = R.finalParams.green.snrRejectDb;
    g += `<line x1="${sx(chosen)}" x2="${sx(chosen)}" y1="${P.t}" y2="${H - P.b}" stroke="var(--text-secondary)" stroke-dasharray="3 3"/><text x="${sx(chosen) + 4}" y="${P.t + 10}" class="axis-label">채택 ${chosen} dB</text>`;
    series.forEach((s) => {
      const pts = data.map((d) => `${sx(d.gate).toFixed(1)},${sy(d[s.key]).toFixed(1)}`).join(" ");
      g += `<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="2" ${s.dash ? `stroke-dasharray="${s.dash}"` : ""} stroke-linejoin="round"/>`;
      const last = data[data.length - 1];
      g += `<text x="${W - P.r + 6}" y="${sy(last[s.key]) + 4}" class="axis-label" style="fill:${s.text}; font-weight:700;">${s.label}</text>`;
    });
    data.forEach((d, i) => { g += `<rect x="${sx(d.gate) - 12}" y="${P.t}" width="24" height="${H - P.t - P.b}" fill="transparent" data-i="${i}"/>`; });
    g += `<text x="${(P.l + W - P.r) / 2}" y="${H - 6}" text-anchor="middle" class="axis-label">품질 기준 (스펙트럼 SNR, dB) — 오른쪽으로 갈수록 엄격</text>`;
    box.innerHTML = `<div class="chart-legend" aria-hidden="true">${series.map((s) => `<span><i class="legend-line" style="background:${s.color}"></i>${s.label}</span>`).join("")}</div>
      <div style="position:relative;"><svg viewBox="0 0 ${W} ${H}" class="chart-svg" role="img" aria-label="품질 기준을 엄격하게 할수록 오답 출력과 정답 출력이 함께 줄어드는 위험-적용범위 곡선. 표로도 볼 수 있습니다.">${g}</svg><div class="chart-tip" id="rc-tip" hidden></div></div>
      <details style="margin-top:8px;"><summary class="small">표로 보기</summary><div class="table-scroll"><table class="data-table compact"><thead><tr><th scope="col">기준 (dB)</th><th scope="col">정답 출력</th><th scope="col">오답 출력</th><th scope="col">숫자를 낸 비율</th></tr></thead><tbody>${data.map((d) => `<tr${d.gate === chosen ? ' class="hl"' : ""}><th scope="row">${d.gate}</th><td>${pct(d.correctRate)}</td><td>${pct(d.wrongRate)}</td><td>${pct(d.outputRate)}</td></tr>`).join("")}</tbody></table></div></details>`;
    const svg = box.querySelector("svg"), tip = q("rc-tip");
    svg.querySelectorAll("rect[data-i]").forEach((r) => {
      const show = () => {
        const d = data[+r.dataset.i];
        tip.hidden = false;
        tip.innerHTML = `<strong>${d.gate} dB</strong><br>정답 ${pct(d.correctRate)} · 오답 ${pct(d.wrongRate)} · 출력 ${pct(d.outputRate)}`;
        const bb = svg.getBoundingClientRect(), scale = bb.width / W;
        tip.style.left = Math.min(bb.width - 170, Math.max(0, sx(d.gate) * scale - 80)) + "px";
        tip.style.top = "4px";
      };
      r.addEventListener("mouseenter", show);
      r.addEventListener("mouseleave", () => { tip.hidden = true; });
    });
  }

  // ---------------- C. measurement tool ----------------
  let stream = null, timer = null, tickTimer = null, gen = 0;
  const buffer = [];
  let latest = { green: null, pos: null }, snapshot = null;
  const secureOk = () => window.isSecureContext && navigator.mediaDevices && navigator.mediaDevices.getUserMedia;
  const posGate = () => (window.SIM_RESULTS ? window.SIM_RESULTS.finalParams.pos.snrRejectDb : core.DEFAULTS.snrRejectDb);

  async function startCamera() {
    if (stream || q("v-start").disabled) return;
    const video = q("v-video"), canvas = q("v-canvas");
    if (!secureOk()) { q("v-status").textContent = "카메라는 HTTPS 또는 localhost에서만 켤 수 있습니다."; return; }
    q("v-start").disabled = true;               // before awaiting, so a double click cannot open two streams
    const myGen = ++gen;
    let s;
    try { s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: 320, height: 240 }, audio: false }); }
    catch (e) { if (myGen === gen) { q("v-start").disabled = false; q("v-status").textContent = "카메라를 켤 수 없습니다: " + (e && e.name ? e.name : "알 수 없는 오류"); } return; }
    if (myGen !== gen) { s.getTracks().forEach((t) => t.stop()); return; }
    stream = s;
    video.srcObject = stream;
    q("v-stop").disabled = false;
    try { await video.play(); } catch (e) { stopCamera(); q("v-status").textContent = "카메라 영상을 재생하지 못했습니다."; return; }
    q("v-overlay").style.display = "none";
    buffer.length = 0;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    timer = setInterval(() => {
      if (!video.videoWidth) return;
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
      const c = core.roiRgbMean(ctx, canvas.width, canvas.height);
      core.pushSample(buffer, { t: performance.now() / 1000, r: c.r, g: c.g, b: c.b }, core.DEFAULTS.bufferSeconds);
    }, 1000 / core.DEFAULTS.sampleHz);
    tickTimer = setInterval(updateEstimates, 500);
  }

  function stopCamera() {
    gen++;
    clearInterval(timer); clearInterval(tickTimer);
    timer = tickTimer = null;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    q("v-video").srcObject = null;
    q("v-overlay").style.display = "grid";
    q("v-start").disabled = !secureOk(); q("v-stop").disabled = true;
    latest = { green: null, pos: null };
    renderLive();
  }

  function updateEstimates() {
    const now = performance.now() / 1000;
    const span = core.windowSpan(buffer);
    const g = core.processSignal(buffer, { method: "green" });
    const p = core.processSignal(buffer, { method: "pos", snrRejectDb: posGate() });
    latest = { green: g, pos: p, at: now, span, winStart: buffer.length ? buffer[0].t : null, winEnd: buffer.length ? buffer[buffer.length - 1].t : null };
    renderLive();
  }

  function renderLive() {
    const g = latest.green, p = latest.pos;
    const show = (r) => (!r ? "--" : r.bpm != null ? r.bpm.toFixed(1) : r.collecting ? "--" : "보류");
    q("v-green").textContent = show(g);
    q("v-pos").textContent = show(p);
    q("v-green-snr").textContent = g && g.snrDb != null ? `스펙트럼 SNR ${g.snrDb.toFixed(1)} dB` : "";
    q("v-pos-snr").textContent = p && p.snrDb != null ? `스펙트럼 SNR ${p.snrDb.toFixed(1)} dB` : "";
    if (!snapshot) q("v-status").textContent = !g ? (stream ? "신호 모으는 중…" : "대기 중") : g.quality || "";
    q("v-snap").disabled = !(g && !g.collecting);
    q("v-record").disabled = !snapshot;
  }

  // The estimate is frozen at the moment the reference value is READ, not when Record is clicked.
  function takeSnapshot() {
    const g = latest.green, p = latest.pos;
    if (!g || g.collecting) return false;
    const wall = Date.now(), perfNow = performance.now() / 1000;
    const toIso = (t) => (t == null ? null : new Date(wall - (perfNow - t) * 1000).toISOString());
    snapshot = { green: g, pos: p, snapTime: new Date(wall).toISOString(), winStart: toIso(latest.winStart), winEnd: toIso(latest.winEnd), windowS: +latest.span.toFixed(2) };
    q("v-snapinfo").textContent = `스냅샷 ${snapshot.snapTime.slice(11, 19)} — 직전 ${snapshot.windowS}초 창: 녹색 ${g.bpm != null ? g.bpm.toFixed(1) : "보류"} · POS ${p.bpm != null ? p.bpm.toFixed(1) : "보류"}. 기준기기 값을 입력하고 기록하세요.`;
    q("v-record").disabled = false;
    return true;
  }

  function loadRecords() {
    let rs = [];
    try { rs = JSON.parse(localStorage.getItem(STORE_KEY) || "[]"); } catch (e) { return []; }
    return Array.isArray(rs) ? rs.filter(validRecord) : [];
  }
  function saveRecords(rs) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(rs)); } catch (e) { alert("브라우저 저장소에 저장하지 못했습니다. CSV로 내보내 보관하세요."); }
  }

  const PID_RE = /^[A-Za-z0-9_-]{1,12}$/;
  const hrOk = (v) => v == null || (typeof v === "number" && Number.isFinite(v) && v >= 30 && v <= 220);
  const numOk = (v) => v == null || (typeof v === "number" && Number.isFinite(v));
  function validRecord(r) {
    return !!r && typeof r.ref === "number" && r.ref >= 30 && r.ref <= 220 && PID_RE.test(r.pid || "") &&
      ["green", "greenRaw", "pos", "posRaw"].every((k) => hrOk(r[k])) && ["greenSnr", "posSnr", "windowS"].every((k) => numOk(r[k])) &&
      Object.keys(ALLOWED).every((k) => ALLOWED[k].includes(r[k]));
  }
  function recordPair() {
    if (!snapshot) { q("v-status").textContent = "기준기기 값을 읽는 순간 ‘스냅샷’을 먼저 누르세요."; return; }
    const ref = parseFloat(q("v-ref").value);
    if (!(ref >= 30 && ref <= 220)) { q("v-ref").focus(); q("v-status").textContent = "기준기기 심박수(30–220)를 입력하세요."; return; }
    const pid = q("v-pid").value.trim();
    if (!PID_RE.test(pid)) { q("v-pid").focus(); q("v-status").textContent = "참여자 ID는 영문·숫자·-·_ 12자 이내 가명으로 쓰세요(예: P01)."; return; }
    const g = snapshot.green || {}, p = snapshot.pos || {};
    const rec = {
      time: snapshot.snapTime, winStart: snapshot.winStart, winEnd: snapshot.winEnd, windowS: snapshot.windowS,
      pid, condition: q("v-cond").value, lighting: q("v-light").value, skin: q("v-skin").value, device: q("v-device").value,
      ref,
      green: g.bpm != null ? +g.bpm.toFixed(2) : null,
      greenRaw: g.bpm != null ? +g.bpm.toFixed(2) : g.rawBpm != null ? +g.rawBpm.toFixed(2) : null,
      greenSnr: g.snrDb != null ? +g.snrDb.toFixed(2) : null,
      pos: p.bpm != null ? +p.bpm.toFixed(2) : null,
      posRaw: p.bpm != null ? +p.bpm.toFixed(2) : p.rawBpm != null ? +p.rawBpm.toFixed(2) : null,
      posSnr: p.snrDb != null ? +p.snrDb.toFixed(2) : null,
      version: core.VERSION,
    };
    const rs = loadRecords(); rs.push(rec); saveRecords(rs);
    q("v-ref").value = "";
    snapshot = null; q("v-snapinfo").textContent = "";
    q("v-status").textContent = `기록됨 (#${rs.length}) — 기준 ${ref} / 녹색 ${rec.green ?? "보류"} / POS ${rec.pos ?? "보류"}`;
    renderRecords();
  }

  const CSV_COLS = ["time", "winStart", "winEnd", "windowS", "pid", "condition", "lighting", "skin", "device", "ref", "green", "greenRaw", "greenSnr", "pos", "posRaw", "posSnr", "version"];
  const NUM_COLS = new Set(["windowS", "ref", "green", "greenRaw", "greenSnr", "pos", "posRaw", "posSnr"]);
  function toCsv(rs) {
    const cell = (v, col) => {
      let s = v == null ? "" : String(v);
      if (!NUM_COLS.has(col) && /^[=+\-@\t\r]/.test(s)) s = "'" + s;   // spreadsheet formula injection
      return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return "﻿" + [CSV_COLS.join(",")].concat(rs.map((r) => CSV_COLS.map((c) => cell(r[c], c)).join(","))).join("\r\n");
  }
  const ALLOWED = {
    condition: ["앉은 안정", "STS 직후 회복", "기타"], lighting: ["자연광", "실내등", "혼합"],
    skin: ["I", "II", "III", "IV", "V", "VI", "미응답"], device: ["ECG 흉부 스트랩", "손가락 맥박산소측정기"],
  };
  function parseCsv(text) {
    const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
    if (!lines.length) return { rows: [], dropped: 0 };
    const split = (line) => { const out = []; let cur = "", inQ = false;
      for (let i = 0; i < line.length; i++) { const ch = line[i];
        if (inQ) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') inQ = false; else cur += ch; }
        else if (ch === '"') inQ = true; else if (ch === ",") { out.push(cur); cur = ""; } else cur += ch; }
      out.push(cur); return out; };
    const head = split(lines[0]);
    let dropped = 0;
    const rows = lines.slice(1).map((l) => { const v = split(l), r = {};
      head.forEach((h, i) => { if (!CSV_COLS.includes(h)) return; const raw = v[i] == null ? "" : v[i].replace(/^'(?=[=+\-@\t\r])/, ""); r[h] = NUM_COLS.has(h) ? (raw === "" ? null : parseFloat(raw)) : raw; });
      return r; })
      .filter((r) => {
        const ok = validRecord(r);
        if (!ok) dropped++;
        return ok;
      });
    return { rows, dropped };
  }

  function download(name, text, type) {
    const blob = new Blob([text], { type });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function renderRecords() {
    const rs = loadRecords();
    q("rec-count").textContent = rs.length;
    q("rec-body").innerHTML = rs.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.pid)}</td><td>${esc(r.condition)}</td><td>${esc(r.lighting)}</td><td>${esc(r.skin)}</td><td>${esc(r.device)}</td><td>${f(r.ref, 0)}</td>
      <td>${r.green != null ? f(r.green) : `<span class="small">보류 (${f(r.greenRaw)})</span>`}</td><td>${f(r.greenSnr)}</td>
      <td>${r.pos != null ? f(r.pos) : `<span class="small">보류 (${f(r.posRaw)})</span>`}</td><td>${f(r.posSnr)}</td>
      <td><button type="button" class="linkish" data-del="${i}" aria-label="${i + 1}번 기록 삭제">삭제</button></td></tr>`).join("") ||
      `<tr><td colspan="12" class="small center">아직 기록이 없습니다. 위 도구로 측정하거나 CSV를 불러오세요.</td></tr>`;
    q("rec-body").querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => {
      const all = loadRecords(); all.splice(+b.dataset.del, 1); saveRecords(all); renderRecords();
    }));
    renderAnalysis(rs);
  }

  // ---------------- D. analysis ----------------
  const recs = (rs, key) => rs.filter((r) => r[key] != null).map((r) => ({ pid: r.pid, ref: r.ref, est: r[key] }));
  function analyzeMethod(rs, key) {
    const pairs = recs(rs, key);
    const rep = pairs.length >= 2 ? S.agreementReport(pairs, { B: 1000 }) : S.agreement(pairs.map((r) => r.ref), pairs.map((r) => r.est));
    const withheld = rs.filter((r) => r[key] == null && r[key + "Raw"] != null);
    const withheldMae = withheld.length ? S.mean(withheld.map((r) => Math.abs(r[key + "Raw"] - r.ref))) : null;
    return { a: rep, pairs, total: rs.length, withheld: withheld.length, withheldMae };
  }
  const ciTxt = (c, d) => (c && Number.isFinite(c.low) ? ` <span class="small">[${f(c.low, d)}, ${f(c.high, d)}]</span>` : "");
  const MINP = S.MIN_PARTICIPANTS_FOR_CI;

  function baPlot(M, color) {
    const W = 520, H = 280, P = { l: 48, r: 16, t: 14, b: 40 };
    const paired = M.pairs, a = M.a;
    if (paired.length < 2) return `<p class="small">Bland–Altman 그림은 짝지은 측정이 2개 이상일 때 표시됩니다.</p>`;
    const lo = a.repeated ? a.repeated.loaLow : a.loaLow, hi = a.repeated ? a.repeated.loaHigh : a.loaHigh;
    const pts = paired.map((r) => ({ x: (r.ref + r.est) / 2, y: r.est - r.ref, r }));
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y).concat([lo, hi, 0]);
    const x0 = Math.floor(Math.min(...xs) / 10) * 10, x1 = Math.ceil(Math.max(...xs) / 10) * 10 || x0 + 10;
    const yMax = Math.max(5, Math.ceil(Math.max(...ys.filter(Number.isFinite).map(Math.abs)) / 5) * 5);
    const sx = (v) => P.l + ((v - x0) / (x1 - x0 || 1)) * (W - P.l - P.r);
    const sy = (v) => P.t + ((yMax - v) / (2 * yMax)) * (H - P.t - P.b);
    const hline = (v, dash, label) => `<line x1="${P.l}" x2="${W - P.r}" y1="${sy(v)}" y2="${sy(v)}" stroke="var(--text-secondary)" stroke-width="1.5" ${dash ? 'stroke-dasharray="5 4"' : ""}/><text x="${W - P.r - 4}" y="${sy(v) - 4}" text-anchor="end" class="axis-label">${label}</text>`;
    let ticks = "";
    for (let v = -yMax; v <= yMax; v += yMax / 2) ticks += `<text x="${P.l - 6}" y="${sy(v) + 4}" text-anchor="end" class="axis-label">${v}</text><line x1="${P.l}" x2="${W - P.r}" y1="${sy(v)}" y2="${sy(v)}" stroke="var(--gridline)" stroke-width="1"/>`;
    for (let v = x0; v <= x1; v += 10) ticks += `<text x="${sx(v)}" y="${H - P.b + 16}" text-anchor="middle" class="axis-label">${v}</text>`;
    const dots = pts.map((p) => `<circle cx="${sx(p.x)}" cy="${sy(p.y)}" r="4.5" fill="${color}" stroke="var(--surface-1)" stroke-width="2"><title>${esc(p.r.pid)} · 기준 ${f(p.r.ref, 0)} · 추정 ${f(p.r.est)} · 차이 ${f(p.y)} bpm</title></circle>`).join("");
    const lines = Number.isFinite(lo) ? hline(hi, true, "상한 " + f(hi, 1)) + hline(lo, true, "하한 " + f(lo, 1)) : "";
    return `<svg viewBox="0 0 ${W} ${H}" class="ba-plot" role="img" aria-label="Bland–Altman 그림: 평균 편향 ${f(a.bias, 2)} bpm, 반복측정 95% 일치한계 ${f(lo, 1)}에서 ${f(hi, 1)} bpm">
      ${ticks}${hline(a.bias, false, "편향 " + f(a.bias, 2))}${lines}${dots}
      <text x="${(P.l + W - P.r) / 2}" y="${H - 4}" text-anchor="middle" class="axis-label">(기준 + 추정) / 2  [bpm]</text>
      <text x="12" y="${(P.t + H - P.b) / 2}" text-anchor="middle" class="axis-label" transform="rotate(-90 12 ${(P.t + H - P.b) / 2})">추정 − 기준 [bpm]</text></svg>`;
  }

  function renderAnalysis(all) {
    const root = q("analysis");
    if (!root) return;
    const dev = q("an-device").value, cond = q("an-cond").value;
    const rs = all.filter((r) => (dev === "all" || r.device === dev) && (cond === "all" || r.condition === cond));
    if (!rs.length) { root.innerHTML = `<p class="small">${all.length ? "선택한 조건에 맞는 기록이 없습니다." : "기록이 쌓이면 여기에 일치도 분석이 자동으로 계산됩니다."}</p>`; q("paper-text").value = ""; return; }
    const mixed = new Set(rs.map((r) => r.device)).size > 1;
    const G = analyzeMethod(rs, "green"), P = analyzeMethod(rs, "pos");
    const row = (label, M) => { const a = M.a, R = a.repeated || {}, ci = a.ci || {};
      return `<tr><th scope="row">${label}</th><td>${a.participants || "–"} / ${a.n || 0} / ${M.total}</td><td>${f(a.bias, 2)}${ciTxt(ci.bias, 2)}</td>
        <td>${Number.isFinite(R.loaLow) ? f(R.loaLow, 1) + ciTxt(ci.loaLow, 1) + " ~ " + f(R.loaHigh, 1) + ciTxt(ci.loaHigh, 1) : "–"}</td>
        <td>${f(a.mae, 2)}${ciTxt(ci.mae, 2)}</td><td>${f(a.rmse, 2)}</td><td>${f(a.mape, 1)}</td><td>${pct(a.within5)}</td><td>${f(a.pearson, 3)}</td><td>${f(a.ccc, 3)}</td><td>${f(a.icc2_1, 3)}${ciTxt(ci.icc2_1, 3)}</td><td>${M.withheld ? M.withheld + "건, MAE " + f(M.withheldMae, 1) : "0"}</td></tr>`; };
    const both = rs.filter((r) => r.green != null && r.pos != null);
    const bothG = both.length ? S.mean(both.map((r) => Math.abs(r.green - r.ref))) : null, bothP = both.length ? S.mean(both.map((r) => Math.abs(r.pos - r.ref))) : null;
    const conds = [...new Set(rs.map((r) => r.condition))];
    const condRows = conds.map((c) => { const sub = rs.filter((r) => r.condition === c); const g = analyzeMethod(sub, "green"), p = analyzeMethod(sub, "pos");
      return `<tr><th scope="row">${esc(c)}</th><td>${sub.length}</td><td>${f(g.a.mae, 2)}</td><td>${f(g.a.bias, 2)}</td><td>${f(p.a.mae, 2)}</td><td>${f(p.a.bias, 2)}</td></tr>`; }).join("");
    const skins = [...new Set(rs.map((r) => r.skin))];
    const skinRows = skins.map((s) => { const sub = rs.filter((r) => r.skin === s); const g = analyzeMethod(sub, "green");
      return `<tr><th scope="row">${esc(s)}</th><td>${new Set(sub.map((r) => r.pid)).size}</td><td>${sub.length}</td><td>${g.a.n || 0}</td><td>${f(g.a.mae, 2)}</td><td>${f(g.a.bias, 2)}</td></tr>`; }).join("");
    root.innerHTML = `
      ${mixed ? `<div class="callout callout-warn" style="margin-bottom:12px;"><span class="ic" aria-hidden="true">⚠️</span><div>서로 다른 기준기기의 기록이 섞여 있습니다. 논문의 1차 분석은 기준기기 하나로 제한하세요(위 ‘기준기기’ 선택).</div></div>` : ""}
      <div class="table-scroll"><table class="data-table"><caption>일치도 요약 — 기준기기 대비 (차이 = 추정 − 기준). 일치한계는 참여자당 반복 측정을 반영한 Bland &amp; Altman(2007) 방법. [대괄호]는 95% 신뢰구간으로, 참여자 ${MINP}명 이상일 때만 표시합니다: 일치한계는 참여자 수 기준 t 근사식(반복측정에서 보수적), 편향·MAE·ICC는 참여자 단위 부트스트랩(1,000회 — 소표본에서는 실제보다 좁을 수 있음).</caption>
        <thead><tr><th scope="col">추정기</th><th scope="col">참여자 / 출력 / 전체</th><th scope="col">편향</th><th scope="col">95% 일치한계</th><th scope="col">MAE</th><th scope="col">RMSE</th><th scope="col">MAPE %</th><th scope="col">±5 bpm</th><th scope="col">Pearson r</th><th scope="col">Lin CCC</th><th scope="col">ICC(2,1)</th><th scope="col">보류된 측정<br><span class="small">(보류 전 추정치 오차)</span></th></tr></thead>
        <tbody>${row(`${V} 녹색`, G)}${row("POS", P)}</tbody></table></div>
      <p class="small">두 방식이 모두 숫자를 낸 ${both.length}건에서 비교: 녹색 MAE ${f(bothG, 2)} · POS MAE ${f(bothP, 2)} bpm (각 방식의 출력 비율 녹색 ${pct(G.a.n / rs.length)} · POS ${pct(P.a.n / rs.length)}). 각자 고른 기록끼리 비교하면 더 많이 보류한 쪽이 유리해 보이므로 이 비교를 1차로 씁니다.</p>
      <div class="grid grid-2" style="margin-top:18px;">
        <figure class="card" style="margin:0;"><figcaption class="kicker">Bland–Altman · ${V} 녹색</figcaption>${baPlot(G, "var(--cardiac)")}</figure>
        <figure class="card" style="margin:0;"><figcaption class="kicker">Bland–Altman · POS</figcaption>${baPlot(P, "var(--combined)")}</figure>
      </div>
      <div class="grid grid-2" style="margin-top:18px;">
        <div class="table-scroll"><table class="data-table compact"><caption>측정 조건별 MAE / 편향 (bpm)</caption><thead><tr><th scope="col">조건</th><th scope="col">기록</th><th scope="col">녹색 MAE</th><th scope="col">녹색 편향</th><th scope="col">POS MAE</th><th scope="col">POS 편향</th></tr></thead><tbody>${condRows}</tbody></table></div>
        <div class="table-scroll"><table class="data-table compact"><caption>피부톤(Fitzpatrick)별 — 형평성 점검</caption><thead><tr><th scope="col">유형</th><th scope="col">참여자</th><th scope="col">기록</th><th scope="col">출력</th><th scope="col">녹색 MAE</th><th scope="col">녹색 편향</th></tr></thead><tbody>${skinRows}</tbody></table></div>
      </div>`;
    const a = G.a, R = a.repeated || {}, ci = a.ci || {};
    const devices = [...new Set(rs.map((r) => r.device))].join(", ");
    const c2 = (c, d) => (c && Number.isFinite(c.low) ? `(95% CI ${f(c.low, d)}~${f(c.high, d)})` : "");
    const allP = new Set(rs.map((r) => r.pid)).size, noValid = allP - (a.participants || 0);
    const loaCiTxt = ci.loaLow && Number.isFinite(ci.loaLow.low) ? `(하한의 95% CI ${f(ci.loaLow.low, 1)}~${f(ci.loaLow.high, 1)}, 상한의 95% CI ${f(ci.loaHigh.low, 1)}~${f(ci.loaHigh.high, 1)})` : "";
    q("paper-text").value = a.n >= 2 && a.participants >= 2
      ? `참여자 ${allP}명에게서 ${G.total}건을 측정했다(${cond === "all" ? conds.join("·") : cond}). 품질 기준을 통과한 측정은 ${a.participants}명의 ${a.n}건(${(a.n / G.total * 100).toFixed(1)}%)이었다${noValid ? `(${noValid}명은 통과한 측정이 한 건도 없었음)` : ""}. 제안한 카메라 기반 심박 추정치(${V})는 기준기기(${devices}) 대비 평균 편향 ${f(a.bias, 2)} bpm ${c2(ci.bias, 2)}, 참여자당 반복 측정을 반영한 Bland–Altman(2007) 95% 일치한계 ${f(R.loaLow, 1)}~${f(R.loaHigh, 1)} bpm${loaCiTxt}, 평균절대오차 ${f(a.mae, 2)} bpm ${c2(ci.mae, 2)}, ICC(2,1) ${f(a.icc2_1, 3)} ${c2(ci.icc2_1, 3)}을 보였다. ${a.ciAvailable ? "일치한계의 신뢰구간은 참여자 수를 표본 크기로 한 근사식으로, 나머지는 참여자 단위 부트스트랩으로 구했다." : `참여자가 ${MINP}명 미만이어서 신뢰구간은 제시하지 않았다.`} 품질 기준에 의해 보류된 ${G.withheld}건은 보류 전 추정치의 평균절대오차가 ${f(G.withheldMae, 1)} bpm이었다. 두 방식이 모두 값을 낸 ${both.length}건에서 평균절대오차는 녹색 ${f(bothG, 2)} bpm, POS ${f(bothP, 2)} bpm이었다.${mixed ? " (주의: 기준기기가 섞여 있음 — 기준기기별로 나눠 보고할 것)" : ""}`
      : "품질 기준을 통과한 측정이 참여자 2명 이상에게서 쌓이면 결과 문장 초안이 만들어집니다.";
  }

  document.addEventListener("DOMContentLoaded", () => {
    renderSim();
    if (!q("v-start")) return;
    if (!secureOk()) { q("v-start").disabled = true; q("v-status").textContent = "카메라는 HTTPS 또는 localhost에서만 켤 수 있습니다. (기록 불러오기·분석은 사용 가능)"; }
    q("v-start").addEventListener("click", startCamera);
    q("v-stop").addEventListener("click", stopCamera);
    q("v-snap").addEventListener("click", () => { if (!takeSnapshot()) q("v-status").textContent = "12초 창이 찰 때까지 기다리세요."; else q("v-ref").focus(); });
    q("v-ref").addEventListener("input", () => { if (!snapshot) takeSnapshot(); });
    q("v-record").addEventListener("click", recordPair);
    q("v-ref").addEventListener("keydown", (e) => { if (e.key === "Enter" && !q("v-record").disabled) recordPair(); });
    q("rec-export").addEventListener("click", () => download(`vitallens_validation_${new Date().toISOString().slice(0, 10)}.csv`, toCsv(loadRecords()), "text/csv;charset=utf-8"));
    q("rec-import-btn").addEventListener("click", () => q("rec-import").click());
    q("rec-import").addEventListener("change", (e) => {
      const file = e.target.files[0]; if (!file) return;
      file.text().then((t) => {
        const { rows, dropped } = parseCsv(t);
        if (!rows.length) { alert(`불러올 수 있는 행이 없습니다${dropped ? ` (형식이 맞지 않는 ${dropped}행 제외)` : ""}. 이 페이지에서 내보낸 CSV인지 확인하세요.`); return; }
        if (confirm(`${rows.length}건을 불러옵니다${dropped ? ` (형식이 맞지 않는 ${dropped}행은 제외)` : ""}. 기존 ${loadRecords().length}건 뒤에 추가할까요?`)) { saveRecords(loadRecords().concat(rows)); renderRecords(); }
      });
      e.target.value = "";
    });
    q("rec-clear").addEventListener("click", () => { const n = loadRecords().length; if (n && confirm(`기록 ${n}건을 모두 지웁니다. 먼저 CSV로 내보냈는지 확인하세요. 계속할까요?`)) { saveRecords([]); renderRecords(); } });
    ["an-device", "an-cond"].forEach((id) => q(id).addEventListener("change", () => renderAnalysis(loadRecords())));
    q("paper-copy").addEventListener("click", () => { const t = q("paper-text"); t.select(); if (navigator.clipboard) navigator.clipboard.writeText(t.value).catch(() => {}); });
    window.addEventListener("pagehide", () => { if (stream) stopCamera(); });
    renderRecords();
  });
})();
