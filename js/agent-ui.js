// VitalLens AI coach page: wires the harness (agent-core.js) to either the rule-based planner
// (not AI) or a Claude planner (bring-your-own-key, called from this browser with the official
// SDK, bundled same-origin in js/vendor — no third-party CDN at runtime).
(function () {
  const A = window.VLAgent;
  const core = window.VLRppgCore;
  const SDK_URL = new URL("js/vendor/anthropic-sdk-0.128.0.mjs", document.baseURI).href;
  const q = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  let harness = null, running = false, plannerKind = "rules", realMode = false, hiddenNotes = 0;
  let apiKey = null;   // memory only — never written to storage
  let pending = null;  // the open modal dialog, so Stop can close it
  const secure = () => window.isSecureContext && navigator.mediaDevices && navigator.mediaDevices.getUserMedia;

  const TOOL_KO = Object.fromEntries(A.TOOLS.map((t) => [t.name, t.title]));
  const ACTOR_KO = { "rule-planner": "규칙 플래너", claude: "Claude", harness: "하네스", kernel: "커널", tool: "도구", user: "사용자", patient: "환자", planner: "플래너", llm: "LLM" };
  const TYPE_KO = { proposal: "제안", result: "결과", veto: "거부", stop: "중지", note: "메모", model_text: "모델 메모", model_response: "모델 응답" };
  const STATE_KO = { ready: "정상 종료", stopped: "안전 중단", ineligible: "원격 세션 부적격" };
  // One verbal descriptor for a band (the anchor at its centre), e.g. 12–14 → "약간 힘듦".
  const rpeText = (lo, hi) => `자각인지도 ${lo}–${hi} (${A.RPE_ANCHORS[Math.round((lo + hi) / 2)] || ""})`;
  // Exactly what the Claude planner receives about the patient (tool results), shown for consent.
  const CLAUDE_DATA = ["나이", "안정시 심박", "운동부하검사 최대심박과 그 검사를 현재 약물 상태에서 했는지", "베타차단제 복용 여부", "COPD 여부", "위험군", "의료진 감독 여부",
    "세션 전 안전 확인 결과(오늘의 증상, 휴대전화·공간·119 확인, 안정 시 SpO₂)", "체크인마다 심박·RPE·호흡곤란·SpO₂·증상", "30초 앉았다일어서기 횟수", "운동 단계를 일찍 끝냈는지"];
  const PID_RE = /^[A-Za-z0-9_-]{1,12}$/;

  // ---------------------------------------------------------------- timeline
  function addCard(kind, html, tag) {
    const el = document.createElement(tag || "div");
    el.className = "tl-card tl-" + kind;
    el.innerHTML = html;
    q("timeline").appendChild(el);
    el.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    return el;
  }
  const announce = (text) => { q("kernel-sr").textContent = text; };

  function onEvent(ev) {
    if (ev.type === "veto") {
      const c = ev.clampTo;
      addCard("veto", `<div class="tl-head"><span class="badge badge-veto">⛔ 커널 거부</span> ${esc(TOOL_KO[ev.tool] || ev.tool)}</div><p>${esc(ev.reason)}</p>${c ? `<p class="small">허용 한계: 심박 상한 ${esc(c.target_hr_high)} bpm · RPE 상한 ${esc(c.target_rpe_high)} · 이번 단계 최대 ${esc(c.minutes_max)}분</p>` : ""}`);
    } else if (ev.type === "kernel") {
      announce(`커널 판정: ${A.ACTION_KO[ev.action] || "부적격"} — ${ev.reasons.join(", ")}`);
      if (ev.source === "user_stop") { addCard("veto", `<div class="tl-head">🛑 중지</div><p>${esc(ev.reasons.join(" "))}</p><p class="tl-instr">${esc(A.STOP_SCRIPT)}</p>`); stopAlert(ev.reasons.join(" ")); }
    } else if (ev.type === "result") {
      const r = ev.result || {}, i = ev.input || {};
      switch (ev.tool) {
        case "get_patient_profile": {
          const e = r.eligibility;
          addCard(e.allow ? "info" : "veto", `<div class="tl-head">위험군: ${esc(A.RISK_KO[r.profile.risk] || "입력 없음")} (의료진 입력)${r.profile.supervised ? " · 화상 감독" : ""}</div><p>${e.allow ? "원격 세션 적격" : esc(e.reason)}</p>`);
          break;
        }
        case "compute_target_zone": {
          const z = r.zone;
          addCard("info", `<div class="tl-head">목표 구간 (커널 승인)</div><p>${esc(rpeText(z.rpeLow, z.rpeHigh))} · 심박 ${z.hrLow}–${z.hrHigh} bpm${z.rpePrimary ? "(참고)" : ""}${z.dyspneaTargetApplies ? ` · 호흡곤란 ${z.dyspneaLow}–${z.dyspneaHigh}/10` : ""}</p><p class="small">${esc(z.note)}</p>`);
          break;
        }
        case "pre_session_safety_check":
          addCard(r.passed ? "info" : "veto", `<div class="tl-head"><span class="badge ${r.passed ? "badge-ok" : "badge-veto"}">${r.passed ? "✅" : "⛔"} 세션 전 안전 확인</span></div>${r.passed ? "<p>오늘 세션을 진행할 수 있습니다.</p>" : `<p>${esc(harness.kernel.state.stopReason)}</p>`}${r.notes && r.notes.length ? `<p class="small">${esc(r.notes.join(" · "))}</p>` : ""}`);
          break;
        case "say_to_patient":
          addCard("coach", plannerKind === "claude"
            ? `<div class="tl-head">🤖 AI 코치 <span class="small">(커널 검사 통과 · 조언이며 의료적 판단이 아닙니다)</span></div><p class="tl-instr">${esc(i.message)}</p>`
            : `<div class="tl-head">📋 안내 <span class="small">(규칙 기반 문장)</span></div><p class="tl-instr">${esc(i.message)}</p>`);
          break;
        case "set_exercise_phase": {
          const early = ({ done: " · 환자가 일찍 끝냄", symptom: " · 환자가 증상 보고", stop: " · 환자가 그만하기", aborted: " · 중지됨" }[r.early] || "") + (r.actualMinutes != null ? ` · 실제 ${r.actualMinutes}분${r.demoSpeed ? ` (시연 ${r.demoSpeed}배속)` : ""}` : "");
          addCard("phase", `<div class="tl-head"><span class="badge badge-ok">✅ 허용</span> ${esc(A.PHASE_KO[i.phase] || i.phase)} ${esc(i.minutes)}분${esc(early)}</div><p class="tl-instr">${esc(i.instruction)}</p><p class="small">${esc(rpeText(i.target_rpe_low, i.target_rpe_high))} · 심박 ${esc(i.target_hr_low)}–${esc(i.target_hr_high)} bpm</p>`);
          break;
        }
        case "still_check_in": {
          const o = r.observation || {}, k = r.kernel || {};
          const sym = (o.symptoms || []).map((s) => A.SYMPTOM_LABELS[s] || s).join(", ");
          const badge = { stop: ["veto", "🛑"], reduce: ["warn", "⚠️"], hold: ["warn", "⏸"], continue: ["ok", "✅"] }[k.action] || ["ok", ""];
          const hr = o.hr != null ? `${Math.round(o.hr)} bpm${o.hrSource === "manual" ? " (직접 입력)" : ""}` : o.hrWithheld ? "측정 보류" : "미측정";
          addCard("check", `<div class="tl-head"><span class="badge badge-${badge[0]}">${badge[1]} 커널 판정: ${esc(A.ACTION_KO[k.action])}</span> 정지 체크인 · ${esc(i.reason)}</div>
            <p>심박 ${esc(hr)} · RPE ${esc(o.rpe ?? "–")} · 호흡곤란 ${esc(o.dyspnea ?? "–")}/10${o.spo2 != null ? " · SpO₂ " + esc(o.spo2) + "%" : ""}${sym ? " · 증상: " + esc(sym) : ""}</p>
            ${k.reasons && k.reasons.length ? `<p class="small">${esc(k.reasons.join(" / "))}</p>` : ""}`);
          if (k.action === "stop") { addCard("veto", `<div class="tl-head">🛑 운동을 멈추세요 (고정 안내문)</div><p class="tl-instr">${esc(A.STOP_SCRIPT)}</p>`); stopAlert(k.reasons.join(" / ")); }
          break;
        }
        case "run_sts_test": {
          const how = { stop: "환자가 그만하기", symptom: "환자가 증상 보고", skip: "건너뜀" }[r.early];
          addCard("phase", `<div class="tl-head"><span class="badge ${how ? "badge-warn" : "badge-ok"}">${how ? "⏹" : "✅"}</span> 30초 앉았다일어서기${how ? " · " + esc(how) : ""}</div><p>${esc(r.count ?? "–")}회 <span class="small">(${r.source === "virtual-patient" ? "가상 환자" : "환자가 센 횟수"})</span></p>`);
          break;
        }
        case "end_session":
          addCard("end", `<div class="tl-head">세션 종료 · ${esc(STATE_KO[r.safetyState] || r.safetyState)}</div><p>${esc(i.summary)}</p>${r.stopReason ? `<p class="small">${esc(r.stopReason)}</p>` : ""}`);
          break;
      }
    }
    renderAudit();
  }
  // Model text outside tools: shown to the operator in virtual-patient runs; in a real-user run it goes
  // to the audit log only, because this page is the patient's screen.
  function modelNote(text) {
    if (!text || !text.trim()) return;
    if (realMode) { hiddenNotes++; q("run-status").dataset.notes = hiddenNotes; return; }
    addCard("model", `<summary>🧠 모델 메모 — 가상 환자 실행에서만 표시 (감사 기록에 저장)</summary><p>${esc(text)}</p>`, "details");
  }

  // A stop must reach the patient: an alert dialog with the fixed script, announced and focused.
  function stopAlert(reason) {
    announce(`운동을 멈추세요. ${A.STOP_SCRIPT}`);
    if (!realMode) return;
    const dlg = q("stop-dialog");
    q("stop-reason").textContent = reason || "";
    q("stop-text").textContent = A.STOP_SCRIPT;
    if (!dlg.open) { try { dlg.showModal(); } catch (e) { dlg.setAttribute("open", ""); } }
    q("stop-text").focus();
  }

  // ---------------------------------------------------------------- dialogs
  // Every dialog resolves exactly once. Escape, the Android back gesture, a "세션 중단" button or
  // the page's Stop button all resolve it with a conservative value, so a session can never hang.
  // Each run gets a token: a 'close' event queued by the PREVIOUS run on the same <dialog> element
  // (close events are dispatched asynchronously) is ignored instead of cancelling the new run.
  // pending.abort() is used by the operator's Stop and resolves with spec.abortValue, which the
  // harness does not record as a patient report.
  function runDialog(dlg, spec) {
    return new Promise((resolve) => {
      const run = {};
      dlg._vlRun = run;
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        dlg.removeEventListener("close", onClose);
        try { if (spec.cleanup) spec.cleanup(); } catch (e) { /* ignore */ }
        if (dlg._vlRun === run) dlg._vlRun = null;
        if (dlg.open) dlg.close();
        if (pending && pending.dlg === dlg) pending = null;
        resolve(value);
      };
      const onClose = () => { if (dlg._vlRun === run && !dlg.open) finish(spec.cancelValue()); };
      dlg.addEventListener("close", onClose);
      pending = { dlg, abort: () => finish(spec.abortValue ? spec.abortValue() : spec.cancelValue()) };
      spec.init(finish);
      dlg.showModal();
      const h = dlg.querySelector("h2");
      if (h) { h.setAttribute("tabindex", "-1"); h.focus(); }
    });
  }

  function buildScale(containerId, name, anchors, lo, hi) {
    const box = q(containerId);
    box.innerHTML = "";
    for (let v = lo; v <= hi; v++) {
      const id = `${name}-${v}`;
      const label = document.createElement("label");
      label.setAttribute("for", id);
      label.innerHTML = `<input type="radio" name="${name}" id="${id}" value="${v}"><span class="n">${v}</span><span>${esc(anchors[v] || "")}</span>`;
      box.appendChild(label);
    }
  }
  const radioVal = (name) => { const r = document.querySelector(`input[name="${name}"]:checked`); return r ? +r.value : null; };

  function openSafetyCheck(input, ctx) {
    const dlg = q("safety-dialog");
    return runDialog(dlg, {
      cancelValue: () => ({ declined: true }),
      abortValue: () => ({ declined: true }),
      init(done) {
        dlg.querySelectorAll("input[type=checkbox]").forEach((c) => (c.checked = false));
        q("sc-spo2").value = "";
        q("sc-spo2-label").textContent = ctx.profile.copd ? "안정 시 SpO₂ (맥박산소측정기, COPD 필수)" : "안정 시 SpO₂ (측정기가 있으면)";
        q("sc-error").textContent = "";
        q("sc-ok").onclick = () => {
          const spo2 = q("sc-spo2").value === "" ? null : Number(q("sc-spo2").value);
          if (spo2 != null && !(spo2 >= 0 && spo2 <= 100)) { q("sc-error").textContent = "SpO₂는 0–100 사이 숫자여야 합니다."; return; }
          done({
            newChestPain: q("sc-chest").checked, unusualDyspnea: q("sc-dysp").checked, feelsUnwell: q("sc-unwell").checked,
            medsTaken: q("sc-meds").checked, phoneReachable: q("sc-phone").checked, personAvailable: q("sc-person").checked,
            safeSpace: q("sc-space").checked, knows119: q("sc-119").checked, restingSpo2: spo2,
          });
        };
        q("sc-decline").onclick = () => done({ declined: true });
      },
    });
  }

  // Countdown against a wall-clock deadline (timers are throttled in hidden tabs and paused while a
  // phone is locked); a screen wake lock is requested while the phase runs. The executor reports the
  // real elapsed time, which the kernel uses (short warm-ups, extra work minutes).
  function openPhase(input) {
    const dlg = q("phase-dialog");
    const speed = q("fast").checked ? 10 : 1;
    let timer = null, wake = null, t0 = 0, tick = () => {};
    const onVis = () => { if (!document.hidden && wake === null && navigator.wakeLock) navigator.wakeLock.request("screen").then((w) => { wake = w; }).catch(() => {}); };
    const out = (early) => ({ early, actualMinutes: ((performance.now() - t0) / 60000) * speed, speed });
    return runDialog(dlg, {
      cancelValue: () => out("stop"),
      abortValue: () => out("aborted"),
      cleanup: () => { clearInterval(timer); document.removeEventListener("visibilitychange", tick); if (wake) wake.release().catch(() => {}); wake = null; },
      init(done) {
        t0 = performance.now();
        const end = t0 + (input.minutes * 60000) / speed;
        q("ph-title").textContent = `${A.PHASE_KO[input.phase] || input.phase} ${input.minutes}분${speed > 1 ? " (시연용 10배속 — 기록에 표시됨)" : ""}`;
        q("ph-instr").textContent = input.instruction;
        q("ph-targets").textContent = `${rpeText(input.target_rpe_low, input.target_rpe_high)} · 심박 ${input.target_hr_low}–${input.target_hr_high} bpm(참고)`;
        const render = (left) => { q("ph-timer").textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`; };
        tick = () => { const left = Math.max(0, Math.ceil((end - performance.now()) / 1000)); render(left); if (left <= 0) done(out(null)); onVis(); };
        tick();
        timer = setInterval(tick, 500);
        document.addEventListener("visibilitychange", tick);
        q("ph-next").onclick = () => done(out("done"));
        q("ph-symptom").onclick = () => done(out("symptom"));
        q("ph-stop").onclick = () => done(out("stop"));
      },
    });
  }

  // Check-in: 12-s still camera measurement (or a value typed from a device) + Borg scales with
  // verbal anchors (no preselected value) + SpO2 + symptoms.
  function openCheckIn(input, ctx) {
    const dlg = q("checkin-dialog");
    const video = q("ci-video"), canvas = q("ci-canvas");
    let meas = null, result = null, warnedSpo2 = false;
    const stopMeasure = () => {
      if (meas) { clearInterval(meas.timer); if (meas.stream) meas.stream.getTracks().forEach((t) => t.stop()); meas = null; }
      video.srcObject = null;
      q("ci-measure").disabled = false;
    };
    const cancelValue = () => ({ hr: null, hrWithheld: false, hrSource: null, rpe: null, dyspnea: null, spo2: null, symptoms: ["wants_to_stop"], cancelled: true });
    let win = null;
    return runDialog(dlg, {
      cancelValue,
      abortValue: () => ({ aborted: true }),
      cleanup: stopMeasure,
      init(done) {
        q("ci-reason").textContent = input.reason;
        q("ci-hr").textContent = "--"; q("ci-status").textContent = ""; q("ci-error").textContent = "";
        q("ci-spo2").value = ""; q("ci-hr-manual").value = "";
        q("ci-spo2-label").textContent = ctx.profile.copd ? "SpO₂ (맥박산소측정기, COPD 필수)" : "SpO₂ (측정기가 있으면)";
        buildScale("ci-rpe", "ci-rpe", A.RPE_ANCHORS, 6, 20);
        buildScale("ci-dys", "ci-dys", A.CR10_ANCHORS, 0, 10);
        dlg.querySelectorAll("input[name=ci-sym]").forEach((c) => (c.checked = false));
        q("ci-measure").onclick = async () => {
          if (meas) return;
          if (!secure()) { q("ci-status").textContent = "이 주소에서는 카메라를 쓸 수 없습니다 — 심박은 측정기 값을 입력하거나 비워두세요."; return; }
          q("ci-measure").disabled = true;
          const token = {};
          meas = { token, stream: null, timer: null };
          q("ci-status").textContent = "카메라 권한을 기다리는 중…";
          let s;
          try { s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: 320, height: 240 }, audio: false }); }
          catch (e) { if (meas && meas.token === token) { meas = null; q("ci-measure").disabled = false; q("ci-status").textContent = "카메라를 켤 수 없습니다 — 측정기 값을 입력하거나 비워두세요."; } return; }
          if (!meas || meas.token !== token) { s.getTracks().forEach((t) => t.stop()); return; } // dialog closed meanwhile
          meas.stream = s;
          video.srcObject = s;
          try { await video.play(); } catch (e) { /* frames may still arrive */ }
          const ctx2d = canvas.getContext("2d", { willReadFrequently: true });
          const buf = [], t0 = performance.now(), need = core.DEFAULTS.bufferSeconds + 0.5;
          const wall0 = Date.now() - performance.now();
          meas.timer = setInterval(() => {
            if (!video.videoWidth) return;
            canvas.width = video.videoWidth; canvas.height = video.videoHeight; ctx2d.drawImage(video, 0, 0);
            const c = core.roiRgbMean(ctx2d, canvas.width, canvas.height);
            core.pushSample(buf, { t: performance.now() / 1000, r: c.r, g: c.g, b: c.b }, core.DEFAULTS.bufferSeconds);
            const el = (performance.now() - t0) / 1000;
            q("ci-status").textContent = `움직이지 말고 카메라를 보세요… ${Math.max(0, Math.ceil(need - el))}초`;
            if (el >= need) {
              result = core.processSignal(buf);
              win = buf.length ? { winStart: new Date(wall0 + buf[0].t * 1000).toISOString(), winEnd: new Date(wall0 + buf[buf.length - 1].t * 1000).toISOString() } : null;
              stopMeasure();
              q("ci-hr").textContent = result.bpm != null ? Math.round(result.bpm) : "보류";
              q("ci-status").textContent = result.bpm != null ? `품질 ${result.quality} (스펙트럼 SNR ${result.snrDb.toFixed(1)} dB). 운동 직후 회복기 값이라 운동 중보다 낮게 나옵니다.` : "신호 품질이 낮아 보류했습니다. 측정기 값을 입력하거나 비워두세요.";
            }
          }, 1000 / core.DEFAULTS.sampleHz);
        };
        q("ci-submit").onclick = () => {
          const rpe = radioVal("ci-rpe"), dys = radioVal("ci-dys");
          const manualRaw = q("ci-hr-manual").value, spo2Raw = q("ci-spo2").value;
          const manual = manualRaw === "" ? null : Number(manualRaw), spo2 = spo2Raw === "" ? null : Number(spo2Raw);
          const err = [];
          if (rpe == null) err.push("자각인지도를 고르세요");
          if (dys == null) err.push("호흡곤란 정도를 고르세요");
          if (manual != null && !(Number.isFinite(manual) && manual > 0 && manual <= 300)) err.push("심박은 기기에 표시된 숫자(1–300)로 입력하세요");
          if (spo2 != null && !(Number.isFinite(spo2) && spo2 >= 0 && spo2 <= 100)) err.push("SpO₂는 0–100 사이 숫자로 입력하세요");
          if (err.length) { q("ci-error").textContent = err.join(" · "); return; }
          if (ctx.profile.copd && spo2 == null && !warnedSpo2) {
            warnedSpo2 = true;
            q("ci-error").textContent = "COPD는 산소포화도 값이 필요합니다. 측정기가 없으면 한 번 더 ‘체크인 제출’을 누르세요 — 다음 운동 구간은 열리지 않습니다.";
            return;
          }
          const hr = manual != null ? manual : result && result.bpm != null ? result.bpm : null;
          const cam = manual == null && result && result.bpm != null;
          done(Object.assign({
            hr, hrSource: manual != null ? "manual" : cam ? "camera-rppg" : null,
            hrWithheld: manual == null && !!result && result.bpm == null,
            rpe, dyspnea: dys, spo2,
            symptoms: Array.from(dlg.querySelectorAll("input[name=ci-sym]:checked")).map((c) => c.value),
          }, (cam || (result && manual == null)) && win ? win : {}));
        };
        q("ci-cancel").onclick = () => done(cancelValue());
      },
    });
  }

  function openSts() {
    const dlg = q("sts-dialog");
    let t = null;
    return runDialog(dlg, {
      cancelValue: () => ({ count: null, source: "manual", early: "stop" }),
      abortValue: () => ({ count: null, source: "manual", early: "aborted" }),
      cleanup: () => clearInterval(t),
      init(done) {
        q("sd-timer").textContent = "0:30"; q("sd-count").value = ""; q("sd-error").textContent = "";
        q("sd-start").disabled = false;
        q("sd-start").onclick = () => {
          q("sd-start").disabled = true;
          const end = performance.now() + 30000;
          t = setInterval(() => { const left = Math.max(0, Math.ceil((end - performance.now()) / 1000)); q("sd-timer").textContent = `0:${String(left).padStart(2, "0")}`; if (left <= 0) { clearInterval(t); q("sd-count").focus(); } }, 250);
        };
        q("sd-submit").onclick = () => {
          const raw = q("sd-count").value, c = raw === "" ? null : Number(raw);
          if (c != null && !(Number.isInteger(c) && c >= 0 && c <= 40)) { q("sd-error").textContent = "0–40 사이의 정수를 입력하세요."; return; }
          done({ count: c, source: "manual" });
        };
        q("sd-skip").onclick = () => done({ count: null, source: "manual", early: "skip" });
        q("sd-symptom").onclick = () => done({ count: null, source: "manual", early: "symptom" });
        q("sd-cancel").onclick = () => done({ count: null, source: "manual", early: "stop" });
      },
    });
  }

  // Coaching text for a real patient appears in its own dialog (and is read out), not only in the log.
  function openMessage(input) {
    const dlg = q("msg-dialog");
    return runDialog(dlg, {
      cancelValue: () => ({}),
      abortValue: () => ({}),
      init(done) {
        q("msg-from").textContent = plannerKind === "claude" ? "AI 코치 (커널 검사 통과 · 의료적 판단 아님)" : "안내";
        q("msg-text").textContent = input.message;
        q("msg-ok").onclick = () => done({});
      },
    });
  }

  function realUserExecutors() {
    return {
      pre_session_safety_check: openSafetyCheck,
      say_to_patient: openMessage,
      set_exercise_phase: openPhase,
      still_check_in: openCheckIn,
      run_sts_test: openSts,
    };
  }

  // ---------------------------------------------------------------- planners
  const SYSTEM_PROMPT = `You are the planning layer of VitalLens, a home cardiopulmonary telerehabilitation research prototype (not a medical device). You coach one patient through a short exercise session in Korean.

How the system works:
- You act only through the provided tools. A deterministic safety kernel checks every tool call before it runs and re-checks every check-in afterwards. It can reject your call (you get is_error with the reason and the allowed limits) or force a stop. Its decisions are final: comply, never argue, never try to work around a rejection.
- The patient only sees what you send through say_to_patient, the instruction of set_exercise_phase and the summary of end_session. Those texts are screened by the kernel. Any plain text you write outside tools is shown to clinicians as a model note, never to the patient.
- Order: get_patient_profile -> compute_target_zone -> pre_session_safety_check -> one short say_to_patient introduction -> warmup (5 min) -> still_check_in -> run_sts_test -> still_check_in -> work blocks of about 5 min, each followed by still_check_in (total work at most 30 min; two blocks are enough) -> cooldown (5 min) -> still_check_in -> end_session. Use only targets inside the zone; warm-up and cool-down stay at or below the zone's lower heart-rate bound and RPE 11.
- If a check-in says reduce, use the caps it returns for every later phase. If it says hold, do another still_check_in and ask for the pulse-oximeter value before any work block. If it says stop, or the safety check fails, call end_session immediately with a calm one-sentence summary.
- Heart rate is measured only at still check-ins, right after exercise stops, so it reads lower than during exercise.

Boundaries: you are not a clinician. Do not diagnose, interpret symptoms beyond the kernel's decision, or give medication advice. Keep every patient message to one or two short Korean sentences.`;

  async function runClaude(model) {
    if (!apiKey) throw new Error("API 키를 먼저 입력하고 ‘적용’을 누르세요.");
    const mod = await import(SDK_URL);
    const Anthropic = mod.default || mod.Anthropic;
    const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
    const tools = A.toAnthropicTools();
    const messages = [{ role: "user", content: "세션을 시작해 주세요." }];
    let nudged = false;
    for (let iter = 0; iter < 60 && !harness.aborted; iter++) {
      let response;
      try {
        response = await client.beta.messages.create({
          model, max_tokens: 16000, system: SYSTEM_PROMPT, tools, messages,
          output_config: { effort: "low" },
          betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
        });
      } catch (err) {
        if (err instanceof Anthropic.AuthenticationError) throw new Error("API 키가 유효하지 않습니다 (401).");
        if (err instanceof Anthropic.PermissionDeniedError) throw new Error("이 키로는 해당 모델을 쓸 수 없습니다 (403).");
        if (err instanceof Anthropic.NotFoundError) throw new Error(`모델 ID를 확인하세요: ${model} (404).`);
        if (err instanceof Anthropic.RateLimitError) throw new Error("요청 한도를 초과했습니다 (429). 잠시 후 다시 시도하세요.");
        if (err instanceof Anthropic.BadRequestError) throw new Error("요청 형식 오류 (400): " + err.message);
        if (err instanceof Anthropic.APIError && err.status >= 500) throw new Error(`Claude API 일시 오류 (${err.status}). 잠시 후 다시 시도하세요.`);
        if (err instanceof Anthropic.APIConnectionError) throw new Error("네트워크 연결 실패 — 인터넷 연결을 확인하세요.");
        throw err;
      }
      await harness.audit.append({ actor: "claude", type: "model_response", requested: model, served: response.model, stop_reason: response.stop_reason });
      for (const b of response.content) {
        if (b.type === "text" && b.text.trim()) { await harness.audit.append({ actor: "claude", type: "model_text", model: response.model, text: b.text }); modelNote(b.text); }
      }
      if (response.stop_reason === "refusal") { modelNote("(모델이 이 요청에 응답하지 않았습니다. 규칙 기반 플래너로 다시 시도하세요.)"); return; }
      if (response.stop_reason === "max_tokens") { modelNote("(응답이 길이 제한에 걸려 중단되었습니다.)"); return; }
      messages.push({ role: "assistant", content: response.content });
      if (response.stop_reason === "pause_turn") continue;
      const uses = response.content.filter((b) => b.type === "tool_use");
      if (!uses.length) {
        if (harness.session.ended || nudged) return;
        nudged = true;
        messages.push({ role: "user", content: "세션을 계속 진행하거나 end_session으로 마무리해 주세요." });
        continue;
      }
      const results = [];
      for (const u of uses) {
        const r = harness.aborted ? { vetoed: true, reason: "사용자가 세션을 중지했습니다." } : await harness.propose(u.name, u.input, "claude");
        const payload = JSON.stringify(r, (k, v) => (k === "filtered" ? undefined : v));
        results.push({ type: "tool_result", tool_use_id: u.id, content: payload, is_error: !!(r && r.vetoed) });
      }
      messages.push({ role: "user", content: results });
      if (harness.session.ended) return;
    }
  }

  // ---------------------------------------------------------------- run / audit / exports
  function profileFromForm() {
    const num = (id) => (q(id).value === "" ? NaN : Number(q(id).value));
    return {
      id: q("p-id").value.trim() || "P01",
      age: num("p-age"), restHr: num("p-rhr"),
      hrMaxTest: num("p-hrmax"), testOnCurrentMeds: q("p-onmeds").checked,
      betaBlocker: q("p-beta").checked, copd: q("p-copd").checked,
      risk: q("p-risk").value || null, supervised: q("p-supervised").checked,
    };
  }

  async function start() {
    if (running) return;
    const source = q("src").value, mode = q("planner").value;
    const real = source === "real";
    if (!PID_RE.test(q("p-id").value.trim() || "P01")) { q("run-status").textContent = "환자 ID는 영문·숫자·-·_ 12자 이내 가명으로 쓰세요(예: P01). 실명은 쓰지 마세요."; q("p-id").focus(); return; }
    if (real && !q("risk-confirm").checked) { q("run-status").textContent = "실제 사용자 모드: 나이·안정시 심박·위험군이 담당 의료진이 정한 값인지 먼저 확인하세요."; q("risk-confirm").focus(); return; }
    if (mode === "claude" && !q("consent").checked) { q("run-status").textContent = "Claude 플래너를 쓰려면 전송 항목에 동의해야 합니다."; q("consent").focus(); return; }
    running = true; plannerKind = mode; realMode = real; hiddenNotes = 0;
    q("timeline").innerHTML = "";
    q("run").disabled = true; q("stop").disabled = false;
    q("verify-status").textContent = ""; q("head-hash").textContent = "";
    const executors = real ? realUserExecutors() : A.createVirtualPatient(source.replace("vp-", ""), 7);
    harness = A.createHarness({ profile: profileFromForm(), executors, onEvent, source: real ? "real-user" : "virtual-patient", synthetic: !real });
    q("run-status").textContent = mode === "claude" ? "Claude 플래너 실행 중…" : "규칙 기반 플래너(AI 아님) 실행 중…";
    try {
      if (mode === "claude") await runClaude(q("model").value.trim() || "claude-opus-5");
      else await A.runRulePlanner(harness, A.createRulePlanner({ unsafe: source === "vp-redteam" }));
      await harness.finish(harness.aborted ? "세션을 중지했습니다." : A.END_SCRIPT);
      q("run-status").textContent = `${harness.aborted ? "중지됨" : "완료"} — ${STATE_KO[harness.kernel.state.status]} · 거부 ${harness.session.vetoes}건 · 체크인 ${harness.session.observations.length}회${hiddenNotes ? ` · 모델 메모 ${hiddenNotes}건은 감사 기록에만 저장` : ""}`;
    } catch (e) {
      q("run-status").textContent = "중단: " + e.message;
      addCard("veto", `<div class="tl-head">실행 중단</div><p>${esc(e.message)}</p>`);
      try { await harness.userStop("오류로 실행이 중단되었습니다: " + e.message, "harness"); await harness.finish("오류로 세션을 종료합니다."); } catch (e2) { /* keep the UI usable */ }
    } finally {
      try { await harness.audit.flush(); } catch (e) { /* ignore */ }
      renderAudit();
      running = false; q("run").disabled = false; q("stop").disabled = true;
      q("dl-audit").disabled = q("dl-fhir").disabled = q("verify").disabled = false;
      q("head-hash").textContent = harness.audit.head();
      if (!q("stop-dialog").open) q("run-status").focus();
    }
  }

  async function stopNow() {
    if (!harness || !running) return;
    q("run-status").textContent = "중지했습니다 — 세션을 안전하게 종료합니다.";
    await harness.userStop("사용자가 ‘중지’를 눌렀습니다", "user");
    if (pending) pending.abort();
  }

  function renderAudit() {
    if (!harness) return;
    harness.audit.flush().then(() => {
      q("audit-body").innerHTML = harness.audit.entries.map((e) => `<tr><td>${e.seq}</td><td>${esc(ACTOR_KO[e.actor] || e.actor)}</td><td>${esc(TYPE_KO[e.type] || e.type)}</td><td>${esc(TOOL_KO[e.tool] || e.tool || "")}</td><td class="mono">${esc(e.hash.slice(0, 10))}…</td></tr>`).join("");
      q("audit-count").textContent = harness.audit.entries.length;
    });
  }

  function download(name, obj) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function renderTools() {
    q("tool-list").innerHTML = A.TOOLS.map((t) => `<tr><th scope="row"><code>${esc(t.name)}</code><br><span class="small">${esc(t.title)}</span></th><td>${t.annotations.readOnlyHint ? "읽기 전용" : "상태 변경"}${t.annotations.openWorldHint ? " · 환자와 상호작용" : ""}<details><summary class="small">LLM에 전달되는 설명(영문 원문)</summary><p class="small" lang="en">${esc(t.description)}</p></details></td></tr>`).join("");
  }

  function renderRules() {
    const R = A.SAFETY_RULES;
    const row = (label, val, src) => `<tr><th scope="row">${label}</th><td>${val}</td><td class="small"${/[가-힣]/.test(src) ? "" : ' lang="en"'}>${src}</td></tr>`;
    q("rules-body").innerHTML = [
      row("적격성", "고위험 → 불가 · 중위험 → 의료진 승인과 실시간 화상 감독이 있을 때만 · 위험군 없음·비정상 프로필 → 불가", "He et al. 2026; 교재 9.3"),
      row("세션 전 확인", "오늘 새 흉통·심한 숨참·몸 상태 불량 → 오늘 불가 · 휴대전화·안전한 공간·119 확인 필수 · COPD는 안정 시 SpO₂ 필수", "교재 9.3 응급 대응 사전 확정"),
      row("시작 강도", `심박예비량 ${R.hrrStart.low * 100}–${R.hrrStart.high * 100}% (중위험 ${R.hrrStartMid.low * 100}–${R.hrrStartMid.high * 100}%)`, esc(R.hrrStart.source)),
      row("목표 RPE (Borg 6–20)", `${R.rpeTarget.low}–${R.rpeTarget.high} (중위험 ${R.rpeTargetMid.low}–${R.rpeTargetMid.high})`, esc(R.rpeTarget.source)),
      row("강도 하향", `RPE > 목표 상한(저위험 14, 중위험 13) · 호흡곤란 ≥ ${R.dyspneaReduceAt.value}/10 · 심박 > 심박예비량 80% · 심박 > 목표 상한(심박이 1차 기준일 때) · 심박이 상한보다 ${R.hrDiscordance.marginBpm} bpm 넘게 높은데 RPE ≤ 13(불일치) · SpO₂가 안정 시보다 ${R.restingSpo2Min.dropReduce}포인트 이상 하락 · 하향 3회째는 중단`, esc(R.rpeReduceAbove.source) + " / " + esc(R.hrrMax.source)),
      row("즉시 중단 — 척도", `RPE ≥ ${R.scaleStop.rpeAtOrAbove} 또는 호흡곤란 ≥ ${R.scaleStop.dyspneaAtOrAbove}/10`, esc(R.scaleStop.source)),
      row("재확인(보류)", "COPD 체크인에 SpO₂ 없음 · RPE 미응답 · 척도 밖의 값 · 불가능한 SpO₂ → 다음 운동 구간 불가", esc(R.spo2RequiredForCopd.source)),
      row("호흡곤란 목표 (수정 Borg CR10)", `${R.dyspneaTarget.low}–${R.dyspneaTarget.high}/10 — COPD만`, esc(R.dyspneaTarget.source)),
      row("즉시 중단 — 증상", Object.values(A.SYMPTOM_LABELS).map(esc).join(", "), esc(R.stopSymptoms.source)),
      row("즉시 중단 — 산소포화도", `SpO₂ ≤ ${R.spo2StopAtOrBelow.value}% (맥박산소측정기 값)`, esc(R.spo2StopAtOrBelow.source)),
      row("즉시 중단 — 심박", "정지 체크인 심박 ≥ 최대심박(검사값 또는 220 − 나이), 220 초과 또는 30 미만", esc(R.hrCeiling.source)),
      row("세션 전 확인 — 산소포화도", `안정 시 SpO₂ < ${R.restingSpo2Min.value}% → 오늘 불가`, esc(R.restingSpo2Min.source)),
      row("세션 구조", "안전 확인 → 준비운동 → 체크인 → 30초 STS → 체크인 → 운동 구간마다 바로 체크인 → 정리운동 → 체크인 → 종료 · 운동 구간 ≤10분, 누적 ≤30분(실제 경과 시간 반영) · 최소 시간을 못 채운 준비운동 뒤에는 STS·운동 불가", esc(R.session.source)),
      row("문장 검사", "환자에게 가는 모든 문장: 200자 이하, 강도 상향·증상 무시·약물/진단 표현 차단, 중단 뒤에는 고정 안내문만", "VitalLens 설계 규칙(단순 패턴 검사 — 완전하지 않음)"),
      row("최대심박", esc(R.hrMaxFormula.name) + " 또는 운동부하검사 측정값", esc(R.hrMaxFormula.note) + " (" + esc(R.hrMaxFormula.source) + ")"),
    ].join("");
  }

  // Real-user mode must not inherit demo values: the clinician enters age, resting HR and risk.
  const DEMO_PROFILE = { "p-age": "62", "p-rhr": "70", "p-risk": "low" };
  let wasReal = false;
  function syncOptions() {
    const claude = q("planner").value === "claude", real = q("src").value === "real";
    q("claude-opts").hidden = !claude;
    q("real-opts").hidden = !real;
    q("redteam-note").hidden = !(q("src").value === "vp-redteam" && claude);
    if (real && !wasReal) { ["p-age", "p-rhr", "p-hrmax"].forEach((id) => (q(id).value = "")); q("p-risk").value = ""; q("risk-confirm").checked = false; }
    if (!real && wasReal) Object.entries(DEMO_PROFILE).forEach(([id, v]) => { if (!q(id).value) q(id).value = v; });
    wasReal = real;
  }

  async function verifyImported() {
    const f = q("audit-file").files[0];
    if (!f) return;
    let entries;
    try { entries = JSON.parse(await f.text()); } catch (e) { q("import-status").textContent = "JSON 파일을 읽지 못했습니다."; return; }
    const expected = q("expected-head").value.trim();
    const r = await A.verifyAuditLog(entries, expected ? { expectedHead: expected } : null);
    q("import-status").textContent = r.ok
      ? `✅ ${r.count}건 체인 일치${r.anchored ? " · 따로 보관한 머리 해시와도 일치" : " · 머리 해시를 넣지 않아 통째 재작성은 확인하지 못함"} (머리 해시 ${r.head.slice(0, 16)}…)`
      : `⛔ ${r.brokenAt}번 기록에서 불일치 — ${r.why}`;
    q("audit-file").value = "";
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (!q("run")) return;
    renderTools(); renderRules();
    q("claude-data-list").textContent = CLAUDE_DATA.join(", ");
    q("stop-ok").addEventListener("click", () => { q("stop-dialog").close(); q("run-status").focus(); });
    if (!window.isSecureContext) q("insecure-note").hidden = false;
    ["planner", "src"].forEach((id) => q(id).addEventListener("change", syncOptions));
    syncOptions();
    q("key-set").addEventListener("click", () => {
      const v = q("api-key").value.trim(); apiKey = v || null; q("api-key").value = "";
      q("key-status").textContent = apiKey ? "키를 이 탭의 메모리에만 두었습니다. 어디에도 저장하지 않으며, Claude를 호출할 때만 api.anthropic.com으로 보냅니다." : "키가 지워졌습니다.";
    });
    q("run").addEventListener("click", start);
    q("stop").addEventListener("click", stopNow);
    q("verify").addEventListener("click", async () => {
      const r = await A.verifyAuditLog(harness.audit.entries, { expectedHead: harness.audit.head() });
      q("verify-status").textContent = r.ok ? `✅ 이 페이지가 만든 기록 ${r.count}건 — 해시 체인 일치` : `⛔ ${r.brokenAt}번 기록에서 체인 불일치 (${r.why})`;
    });
    q("dl-audit").addEventListener("click", () => download(`vitallens_audit_${harness.session.patientId}.json`, harness.audit.entries));
    q("dl-fhir").addEventListener("click", () => download(`vitallens_fhir_${harness.session.patientId}.json`, A.toFhirBundle(harness.session, { auditHead: harness.audit.head() })));
    q("audit-import-btn").addEventListener("click", () => q("audit-file").click());
    q("audit-file").addEventListener("change", verifyImported);
    window.addEventListener("pagehide", () => { if (pending) pending.abort(); });
  });
})();
