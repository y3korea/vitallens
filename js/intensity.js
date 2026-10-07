// VitalLens — dual-channel intensity calculator (HR reserve + RPE/dyspnea) and a
// risk-screening mini-flow. The calculator reuses the AI coach's zone and kernel.
(function () {
  const q = (id) => document.getElementById(id);
  const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

  // Uses the same zone + kernel as the AI coach (js/agent-core.js), so the rules live in one place.
  function initKarvonen() {
    if (!q("in-age") || !window.VLAgent) return;
    const A = window.VLAgent, R = A.SAFETY_RULES, RPE_ANCHORS = A.RPE_ANCHORS, CR10_ANCHORS = A.CR10_ANCHORS;
    const ids = ["in-age", "in-rhr", "in-hrmax", "in-onmeds", "in-intensity", "in-beta", "in-copd", "in-rpe", "in-dyspnea"];

    function readouts() {
      q("in-age-v").textContent = q("in-age").value;
      q("in-rhr-v").textContent = q("in-rhr").value;
      q("in-intensity-v").textContent = q("in-intensity").value + "%";
      const rpe = +q("in-rpe").value, dys = +q("in-dyspnea").value;
      q("in-rpe-v").textContent = rpe;
      q("in-rpe-a").textContent = RPE_ANCHORS[rpe];
      q("in-rpe").setAttribute("aria-valuetext", `${rpe}, ${RPE_ANCHORS[rpe]}`);
      q("in-dyspnea-v").textContent = dys;
      q("in-dyspnea-a").textContent = CR10_ANCHORS[dys];
      q("in-dyspnea").setAttribute("aria-valuetext", `${dys}, ${CR10_ANCHORS[dys]}`);
    }

    function recompute(announce) {
      readouts();
      const age = +q("in-age").value, restHr = +q("in-rhr").value, pct = +q("in-intensity").value / 100;
      const hrMaxTest = q("in-hrmax").value ? +q("in-hrmax").value : NaN;
      const profile = { age, restHr, hrMaxTest, testOnCurrentMeds: q("in-onmeds").checked, betaBlocker: q("in-beta").checked, copd: q("in-copd").checked, risk: "low" };
      const bad = A.profileProblems(profile);
      if (bad.length) {
        q("out-hr").textContent = "--";
        q("out-hrmax").textContent = "";
        q("primary-guidance").innerHTML = `<span class="text-critical">입력값을 확인하세요: ${esc(bad.join(", "))}.</span> 검사 최대심박은 안정시 심박보다 20 이상 높고 80–220 사이여야 하며, 검사값이 없으면 비워두세요(220 − 나이 추정을 씁니다).`;
        if (announce) q("guidance-sr").textContent = q("primary-guidance").textContent;
        return;
      }
      const z = A.targetZone(profile);
      const target = Math.round(restHr + (z.hrMax - restHr) * pct);
      q("out-hr").textContent = target;
      q("out-hrmax").textContent = `최대심박 ${z.hrMax} bpm (${z.hrMaxSource}${z.hrMaxSource === "운동부하검사" ? "" : ", 오차 ±12 bpm"})`;

      const k = A.createKernel(profile).evaluate({ hr: target, rpe: +q("in-rpe").value, dyspnea: +q("in-dyspnea").value, spo2: profile.copd ? 95 : null, symptoms: [] });
      const parts = [];
      parts.push(z.rpePrimary
        ? `<strong>자각인지도(RPE)가 1차 기준입니다.</strong> ${esc(z.note.split(" — ")[1] || "")} — 목표심박수는 참고용입니다.`
        : "<strong>측정된 최대심박 기반 목표심박수가 1차 기준</strong>이고 RPE는 보조 지표입니다.");
      parts.push(`목표 RPE ${R.rpeTarget.low}–${R.rpeTarget.high}(약간 힘듦)${profile.copd ? ` · 호흡곤란 ${R.dyspneaTarget.low}–${R.dyspneaTarget.high}/10(COPD)` : ""}.`);
      if (pct < R.hrrStart.low || pct > R.hrrStart.high) parts.push(`선택한 ${Math.round(pct * 100)}%는 시작 권장 구간(${R.hrrStart.low * 100}–${Math.round(R.hrrStart.high * 100)}%) 밖입니다${pct > R.hrrMax.high ? " — 심장질환 상한 80%도 넘습니다" : ""}.`);
      if (k.action !== "continue") parts.push(`<span class="text-critical">⚠ 안전 커널 판정: ${esc(A.ACTION_KO[k.action])} — ${esc(k.reasons.filter((r) => !/미측정|보류/.test(r)).join(", "))}</span>`);
      q("primary-guidance").innerHTML = parts.join(" ");
      if (announce) q("guidance-sr").textContent = q("primary-guidance").textContent;
    }
    ids.forEach((id) => q(id).addEventListener("input", () => recompute(false)));
    ids.forEach((id) => q(id).addEventListener("change", () => recompute(true)));
    recompute(false);
  }

  // Screening questions: the textbook's stratification elements (9.3: left-ventricular function,
  // ischaemia/arrhythmia on exercise testing, time since the event, comorbidity and cognitive/sensory
  // function, a helper at home) plus pulmonary items. Tiers and cut-offs are VitalLens design rules.
  const CONTRA = { id: "c1", text: "지금 또는 최근 며칠 사이, 가만히 있을 때도 흉통·가슴 압박감이나 실신할 것 같은 느낌이 있다" };
  const RISK_QUESTIONS = [
    { id: "q1", text: "심근경색·불안정 협심증 또는 심장 시술·수술 후 6주가 지나지 않았거나, 아직 담당의의 운동 허가를 받지 않았다", hard: true },
    { id: "q2", text: "운동부하검사에서 허혈 또는 복잡한 부정맥 소견이 있었다", hard: true },
    { id: "q3", text: "좌심실 박출률(LVEF)이 40% 미만이다 (심초음파 등 검사로 확인)", hard: true },
    { id: "q4", text: "심정지 병력이 있거나 삽입형 제세동기(ICD)를 쓴다", hard: true },
    { id: "q5", text: "안정 시 산소포화도가 92% 미만이거나 가정 산소를 쓴다", hard: true },
    { id: "q6", text: "좌심실 박출률이 40–49%이거나, 최근 1년 안에 심부전으로 입원한 적이 있다", hard: false },
    { id: "q7", text: "최근 6주 안에 COPD 급성악화로 입원하거나 응급실에 갔다", hard: false },
    { id: "q8", text: "조절되지 않는 동반질환(당뇨·고혈압·만성신질환 등)이 있다", hard: false },
    { id: "q9", text: "인지 저하나 시력·청력 문제로 화면 안내를 따르거나 척도에 답하기 어렵다", hard: false },
    { id: "q10", text: "심박조율기를 쓴다 (심박 반응이 달라 자각인지도 중심으로 판단)", hard: false },
    { id: "q11", text: "집에서 도움을 줄 보호자·조력자가 없다", hard: false },
  ];

  function initRiskFlow() {
    const root = q("risk-flow");
    if (!root) return;
    const answers = {};
    [Object.assign({ contra: true }, CONTRA)].concat(RISK_QUESTIONS).forEach((qu) => {
      const row = document.createElement("div");
      row.className = "risk-q" + (qu.contra ? " risk-q-contra" : "");
      const label = qu.contra ? `<strong>⛔ [운동 금기] ${qu.text}</strong>` : qu.hard ? `<strong><span class="badge badge-warn">주요</span> ${qu.text}</strong>` : qu.text;
      row.innerHTML = `<span class="q" id="lbl-${qu.id}">${label}</span>
        <div class="toggle" role="group" aria-labelledby="lbl-${qu.id}" data-q="${qu.id}"><button type="button" data-val="0" aria-pressed="false">아니오</button><button type="button" data-val="1" aria-pressed="false">예</button></div>`;
      root.appendChild(row);
      answers[qu.id] = null;   // unanswered is never treated as "no"
      row.querySelectorAll("button").forEach((b) => {
        b.addEventListener("click", () => {
          row.querySelectorAll("button").forEach((x) => { x.classList.remove("on"); x.setAttribute("aria-pressed", "false"); });
          b.classList.add("on"); b.setAttribute("aria-pressed", "true");
          answers[qu.id] = b.dataset.val === "1";
          evaluate();
        });
      });
    });

    function evaluate() {
      const hardHit = RISK_QUESTIONS.some((qu) => qu.hard && answers[qu.id] === true);
      const softScore = RISK_QUESTIONS.filter((qu) => !qu.hard && answers[qu.id] === true).length;
      const missing = [CONTRA].concat(RISK_QUESTIONS).filter((qu) => answers[qu.id] == null).length;
      const el = q("risk-result");
      el.classList.remove("risk-low", "risk-mid", "risk-high", "risk-contra");
      if (answers.c1 !== true && missing) {
        el.textContent = `아직 답하지 않은 질문이 ${missing}개 있습니다. 모든 질문에 답하면 결과가 나옵니다.`;
        return;
      }
      if (answers.c1) {
        el.classList.add("risk-contra");
        el.innerHTML = "⛔ <strong>운동을 시작하지 마세요.</strong> 가만히 있을 때의 흉통·실신 전조는 바로 진료가 필요한 상태입니다. 증상이 지금 있으면 119에 전화하세요.";
      } else if (hardHit || softScore >= 2) {
        el.classList.add("risk-high");
        el.innerHTML = "🔴 <strong>고위험 가능성</strong> — 원격 단독 운동은 권하지 않습니다. 담당 의료진과 상의해 센터 감독 프로그램에서 시작하고, 안정된 뒤 의료진 판단으로 원격으로 옮기세요(단계적 전환). VitalLens AI 코치는 고위험군 세션을 열지 않습니다.";
      } else if (softScore === 1) {
        el.classList.add("risk-mid");
        el.innerHTML = "🟡 <strong>중위험 가능성</strong> — 의료진의 위험 층화와 운동 허가가 먼저입니다. 원격으로 한다면 의료진이 실시간 화상으로 감독하는 조건에서 낮은 강도(심박예비량 40–49%, RPE 11–13)로 시작합니다.";
      } else {
        el.classList.add("risk-low");
        el.innerHTML = "🟢 <strong>저위험 가능성</strong> — 참고용 결과입니다. 담당 의료진의 위험 층화·운동 허가를 받은 뒤 시작하고, 초기 세션은 실시간 화상 감독을 권장합니다(교재 9.3).";
      }
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    initKarvonen();
    initRiskFlow();
  });
})();
