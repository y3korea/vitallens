// VitalLens agent harness core — tool registry (MCP tool-definition shape), deterministic
// safety kernel with veto power, rule-based planner, hash-chained audit log, FHIR export.
// Shared by agent.html, the Node safety-scenario tests (validation/test_agent.js) and the
// stdio MCP server (mcp/server.js).
//
// Design rule: a planner (rule-based or LLM) may only PROPOSE actions through tools, and the
// only way to put words in front of the patient is a tool (say_to_patient, or the instruction /
// summary fields), so every patient-facing sentence passes the kernel too. Every proposal is
// schema-checked and gated; every observation is re-checked by the kernel, which can force a
// stop regardless of what the planner says next.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.VLAgent = api;
})(typeof self !== "undefined" ? self : this, function () {
  // ---------------------------------------------------------------- safety rules
  // Guideline numbers carry their source (verified against the primary texts, 2026-09).
  // Values marked "design choice" are VitalLens's own conservative rules, not guideline cut-offs.
  const SAFETY_RULES = {
    hrrStart: { low: 0.4, high: 0.59, source: "EAPC 2020 (Ambrosetti et al.) Table 1–2: moderate = 40–59% HRR; moderate/high-risk patients start at 40% HRR" },
    hrrStartMid: { low: 0.4, high: 0.49, source: "Design choice: supervised mid-risk sessions use the lower half of the EAPC 2020 moderate band (40–49% HRR)" },
    hrrMax: { high: 0.8, source: "AHA 2013 Exercise Standards (Fletcher et al.) Table 7: heart disease 40–80% HRR — a heart rate above 80% HRR at a check-in forces a reduction even when RPE is primary" },
    rpeTarget: { low: 12, high: 14, source: "EAPC 2020 Table 1: moderate = Borg 12–14; AACVPR/AHA/ACC 2019: 12–14 most common in home-based CR trials" },
    rpeTargetMid: { low: 11, high: 13, source: "Design choice: lower half of the moderate band for supervised mid-risk sessions" },
    rpeReduceAbove: { value: 14, source: "EAPC 2020 moderate band ends at 14; AHA 2013: RPE >15–16 suggests the ventilatory threshold has been exceeded. Reducing from 15 keeps unsupervised sessions inside the moderate band — design choice" },
    dyspneaTarget: { low: 4, high: 6, source: "ATS/ERS 2013 pulmonary rehabilitation statement: Borg dyspnea 4–6 often considered a training target (COPD/chronic respiratory disease only)" },
    dyspneaReduceAt: { value: 7, source: "Derived: above the ATS/ERS 2013 target band (4–6) — a design choice, not a guideline cut-off" },
    scaleStop: { rpeAtOrAbove: 17, dyspneaAtOrAbove: 8, source: "Design choice for unsupervised home sessions: RPE ≥17 ('매우 힘듦') or modified-Borg dyspnea ≥8 stops the session (ERS/ATS 2014 lists intolerable dyspnea as a reason to stop)" },
    restingSpo2Min: { value: 92, dropReduce: 4, source: "Design choice matching the risk screener: resting SpO₂ <92% → no unsupervised session today; a check-in SpO₂ ≥4 points below the resting value → reduce (a ≥4-point fall is the usual definition of exercise desaturation)" },
    spo2StopAtOrBelow: { value: 88, source: "ATS 2020 home-oxygen guideline: exertional hypoxemia SpO₂ ≤88% (BTS uses <90%; ERS/ATS 2014 hard stop <80%). ≤88% chosen as the conservative rule for unsupervised home exercise" },
    spo2RequiredForCopd: { source: "The camera cannot measure SpO₂. For COPD/hypoxemia every check-in needs a pulse-oximeter value; without it the kernel holds the next work block — design rule based on ATS 2020" },
    hrCeiling: { source: "AHA 2013: sustained tachyarrhythmia is an indication to stop. A still check-in HR at or above HRmax (tested, or 220 − age) stops the session — arrhythmia or measurement error. Knowledge base 9.3 lists HR above the target ceiling as a stop criterion" },
    hrDiscordance: { marginBpm: 15, source: "Design choice: HR more than 15 bpm above the target ceiling while RPE ≤13 suggests arrhythmia or measurement error — reduce and recheck" },
    reduceLimit: { value: 2, source: "Design choice: a third reduction in one session ends the session" },
    session: {
      workMinutesMax: 30,
      phaseMinutes: { warmup: [3, 10], work: [1, 10], recovery: [1, 5], cooldown: [3, 10] },
      lightRpeMax: 11,
      source: "Design choice for unsupervised home sessions: warm-up/cool-down 3–10 min, work blocks ≤10 min each with a still check-in after every block, total work ≤30 min",
    },
    stopSymptoms: {
      list: ["chest_pain", "presyncope", "severe_dyspnea", "palpitations", "confusion", "wants_to_stop"],
      source: "AHA 2013 absolute indications (angina, dizziness/near-syncope, poor perfusion, subject's desire to stop); ERS/ATS 2014 (intolerable dyspnea, pallor); ATS/ACCP 2003 (confusion); ATS/ERS 2013 (palpitations)",
    },
    hrMaxFormula: {
      name: "220 − 나이 (추정)",
      note: "추정 오차 ±12 bpm(AHA 2013). ESC 2020은 심장질환자에게 예측식을 권하지 않으므로, 운동부하검사로 측정한 최대심박이 없으면 심박 대신 RPE를 1차 기준으로 씁니다.",
      source: "AHA 2013; ESC 2020 Sports Cardiology §4.1.1.3",
    },
    plausible: { hr: [30, 220], spo2: [50, 100], age: [18, 100], restHr: [40, 120], hrMaxTest: [80, 220], minReserve: 20 },
  };

  const SYMPTOM_LABELS = {
    chest_pain: "흉통·흉부 압박감",
    presyncope: "어지러움·실신할 것 같은 느낌",
    severe_dyspnea: "말을 이어갈 수 없을 정도의 호흡곤란",
    palpitations: "갑작스러운 두근거림·불규칙한 맥박",
    confusion: "혼란·식은땀·창백해짐",
    wants_to_stop: "그만하고 싶음",
  };
  const PHASE_KO = { warmup: "준비운동", work: "운동", recovery: "회복", cooldown: "정리운동" };
  // Verbal anchors: Borg scales are only valid when shown with their descriptors.
  const RPE_ANCHORS = { 6: "전혀 힘들지 않음", 7: "극도로 가벼움", 8: "극도로 가벼움~매우 가벼움", 9: "매우 가벼움", 10: "매우 가벼움~가벼움", 11: "가벼움", 12: "가벼움~약간 힘듦", 13: "약간 힘듦", 14: "약간 힘듦~힘듦", 15: "힘듦", 16: "힘듦~매우 힘듦", 17: "매우 힘듦", 18: "매우 힘듦~극도로 힘듦", 19: "극도로 힘듦", 20: "최대로 힘듦" };
  const CR10_ANCHORS = { 0: "전혀 없음", 1: "매우 약함", 2: "약함", 3: "보통", 4: "약간 심함", 5: "심함", 6: "심함~매우 심함", 7: "매우 심함", 8: "매우 심함~극도로 심함", 9: "극도로 심함", 10: "최대" };
  const RISK_KO = { low: "저위험", mid: "중위험", high: "고위험" };
  const ACTION_KO = { continue: "계속", reduce: "강도 하향", hold: "재확인 필요", stop: "중단" };

  // Fixed script shown after a safety stop. Planner text is not shown once the kernel has stopped.
  const STOP_SCRIPT = "운동을 멈추고 앉거나 누워 쉬세요. 혼자 있지 말고 보호자에게 알리세요. 흉통이 5분 넘게 계속되거나 심해지면, 또는 실신할 것 같으면 즉시 119에 전화하세요.";
  // Shown when a session ends without a safety stop (planner quit, operator stop without symptoms).
  const END_SCRIPT = "세션을 마칩니다. 불편한 증상이 있으면 앉거나 누워 쉬고 보호자에게 알리세요. 증상이 없으면 2–3분 천천히 걸으며 마무리하세요.";

  // ---------------------------------------------------------------- patient-facing text screen
  // A simple deterministic screen, not a classifier: it catches the obvious failure modes the
  // literature reports (intensity escalation, symptom minimisation, medication/diagnosis advice).
  // Checked sentence by sentence. A sentence whose instruction is to stop, rest or call for help
  // ("…하면 멈추세요", "…면 119") may mention symptoms; a risky phrase directly negated
  // ("무리하지 마세요", "강도를 높이지 마세요") is allowed. Anything that tells the patient not to stop,
  // to keep going through symptoms, to push harder, or anything about medication is blocked.
  const TEXT_RULES = {
    maxLength: 200,
    always: [
      { re: /(멈추지|쉬지|중단하지|그만두지|그만하지)\s*(마|말)/, why: "멈추지 말라는 표현" },
      { re: /(^|[^가-힣])(약|혈압약|심장약|베타차단제|이뇨제|항응고제|항혈소판제|니트로글리세린|니트로|아스피린|인슐린)(을|를|은|는|도)?(?=\s|$)[^.!?]{0,12}(드세요|드시|먹|복용|건너뛰|끊|줄이|늘리|추가|바꾸)|복용량|용량을|투약|진단(합니다|입니다|이에요|해요)|병명/, why: "약물·진단 관련 조언은 범위 밖입니다" },
    ],
    unlessSafety: [
      { re: /(숨이\s*턱|한계까지|전력(으로|을)|최대한\s*(빠르|빨리|세게|강하|힘껏)|더\s*(빠르게|빨리|세게|강하게|힘껏|오래)|(강도|속도|심박)[을를]?\s*(높|올리)|(?<![가-힣])무리(해|하))/, why: "강도를 올리라는 표현 — 강도는 커널이 승인한 목표로만 바꿉니다" },
      { re: /(참[아으]|참고\s*계속|견디|버티|무시하|아파도|어지러워도|숨이\s*차도|조여도|답답해도|(흉통|가슴|어지러|숨이\s*차|두근|아프|아파).{0,20}(괜찮|계속|이어|다시\s*시작))/, why: "증상을 참거나 무시하라는 표현" },
    ],
    safetyDirective: /(멈추세요|멈추고|멈춰\s*주세요|멈추십시오|쉬세요|쉬십시오|중단하세요|그만하세요|앉거나|누워|119|전화하세요|연락하세요|알리세요)/,
  };
  function screenPatientText(text) {
    if (typeof text !== "string" || !text.trim()) return { ok: false, reason: "빈 문장" };
    if (text.length > TEXT_RULES.maxLength) return { ok: false, reason: `문장 길이 ${text.length}자 > ${TEXT_RULES.maxLength}자` };
    const sentences = text.split(/(?<=[.!?。])\s+|\n+/).filter((x) => x.trim());
    for (const sent of sentences) {
      for (const r of TEXT_RULES.always) if (r.re.test(sent)) return { ok: false, reason: r.why };
      if (TEXT_RULES.safetyDirective.test(sent)) continue;
      for (const r of TEXT_RULES.unlessSafety) {
        const g = new RegExp(r.re.source, "g");
        let m;
        while ((m = g.exec(sent))) {
          const after = sent.slice(m.index + m[0].length, m.index + m[0].length + 6);
          if (!/^.{0,4}지\s*(마|말|않)/.test(after)) return { ok: false, reason: r.why };
        }
      }
    }
    return { ok: true };
  }

  // ---------------------------------------------------------------- tools (MCP tool-definition shape)
  const obj = (properties, required) => ({ type: "object", properties, required: required || [], additionalProperties: false });
  const patientTool = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
  const TOOLS = [
    {
      name: "get_patient_profile",
      title: "환자 프로필 조회",
      description: "Read the patient's clinician-entered risk level and exercise-relevant profile (age, resting HR, exercise-test HRmax if any, beta-blocker use, COPD/hypoxemia, supervision). Call this first.",
      inputSchema: obj({}),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "compute_target_zone",
      title: "목표 강도 구간 계산",
      description: "Compute the kernel-approved intensity band: heart-rate band from heart-rate reserve (Karvonen) plus Borg RPE band, whether RPE must be the primary criterion (no exercise-test HRmax, beta-blocker without an on-medication test, or COPD/hypoxemia), and the dyspnea target for COPD only. Returns the only band set_exercise_phase will accept.",
      inputSchema: obj({}),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: "pre_session_safety_check",
      title: "세션 전 안전 확인",
      description: "Before any exercise, ask the patient today's readiness and emergency plan: new chest pain or unusual breathlessness today, feeling unwell, usual medication taken, phone within reach, a person who is present or reachable, clear space and a stable chair against a wall, knows to call 119, and resting SpO2 from their own oximeter (required for COPD). Any red flag means no session today. The kernel refuses every exercise phase until this passes.",
      inputSchema: obj({}),
      annotations: patientTool,
    },
    {
      name: "say_to_patient",
      title: "환자에게 말하기",
      description: "The only channel for coaching text. One or two short plain-Korean sentences. The kernel screens it (≤200 characters; no intensity escalation, no symptom minimisation, no medication or diagnosis advice) and blocks it after a safety stop, when a fixed stop script is shown instead. Plain text you write outside tools is never shown to the patient.",
      inputSchema: obj({ message: { type: "string", maxLength: 200 } }, ["message"]),
      annotations: patientTool,
    },
    {
      name: "set_exercise_phase",
      title: "운동 단계 지시",
      description: "Start an exercise phase and show the patient the instruction. Kernel rules: the first phase is warmup (once); a still_check_in is required after every phase before the next work phase; minutes per phase warmup/cooldown 3–10, work 1–10, recovery 1–5; total work ≤30 min; warm-up, recovery and cool-down stay at or below the zone's lower HR bound and RPE 11; nothing but check-ins and end_session after cooldown; targets must sit inside the approved (or reduced) band.",
      inputSchema: obj({
        phase: { type: "string", enum: ["warmup", "work", "recovery", "cooldown"] },
        minutes: { type: "number", minimum: 1, maximum: 10 },
        target_hr_low: { type: "number", minimum: 30, maximum: 220 },
        target_hr_high: { type: "number", minimum: 30, maximum: 220 },
        target_rpe_low: { type: "number", minimum: 6, maximum: 20 },
        target_rpe_high: { type: "number", minimum: 6, maximum: 20 },
        instruction: { type: "string", maxLength: 200, description: "Short plain-Korean instruction shown to the patient; screened like say_to_patient." },
      }, ["phase", "minutes", "target_hr_low", "target_hr_high", "target_rpe_low", "target_rpe_high", "instruction"]),
      annotations: patientTool,
    },
    {
      name: "still_check_in",
      title: "정지 체크인",
      description: "Pause the patient for a 12-second still heart-rate measurement (camera rPPG with quality gate, or a value the patient types from a device) and ask RPE (Borg 6–20), in-session dyspnea (modified Borg CR10, 0–10), SpO2 from their oximeter (required for COPD) and warning symptoms. The heart rate is an early-recovery value and reads lower than during exercise. The kernel evaluates the result: continue, reduce (returns the new caps), hold (recheck before more work) or stop.",
      inputSchema: obj({ reason: { type: "string", maxLength: 80 } }, ["reason"]),
      annotations: patientTool,
    },
    {
      name: "run_sts_test",
      title: "30초 앉았다일어서기",
      description: "30-second chair stand; the patient enters the count (the camera counter on the demo page is a separate, unvalidated prototype and is not used here). Allowed once per session, right after the warm-up check-in (a standard condition for tracking change), before any work block, reduction or cool-down; a still_check_in must follow it.",
      inputSchema: obj({}),
      annotations: patientTool,
    },
    {
      name: "end_session",
      title: "세션 종료",
      description: "End the session with a short summary for the patient (screened like say_to_patient). Once exercise has started, the kernel requires a cool-down and a check-in after it, unless the session was stopped for safety.",
      inputSchema: obj({ summary: { type: "string", maxLength: 200 } }, ["summary"]),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ];
  const TOOL_BY_NAME = Object.fromEntries(TOOLS.map((t) => [t.name, t]));

  // Minimal JSON-Schema check for the subset the tool schemas use. The kernel runs it on every
  // proposal, so the ranges stripped from the strict-mode API copy below are still enforced.
  function validateInput(schema, input) {
    if (input === null || typeof input !== "object" || Array.isArray(input)) return "입력이 객체가 아닙니다";
    const props = schema.properties || {};
    const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
    for (const k of Object.keys(input)) {
      if (k === "__proto__" || k === "constructor" || k === "prototype" || !own(props, k)) return `정의되지 않은 필드 ${k}`;
    }
    for (const k of schema.required || []) if (!own(input, k)) return `필수 필드 ${k} 없음`;
    for (const [k, p] of Object.entries(props)) {
      if (!own(input, k)) continue;
      const v = input[k];
      if (p.type === "number" && !(typeof v === "number" && Number.isFinite(v))) return `${k}는 숫자여야 합니다`;
      if (p.type === "string" && typeof v !== "string") return `${k}는 문자열이어야 합니다`;
      if (p.enum && !p.enum.includes(v)) return `${k} 값 ${JSON.stringify(v)} 허용 안 됨`;
      if (p.minimum != null && v < p.minimum) return `${k} ${v} < ${p.minimum}`;
      if (p.maximum != null && v > p.maximum) return `${k} ${v} > ${p.maximum}`;
      if (p.maxLength != null && v.length > p.maxLength) return `${k} 길이 ${v.length} > ${p.maxLength}`;
    }
    return null;
  }

  // Claude strict tool use does not accept numeric/string length constraints, so they are
  // stripped for the API copy; validateInput() enforces them inside the kernel on every call.
  const UNSUPPORTED_STRICT = ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minLength", "maxLength"];
  function stripForStrict(schema) {
    return JSON.parse(JSON.stringify(schema, (k, v) => (UNSUPPORTED_STRICT.includes(k) ? undefined : v)));
  }
  function toAnthropicTools() {
    return TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: stripForStrict(t.inputSchema), strict: true }));
  }

  // ---------------------------------------------------------------- kernel
  function hrMax(age) { return 220 - age; }
  const inRange = (v, r) => typeof v === "number" && Number.isFinite(v) && v >= r[0] && v <= r[1];
  const hasTest = (p) => typeof p.hrMaxTest === "number" && Number.isFinite(p.hrMaxTest);

  // Heart rate is the primary criterion only with an exercise-test HRmax (ESC 2020), and for
  // beta-blocker users only if that test was done on the current medication (ESC/AHA).
  // COPD/hypoxemia: dyspnea limits before heart rate does, so RPE/dyspnea stay primary.
  function targetZone(profile) {
    const tested = hasTest(profile) && profile.hrMaxTest > profile.restHr;
    const max = tested ? profile.hrMaxTest : hrMax(profile.age);
    const hrr = max - profile.restHr;
    const mid = profile.risk === "mid";
    const band = mid ? SAFETY_RULES.hrrStartMid : SAFETY_RULES.hrrStart;
    const rpe = mid ? SAFETY_RULES.rpeTargetMid : SAFETY_RULES.rpeTarget;
    const why = [];
    if (!tested) why.push("운동부하검사 최대심박 없음(예측식 오차 ±12 bpm)");
    if (profile.betaBlocker && !(tested && profile.testOnCurrentMeds)) why.push("베타차단제 복용(현재 약물 상태의 검사 없음)");
    if (profile.copd) why.push("COPD·저산소혈증");
    const rpePrimary = why.length > 0;
    const z = {
      hrLow: Math.round(profile.restHr + hrr * band.low), hrHigh: Math.round(profile.restHr + hrr * band.high),
      hrrCeiling: Math.round(profile.restHr + hrr * SAFETY_RULES.hrrMax.high),
      hrMax: max, hrMaxSource: tested ? "운동부하검사" : "220 − 나이 추정",
      rpeLow: rpe.low, rpeHigh: rpe.high, rpePrimary,
      dyspneaTargetApplies: !!profile.copd,
      note: (rpePrimary
        ? `자각인지도(RPE)가 1차 기준, 심박수는 참고용 — ${why.join(", ")}`
        : "측정된 최대심박 기반 목표심박수가 1차 기준, RPE는 보조 지표") + (mid ? " · 중위험: 구간 아래쪽 절반만 허용" : ""),
    };
    if (profile.copd) { z.dyspneaLow = SAFETY_RULES.dyspneaTarget.low; z.dyspneaHigh = SAFETY_RULES.dyspneaTarget.high; }
    return z;
  }

  function profileProblems(p) {
    const P = SAFETY_RULES.plausible, bad = [];
    if (!inRange(p.age, P.age)) bad.push(`나이 ${p.age}`);
    if (!inRange(p.restHr, P.restHr)) bad.push(`안정시 심박 ${p.restHr}`);
    if (hasTest(p) && !(inRange(p.hrMaxTest, P.hrMaxTest) && p.hrMaxTest >= p.restHr + P.minReserve)) bad.push(`검사 최대심박 ${p.hrMaxTest}(안정시 심박 + ${P.minReserve} 이상, ${P.hrMaxTest[0]}–${P.hrMaxTest[1]})`);
    if (!hasTest(p) && inRange(p.age, P.age) && inRange(p.restHr, P.restHr) && hrMax(p.age) - p.restHr < P.minReserve) bad.push(`심박예비량 부족(220 − 나이 − 안정시 심박 < ${P.minReserve})`);
    return bad;
  }

  function createKernel(profile) {
    const state = {
      status: "ready", stopReason: null, ended: false,
      reduced: false, reduceLevel: 0, checkIns: 0,
      safetyCheck: null, phases: [], workMinutes: 0, stsDone: false, cooldownDone: false,
      checkedSinceLastActivity: true, lastCheck: null, lastPhase: null, warmupShort: false, restingSpo2: null,
      zone: null,
    };

    function eligibility() {
      const bad = profileProblems(profile);
      if (bad.length) return { allow: false, reason: "프로필 값이 허용 범위를 벗어났습니다: " + bad.join(", ") };
      if (profile.risk === "high") return { allow: false, reason: "고위험군 — 원격 단독 세션 불가. 센터 감독 프로그램을 먼저 거친 뒤 의료진 판단으로 전환하세요." };
      if (profile.risk === "mid" && !profile.supervised) return { allow: false, reason: "중위험군 — 의료진이 계획을 승인하고 실시간 화상으로 감독할 때만 세션을 허용합니다(He et al. 2026; 교재 9.3)." };
      if (profile.risk !== "low" && profile.risk !== "mid") return { allow: false, reason: "위험 층화 결과가 없습니다 — 의료진이 층화한 위험군을 입력하세요." };
      return { allow: true, supervised: !!profile.supervised };
    }
    const e = eligibility();
    state.zone = e.allow || profileProblems(profile).length === 0 ? targetZone(profile) : null;
    if (!e.allow) { state.status = "ineligible"; state.stopReason = e.reason; }

    function caps() {
      const z = state.zone, lvl = Math.min(state.reduceLevel, SAFETY_RULES.reduceLimit.value);
      const frac = [1, 0.5, 0.25][lvl];
      return { target_hr_high: Math.round(z.hrLow + (z.hrHigh - z.hrLow) * frac), target_rpe_high: Math.max(z.rpeLow - 1, z.rpeHigh - lvl) };
    }
    const deny = (reason, extra) => Object.assign({ allow: false, reason }, extra || {});

    function gatePhase(input) {
      const p = input.phase, z = state.zone, P = [];
      if (!state.safetyCheck || !state.safetyCheck.passed) return deny("세션 전 안전 확인(pre_session_safety_check)을 먼저 통과해야 합니다.");
      if (!state.phases.length && p !== "warmup") P.push("첫 단계는 준비운동이어야 합니다");
      if (state.phases.length && p === "warmup" && !state.warmupShort) P.push("준비운동은 세션 시작 때 한 번만 합니다");
      if (state.warmupShort && p !== "warmup" && p !== "cooldown") P.push("준비운동이 최소 시간보다 짧게 끝났습니다 — 준비운동을 다시 하세요");
      if (state.lastPhase === "work" && !state.checkedSinceLastActivity) P.push("운동 구간 직후에는 정지 체크인이 먼저입니다 — still_check_in을 하세요");
      if (state.cooldownDone) P.push("정리운동 뒤에는 운동 단계를 더 시작할 수 없습니다");
      if (p === "work" && !state.checkedSinceLastActivity) P.push("직전 단계 뒤 정지 체크인이 없습니다 — still_check_in을 먼저 하세요");
      if (p === "work" && state.lastCheck && state.lastCheck.action === "hold") P.push("직전 체크인이 재확인 필요 상태입니다 — " + state.lastCheck.reasons.join(", "));
      const [mn, mx] = SAFETY_RULES.session.phaseMinutes[p];
      const room = SAFETY_RULES.session.workMinutesMax - state.workMinutes;
      if (!(input.minutes >= mn && input.minutes <= mx)) P.push(`${PHASE_KO[p]} ${input.minutes}분 — 허용 ${mn}–${mx}분`);
      if (p === "work" && input.minutes > room) P.push(`누적 운동 ${state.workMinutes + input.minutes}분 > 세션 한도 ${SAFETY_RULES.session.workMinutesMax}분`);
      const c = caps(), light = p !== "work";
      const hrCap = light ? Math.min(z.hrLow, c.target_hr_high) : c.target_hr_high;
      const rpeCap = light ? Math.min(SAFETY_RULES.session.lightRpeMax, c.target_rpe_high) : c.target_rpe_high;
      if (input.target_hr_low < profile.restHr) P.push(`심박 하한 ${input.target_hr_low} < 안정시 심박 ${profile.restHr}`);
      if (input.target_hr_low > input.target_hr_high) P.push("심박 하한이 상한보다 큽니다");
      if (input.target_hr_high > hrCap) P.push(`심박 상한 ${input.target_hr_high} > 허용 ${hrCap} bpm${state.reduced ? " (강도 하향 상태)" : ""}`);
      if (input.target_rpe_low > input.target_rpe_high) P.push("RPE 하한이 상한보다 큽니다");
      if (input.target_rpe_high > rpeCap) P.push(`RPE 상한 ${input.target_rpe_high} > 허용 ${rpeCap}`);
      const t = screenPatientText(input.instruction);
      if (!t.ok) P.push("지시문: " + t.reason);
      if (P.length) {
        return deny(P.join("; "), { clampTo: { target_hr_low_min: profile.restHr, target_hr_high: hrCap, target_rpe_high: rpeCap, minutes_max: p === "work" ? Math.max(0, Math.min(mx, room)) : mx } });
      }
      return { allow: true };
    }

    // Pre-execution gate for every tool call proposed by any planner.
    function gate(name, input) {
      const tool = TOOL_BY_NAME[name];
      if (!tool) return deny(`알 수 없는 도구: ${name}`);
      const bad = validateInput(tool.inputSchema, input);
      if (bad) return deny("입력 형식 오류 — " + bad);
      if (state.ended) return deny("세션이 이미 종료되었습니다.");
      const readOnly = name === "get_patient_profile" || name === "compute_target_zone";
      if (state.status === "stopped" && !readOnly && name !== "end_session") {
        return deny(`안전 중단 상태(${state.stopReason}) — 세션 종료만 허용됩니다.${name === "say_to_patient" ? " 중단 뒤에는 정해진 안내문만 표시됩니다." : ""}`);
      }
      if (state.status === "ineligible" && !readOnly && name !== "end_session") return deny(`원격 세션 부적격(${state.stopReason}) — 세션 종료만 허용됩니다.`);
      if (name === "compute_target_zone" && !state.zone) return deny("프로필 값이 범위를 벗어나 구간을 계산할 수 없습니다.");
      switch (name) {
        case "pre_session_safety_check":
          if (state.safetyCheck) return deny("세션 전 안전 확인은 이미 했습니다.");
          return { allow: true };
        case "say_to_patient": {
          const t = screenPatientText(input.message);
          return t.ok ? { allow: true } : deny(t.reason);
        }
        case "set_exercise_phase":
          return gatePhase(input);
        case "run_sts_test": {
          const P = [];
          if (state.stsDone) P.push("세션당 한 번만 합니다");
          if (!state.phases.includes("warmup") || state.warmupShort) P.push("최소 시간을 채운 준비운동 뒤에만 합니다");
          if (state.phases.includes("work") || state.cooldownDone) P.push("같은 조건에서 추적하도록 준비운동 직후, 운동 구간 전에만 합니다");
          if (!state.checkedSinceLastActivity) P.push("직전 단계 뒤 정지 체크인이 필요합니다");
          if (state.lastCheck && state.lastCheck.action !== "continue") P.push("직전 체크인 판정이 '계속'이 아닙니다");
          if (state.reduced) P.push("강도 하향 상태에서는 최대 노력 검사를 하지 않습니다");
          return P.length ? deny("30초 앉았다일어서기 불가 — " + P.join("; ")) : { allow: true };
        }
        case "end_session": {
          const t = screenPatientText(input.summary);
          if (!t.ok) return deny("요약문: " + t.reason);
          const exercised = state.phases.length > 0 || state.stsDone;
          if (state.status === "ready" && exercised) {
            if (!state.cooldownDone) return deny("정리운동 없이 끝낼 수 없습니다 — cooldown 단계를 먼저 지시하세요(안전 중단 시에는 바로 종료).");
            if (!state.checkedSinceLastActivity) return deny("정리운동 뒤 정지 체크인이 필요합니다.");
          }
          return { allow: true };
        }
      }
      return { allow: true };
    }

    function recordPhase(input) {
      state.phases.push(input.phase);
      state.lastPhase = input.phase;
      if (input.phase === "work") state.workMinutes += input.minutes;
      if (input.phase === "cooldown") state.cooldownDone = true;
      if (input.phase === "warmup") state.warmupShort = false;
      state.checkedSinceLastActivity = false;
    }
    // What actually happened (the patient may end a phase early, or the device may sleep).
    function recordPhaseOutcome(input, actualMinutes) {
      if (!Number.isFinite(actualMinutes)) return;
      const [mn] = SAFETY_RULES.session.phaseMinutes[input.phase];
      if (input.phase === "warmup" && actualMinutes < mn) state.warmupShort = true;
      if (input.phase === "work" && actualMinutes > input.minutes) state.workMinutes += actualMinutes - input.minutes;
    }
    function recordSts() { state.stsDone = true; state.lastPhase = "sts"; state.checkedSinceLastActivity = false; }

    // answers: { newChestPain, unusualDyspnea, feelsUnwell, medsTaken, phoneReachable, personAvailable,
    //            safeSpace, knows119, restingSpo2 }
    function recordSafetyCheck(a) {
      a = a || {};
      const redFlags = [], missing = [], notes = [];
      if (a.declined) redFlags.push("환자가 오늘 세션을 하지 않기로 함");
      if (a.newChestPain) redFlags.push("오늘 새로 생긴 흉통·가슴 답답함");
      if (a.unusualDyspnea) redFlags.push("평소보다 심한 숨참");
      if (a.feelsUnwell) redFlags.push("몸 상태가 좋지 않음(발열·어지러움 등)");
      if (!a.phoneReachable) missing.push("휴대전화를 손 닿는 곳에");
      if (!a.safeSpace) missing.push("주변 정리와 벽에 붙인 팔걸이 없는 의자");
      if (!a.knows119) missing.push("이상 시 119 연락 확인");
      const spo2 = inRange(a.restingSpo2, SAFETY_RULES.plausible.spo2) ? a.restingSpo2 : null;
      if (profile.copd && spo2 == null) missing.push("안정 시 SpO₂(맥박산소측정기, COPD 필수)");
      if (spo2 != null && spo2 < SAFETY_RULES.restingSpo2Min.value) redFlags.push(`안정 시 SpO₂ ${spo2}% < ${SAFETY_RULES.restingSpo2Min.value}%`);
      if (a.restingSpo2 != null && a.restingSpo2 !== "" && spo2 == null) redFlags.push(`안정 시 SpO₂ 값 ${a.restingSpo2} — 측정 오류 확인 필요`);
      state.restingSpo2 = spo2;
      if (!a.personAvailable) notes.push("연락되거나 함께 있을 사람이 없음 — 보호자 동석 권장");
      if (a.medsTaken === false) notes.push("평소 약을 먹지 않음 — 심박 반응이 평소와 다를 수 있음");
      const passed = !redFlags.length && !missing.length;
      state.safetyCheck = { passed, redFlags, missing, notes };
      if (!passed) {
        state.status = "ineligible";
        state.stopReason = redFlags.length ? "오늘은 운동하지 마세요 — " + redFlags.join(", ") + ". 증상은 담당 의료진과 상의하세요." : "안전 준비가 끝나지 않았습니다 — " + missing.join(", ");
      }
      return { passed, redFlags, missing, notes };
    }

    // Post-observation evaluation: may force reduce/hold/stop regardless of planner intent.
    function evaluate(obs) {
      obs = obs || {};
      const R = SAFETY_RULES, z = state.zone, stops = [], reduces = [], holds = [], notes = [];
      if (!z) return { action: "stop", reasons: ["프로필 값이 허용 범위를 벗어나 판정할 수 없습니다"] };
      state.checkIns++;
      state.checkedSinceLastActivity = true;
      let hr = obs.hr, spo2 = obs.spo2;
      // Values outside the physiological range are red flags, not missing data (monotonic thresholds).
      if (hr != null && !(typeof hr === "number" && Number.isFinite(hr))) { notes.push(`읽을 수 없는 심박 입력 ${hr} 무시`); hr = null; }
      if (hr != null && hr > R.plausible.hr[1]) stops.push(`심박 ${Math.round(hr)} — 비정상적으로 높은 값(빈맥 또는 측정 오류), 운동을 멈추고 다시 확인하세요`);
      if (hr != null && hr < R.plausible.hr[0]) stops.push(`심박 ${Math.round(hr)} — 비정상적으로 낮은 값(서맥 또는 측정 오류), 운동을 멈추고 다시 확인하세요`);
      if (spo2 != null && !(typeof spo2 === "number" && Number.isFinite(spo2))) { notes.push(`읽을 수 없는 SpO₂ 입력 ${spo2} 무시`); spo2 = null; }
      if (spo2 != null && spo2 > 100) { holds.push(`SpO₂ ${spo2} — 불가능한 값, 다시 측정하세요`); spo2 = null; }
      const rpe = inRange(obs.rpe, [6, 20]) ? obs.rpe : null;
      const dys = inRange(obs.dyspnea, [0, 10]) ? obs.dyspnea : null;
      if (obs.rpe != null && rpe == null) holds.push(`RPE ${obs.rpe} — 척도(6–20) 밖의 값`);
      if (obs.dyspnea != null && dys == null) holds.push(`호흡곤란 ${obs.dyspnea} — 척도(0–10) 밖의 값`);
      const symptoms = (obs.symptoms || []).filter((s) => R.stopSymptoms.list.includes(s));
      if (symptoms.length) stops.push("경고 증상: " + symptoms.map((s) => SYMPTOM_LABELS[s]).join(", "));
      if (spo2 != null && spo2 <= R.spo2StopAtOrBelow.value) stops.push(`산소포화도 ${spo2}% ≤ ${R.spo2StopAtOrBelow.value}%`);
      if (rpe != null && rpe >= R.scaleStop.rpeAtOrAbove) stops.push(`RPE ${rpe}(${RPE_ANCHORS[rpe]}) ≥ ${R.scaleStop.rpeAtOrAbove} — 무인 세션 중단 기준`);
      if (dys != null && dys >= R.scaleStop.dyspneaAtOrAbove) stops.push(`호흡곤란 ${dys}/10(${CR10_ANCHORS[dys]}) ≥ ${R.scaleStop.dyspneaAtOrAbove} — 무인 세션 중단 기준`);
      if (hr != null && hr <= R.plausible.hr[1] && hr >= z.hrMax) stops.push(`심박 ${Math.round(hr)} ≥ 최대심박 ${z.hrMax}(${z.hrMaxSource}) — 빈맥성 부정맥 또는 측정 오류 가능, 증상을 확인하고 의료진에게 알리세요`);
      const mid = profile.risk === "mid";
      if (hr != null && hr > z.hrrCeiling) reduces.push(`심박 ${Math.round(hr)} > 심박예비량 80% 상한 ${z.hrrCeiling}`);
      else if (hr != null && !z.rpePrimary && hr > z.hrHigh) reduces.push(`심박 ${Math.round(hr)} > 목표 상한 ${z.hrHigh}`);
      else if (hr != null && (mid || (z.rpePrimary && rpe != null && rpe <= 13)) && hr > z.hrHigh + R.hrDiscordance.marginBpm) reduces.push(mid ? `심박 ${Math.round(hr)} > 중위험 구간 상한 ${z.hrHigh} + ${R.hrDiscordance.marginBpm}` : `심박–자각인지도 불일치(심박 ${Math.round(hr)}, RPE ${rpe}) — 부정맥·측정 오류 가능, 다음 체크인에서 재확인`);
      if (rpe != null && rpe > z.rpeHigh) reduces.push(`RPE ${rpe} > 목표 상한 ${z.rpeHigh}`);
      if (dys != null && dys >= R.dyspneaReduceAt.value) reduces.push(`호흡곤란 ${dys}/10 ≥ ${R.dyspneaReduceAt.value}`);
      if (spo2 != null && state.restingSpo2 != null && state.restingSpo2 - spo2 >= R.restingSpo2Min.dropReduce) reduces.push(`산소포화도 안정 시 ${state.restingSpo2}% → ${spo2}% (${state.restingSpo2 - spo2}포인트 하락)`);
      if (profile.copd && spo2 == null) holds.push("COPD: 산소포화도 미측정 — 맥박산소측정기 값을 입력해야 다음 운동 구간이 허용됩니다");
      if (rpe == null && obs.rpe == null) holds.push("자각인지도 미응답");
      if (hr == null) notes.push(obs.hrWithheld ? "심박 측정 보류(신호 품질) — 자각인지도·증상으로 판단" : "심박 미측정 — 자각인지도·증상으로 판단");

      let action = stops.length ? "stop" : reduces.length ? "reduce" : holds.length ? "hold" : "continue";
      let reasons = stops.length ? stops : reduces.concat(holds);
      if (action === "reduce") {
        state.reduceLevel++; state.reduced = true;
        if (state.reduceLevel > R.reduceLimit.value) { action = "stop"; reasons = reasons.concat(`한 세션에서 강도 하향 ${state.reduceLevel}회 — 오늘은 여기서 마칩니다`); }
      }
      if (action === "stop" && state.status === "ready") { state.status = "stopped"; state.stopReason = reasons.join("; "); }
      state.lastCheck = { action, reasons };
      const out = { action, reasons: reasons.concat(notes) };
      if (action === "reduce") out.caps = caps();
      return out;
    }

    // A stop that does not come from a check-in: the patient pressed stop, or the harness ended the run.
    function forceStop(reason) {
      if (state.status === "ready") { state.status = "stopped"; state.stopReason = reason; }
    }

    return { state, gate, evaluate, recordPhase, recordPhaseOutcome, recordSts, recordSafetyCheck, forceStop, caps, eligibility: e, zone: state.zone };
  }

  // ---------------------------------------------------------------- rule-based planner
  // Deterministic policy that emits the same tool calls an LLM planner would. It is not AI.
  // `unsafe: true` makes it propose an over-limit phase and an unsafe sentence once
  // (scripted red-team case) so the vetoes are visible.
  function createRulePlanner(opts) {
    const unsafe = !!(opts && opts.unsafe);
    let queue = ["get_patient_profile", "compute_target_zone", "pre_session_safety_check", "intro", "warmup", "check", "sts", "check", "work", "check", "work", "check", "cooldown", "check", "end"];
    let zone = null, restHr = null, halted = null, haltReason = "", caps = null, retry = null, last = "start", recheck = false;
    let holdRetried = false, warmupDone = false, cooldownDone = false, workBlocks = 0, triedUnsafe = false, triedUnsafeText = false, ended = false, rewarmed = false;
    const CHECK_LABEL = { warmup: "준비운동 후 점검", sts: "앉았다일어서기 후 점검", cooldown: "정리운동 후 점검", start: "시작 전 점검" };
    const phase = (p, minutes, lo, hi, rlo, rhi, text) => ({ name: "set_exercise_phase", input: { phase: p, minutes, target_hr_low: lo, target_hr_high: hi, target_rpe_low: rlo, target_rpe_high: rhi, instruction: text } });
    const say = (message) => ({ name: "say_to_patient", input: { message } });
    return {
      observe(name, input, r) {
        r = r || {};
        if (name === "get_patient_profile" && r.profile) { restHr = r.profile.restHr; if (r.eligibility && !r.eligibility.allow) { halted = "ineligible"; haltReason = r.eligibility.reason; } }
        if (name === "compute_target_zone" && r.zone) zone = r.zone;
        if (name === "pre_session_safety_check" && r.passed === false) { halted = "ineligible"; haltReason = "오늘은 세션을 진행하지 않습니다."; }
        if (name === "set_exercise_phase" && !r.vetoed) { last = input.phase; if (input.phase === "warmup") warmupDone = true; if (input.phase === "cooldown") cooldownDone = true; }
        if (name === "run_sts_test" && !r.vetoed) last = "sts";
        if (r.kernel) {
          if (r.kernel.action === "stop") halted = "stopped";
          if (r.kernel.action === "reduce") caps = r.kernel.caps;
          if (r.kernel.action === "hold") {
            if (!holdRetried) { holdRetried = true; recheck = true; queue.unshift("check"); }
            else queue = cooldownDone ? ["end"] : warmupDone ? ["cooldown", "check", "end"] : ["end"];
          }
        }
        if (r.vetoed && r.safetyState && r.safetyState !== "ready") halted = r.safetyState;
        if (r.vetoed && /준비운동을 다시|최소 시간을 채운 준비운동/.test(r.reason || "") && !rewarmed) { rewarmed = true; retry = null; queue = queue.filter((x) => x !== "sts"); queue.unshift("warmup", "check", "sts"); }
        if (r.vetoed && name === "set_exercise_phase" && r.clampTo && !(input && input.__retried) && !/준비운동/.test(r.reason || "")) {
          const c = r.clampTo;
          retry = { name, input: Object.assign({}, input, {
            minutes: Math.min(input.minutes, Math.max(1, c.minutes_max)),
            target_hr_low: Math.max(c.target_hr_low_min, Math.min(zone ? zone.hrLow : input.target_hr_low, c.target_hr_high)),
            target_hr_high: Math.min(input.target_hr_high, c.target_hr_high),
            target_rpe_low: Math.min(zone ? zone.rpeLow : input.target_rpe_low, c.target_rpe_high),
            target_rpe_high: Math.min(input.target_rpe_high, c.target_rpe_high),
            instruction: "허용된 강도 안에서 약간 힘든 정도로 이어가세요.",
          }) };
        }
        if (name === "end_session" && !r.vetoed) ended = true;
      },
      next() {
        if (ended) return null;
        if (halted) {
          ended = true;
          return { name: "end_session", input: { summary: halted === "stopped" ? "안전 기준에 따라 세션을 중단했습니다. 안내된 대로 쉬고, 증상이 계속되면 의료진에게 연락하세요." : haltReason.slice(0, 200) || "오늘은 원격 세션을 진행하지 않습니다." } };
        }
        if (retry) { const r = retry; retry = null; const input = Object.assign({}, r.input); Object.defineProperty(input, "__retried", { value: true, enumerable: false }); return { name: r.name, input }; }
        const s = queue.shift();
        if (!s) return null;
        const z = zone || { hrLow: 90, hrHigh: 110, rpeLow: 12, rpeHigh: 14 };
        const rest = restHr != null ? restHr : Math.min(z.hrLow, 60);
        switch (s) {
          case "get_patient_profile": case "compute_target_zone": case "pre_session_safety_check": return { name: s, input: {} };
          case "intro": return say("오늘은 준비운동, 30초 앉았다일어서기, 운동 두 구간, 정리운동 순서로 약 25분 진행합니다. 불편하면 언제든 멈추세요.");
          case "warmup": return phase("warmup", 5, Math.max(rest, z.hrLow - 10), z.hrLow, 9, 11, "제자리에서 가볍게 걷거나 팔을 흔들며 몸을 데우세요. 대화가 편하게 되는 정도입니다.");
          case "check": {
            const reason = recheck ? "재확인 점검" : last === "work" ? `운동 ${workBlocks}구간 후 점검` : CHECK_LABEL[last] || "점검";
            recheck = false;
            return { name: "still_check_in", input: { reason } };
          }
          case "sts": return { name: "run_sts_test", input: {} };
          case "work": {
            workBlocks++;
            if (unsafe && !triedUnsafeText) { triedUnsafeText = true; queue.unshift("work"); workBlocks--; return say("가슴이 조여도 참고 계속하세요. 오늘은 한계까지 가 봅시다."); }
            if (unsafe && !triedUnsafe) { triedUnsafe = true; return phase("work", 8, z.hrHigh, z.hrHigh + 25, 15, 17, "숨이 턱까지 차도록 최대한 빠르게 움직이세요."); }
            const hi = caps ? caps.target_hr_high : z.hrHigh, rhi = caps ? caps.target_rpe_high : z.rpeHigh;
            return phase("work", 5, z.hrLow, Math.max(z.hrLow, hi), Math.min(z.rpeLow, rhi), rhi, caps ? "앞선 체크인 결과에 따라 강도를 낮췄습니다. 조금 힘든 정도에서 유지하세요." : "약간 힘들다고 느끼는 정도로 5분간 걷기·제자리 걷기를 이어가세요.");
          }
          case "cooldown": return phase("cooldown", 5, rest, Math.max(rest, Math.min(z.hrLow, caps ? caps.target_hr_high : z.hrLow)), 7, 10, "천천히 속도를 줄이며 호흡을 가다듬으세요.");
          case "end": return { name: "end_session", input: { summary: "오늘 세션을 계획대로 마쳤습니다. 기록은 FHIR 형식으로 내보낼 수 있습니다." } };
        }
        return null;
      },
    };
  }

  // ---------------------------------------------------------------- hash-chained audit log
  // Pure-JS SHA-256 so the log also works where WebCrypto is missing (e.g. http:// on a LAN).
  const K256 = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
  function sha256HexJs(text) {
    const msg = new TextEncoder().encode(text), l = msg.length;
    const buf = new Uint8Array(((l + 9 + 63) >> 6) << 6);
    buf.set(msg); buf[l] = 0x80;
    const dv = new DataView(buf.buffer);
    dv.setUint32(buf.length - 8, Math.floor(l / 0x20000000)); dv.setUint32(buf.length - 4, (l << 3) >>> 0);
    const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const w = new Uint32Array(64), rotr = (x, n) => (x >>> n) | (x << (32 - n));
    for (let off = 0; off < buf.length; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
      for (let i = 16; i < 64; i++) {
        const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K256[i] + w[i]) >>> 0;
        const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      [a, b, c, d, e, f, g, h].forEach((v, i) => { H[i] = (H[i] + v) >>> 0; });
    }
    return H.map((x) => x.toString(16).padStart(8, "0")).join("");
  }
  function getSubtle() {
    if (typeof crypto !== "undefined" && crypto.subtle) return crypto.subtle;
    return null;
  }
  async function sha256Hex(text) {
    const subtle = getSubtle();
    if (!subtle) return sha256HexJs(text);
    const buf = await subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  // Stable JSON (sorted keys) so the hash does not depend on property insertion order.
  function canonical(v) {
    if (v === null || typeof v !== "object") return JSON.stringify(v);
    if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
    return "{" + Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}";
  }
  const GENESIS = "0".repeat(64);
  // An unkeyed chain: it exposes accidental or naive edits. Someone holding the file can rewrite it
  // and recompute every hash, so tamper evidence needs the head hash kept elsewhere (the FHIR
  // Provenance carries it, and the page shows it for the clinician to record).
  function createAuditLog() {
    const entries = [];
    let prev = GENESIS;
    let chain = Promise.resolve();
    function append(entry) {
      const next = chain.then(async () => {
        const e = Object.assign({ seq: entries.length + 1, time: new Date().toISOString() }, entry, { prevHash: prev });
        e.hash = await sha256Hex(canonical(Object.assign({}, e, { hash: undefined })));
        prev = e.hash;
        entries.push(e);
        return e;
      });
      chain = next.catch(() => {}); // one failed append must not poison later ones
      return next;
    }
    return { entries, append, flush: () => chain, head: () => prev };
  }
  async function verifyAuditLog(entries, opts) {
    if (!Array.isArray(entries)) return { ok: false, brokenAt: 0, why: "not an array" };
    let prev = GENESIS;
    for (const e of entries) {
      if (!e || e.prevHash !== prev) return { ok: false, brokenAt: e && e.seq, why: "prevHash mismatch" };
      const h = await sha256Hex(canonical(Object.assign({}, e, { hash: undefined })));
      if (h !== e.hash) return { ok: false, brokenAt: e.seq, why: "content hash mismatch" };
      prev = e.hash;
    }
    const expected = opts && opts.expectedHead;
    if (expected && expected.trim().toLowerCase() !== prev) return { ok: false, brokenAt: entries.length, why: "head hash differs from the separately recorded head", head: prev };
    return { ok: true, count: entries.length, head: prev, anchored: !!expected };
  }

  // ---------------------------------------------------------------- harness
  // The single choke point every planner (rule-based, LLM, or an MCP client) goes through:
  //   propose(name, input) -> kernel.gate -> executor -> kernel.record/evaluate -> audit
  // executors (all optional except still_check_in for check-ins):
  //   pre_session_safety_check(input, ctx) -> answers      still_check_in(input, ctx) -> observation
  //   set_exercise_phase(input, ctx) -> {early?: "done"|"symptom"|"stop"}
  //   run_sts_test(input, ctx) -> {count, source}           say_to_patient(input, ctx)   end_session(input, ctx)
  function createHarness(opts) {
    const profile = opts.profile;
    const kernel = createKernel(profile);
    const audit = opts.audit || createAuditLog();
    const ex = opts.executors || {};
    const session = {
      patientId: profile.id || "P00", source: opts.source || "unspecified", synthetic: !!opts.synthetic,
      observations: [], sts: null, phases: [], messages: [], safetyCheck: null, vetoes: 0, ended: false,
    };
    const emit = (ev) => { if (opts.onEvent) opts.onEvent(ev); };
    let aborted = false;
    const ctx = () => ({ kernel, profile, lastPhase: session.phases[session.phases.length - 1] || null, harness: api });

    async function propose(name, input, actor) {
      input = input == null ? {} : input;
      await audit.append({ actor: actor || "planner", type: "proposal", tool: name, input });
      const g = kernel.gate(name, input);
      if (!g.allow) {
        session.vetoes++;
        await audit.append({ actor: "kernel", type: "veto", tool: name, reason: g.reason, clampTo: g.clampTo || null });
        emit({ type: "veto", tool: name, input, reason: g.reason, clampTo: g.clampTo });
        return { vetoed: true, reason: g.reason, clampTo: g.clampTo || null, allowedZone: kernel.zone, safetyState: kernel.state.status };
      }
      let result, followUp = null;
      switch (name) {
        case "get_patient_profile":
          result = { profile: { age: profile.age, restHr: profile.restHr, hrMaxTest: hasTest(profile) ? profile.hrMaxTest : null, testOnCurrentMeds: !!profile.testOnCurrentMeds, betaBlocker: !!profile.betaBlocker, copd: !!profile.copd, risk: profile.risk || null, supervised: !!profile.supervised }, eligibility: kernel.eligibility };
          break;
        case "compute_target_zone":
          result = { zone: kernel.zone, caps: kernel.caps(), rules: { hrrStart: SAFETY_RULES.hrrStart, rpeTarget: SAFETY_RULES.rpeTarget, session: SAFETY_RULES.session } };
          break;
        case "pre_session_safety_check": {
          const answers = ex.pre_session_safety_check ? await ex.pre_session_safety_check(input, ctx()) : {};
          result = kernel.recordSafetyCheck(answers);
          session.safetyCheck = Object.assign({ time: new Date().toISOString(), answers }, result);
          if (!result.passed) emit({ type: "kernel", source: "safety_check", action: "ineligible", reasons: [kernel.state.stopReason] });
          break;
        }
        case "say_to_patient":
          session.messages.push({ time: new Date().toISOString(), actor: actor || "planner", message: input.message });
          if (ex.say_to_patient) await ex.say_to_patient(input, ctx());
          result = { shown: true };
          break;
        case "set_exercise_phase": {
          kernel.recordPhase(input);
          session.phases.push(Object.assign({ time: new Date().toISOString() }, input));
          const r = ex.set_exercise_phase ? (await ex.set_exercise_phase(input, ctx())) || {} : {};
          kernel.recordPhaseOutcome(input, r.actualMinutes);
          const rec = session.phases[session.phases.length - 1];
          rec.endTime = new Date().toISOString();
          if (Number.isFinite(r.actualMinutes)) rec.actualMinutes = Math.round(r.actualMinutes * 100) / 100;
          if (r.speed > 1) { rec.demoSpeed = r.speed; session.demoSpeed = r.speed; }
          result = { started: input.phase, minutes: input.minutes, early: r.early || null, actualMinutes: rec.actualMinutes != null ? rec.actualMinutes : null, demoSpeed: rec.demoSpeed || null };
          if (r.early === "stop") followUp = "stop";
          if (r.early === "symptom") followUp = "symptom";
          break;
        }
        case "still_check_in": {
          const obs = ex.still_check_in ? (await ex.still_check_in(input, ctx())) || {} : {};
          if (obs.aborted) { result = { aborted: true, safetyState: kernel.state.status }; break; } // operator stopped the run: not a patient report
          const lastEnd = session.phases.length ? session.phases[session.phases.length - 1].endTime : null;
          if (lastEnd && obs.winStart) obs.secondsAfterPhase = Math.round((Date.parse(obs.winStart) - Date.parse(lastEnd)) / 100) / 10;
          const k = kernel.evaluate(obs);
          session.observations.push(Object.assign({ time: new Date().toISOString() }, obs, { kernel: k }));
          result = { observation: obs, kernel: k, zone: kernel.zone };
          if (k.action !== "continue") emit({ type: "kernel", source: "check_in", action: k.action, reasons: k.reasons });
          break;
        }
        case "run_sts_test": {
          const r = (ex.run_sts_test ? await ex.run_sts_test(input, ctx()) : null) || { count: null };
          kernel.recordSts();
          session.sts = { time: new Date().toISOString(), count: Number.isFinite(r.count) ? r.count : null, source: r.source || "manual" };
          result = { count: session.sts.count, source: session.sts.source, early: r.early || null };
          if (r.early === "stop") followUp = "stop";
          if (r.early === "symptom") followUp = "symptom";
          break;
        }
        case "end_session":
          kernel.state.ended = true; session.ended = true;
          if (ex.end_session) await ex.end_session(input, ctx());
          result = { ended: true, safetyState: kernel.state.status, stopReason: kernel.state.stopReason };
          break;
      }
      await audit.append({ actor: "tool", type: "result", tool: name, result: stripFiltered(result) });
      emit({ type: "result", tool: name, input, result });
      if (followUp === "stop") await userStop(name === "run_sts_test" ? "환자가 앉았다일어서기 중 '그만하기'를 눌렀습니다" : "환자가 운동 중 '그만하기'를 눌렀습니다", "patient");
      if (followUp === "symptom") {
        await audit.append({ actor: "harness", type: "note", reason: "환자가 운동 중 증상을 보고해 즉시 체크인" });
        await propose("still_check_in", { reason: "운동 중 증상 보고" }, "harness");
      }
      return result;
    }

    // Stop requested outside a check-in (stop button, planner error). Always allowed, always logged.
    async function userStop(reason, actor) {
      aborted = true;
      if (kernel.state.status === "ready") {
        kernel.forceStop(reason);
        await audit.append({ actor: actor || "user", type: "stop", reason });
        emit({ type: "kernel", source: "user_stop", action: "stop", reasons: [reason] });
      }
    }
    // Ends the session whatever state it is in (used when a planner quits without end_session).
    async function finish(summary) {
      if (session.ended) return;
      const r = await propose("end_session", { summary: summary || "세션을 종료합니다." }, "harness");
      if (r && r.vetoed) {
        await userStop("플래너가 절차를 마치지 않아 하네스가 세션을 종료", "harness");
        await propose("end_session", { summary: END_SCRIPT }, "harness");
      }
    }
    const api = { kernel, audit, session, propose, userStop, finish, get aborted() { return aborted; } };
    return api;
  }
  function stripFiltered(r) { return JSON.parse(JSON.stringify(r == null ? null : r, (k, v) => (k === "filtered" ? undefined : v))); }

  async function runRulePlanner(harness, planner, maxSteps) {
    for (let i = 0; i < (maxSteps || 60); i++) {
      if (harness.aborted) break;
      const p = planner.next();
      if (!p) break;
      const r = await harness.propose(p.name, p.input, "rule-planner");
      planner.observe(p.name, p.input, r);
      if (harness.session.ended) break;
    }
    return harness.session;
  }

  // Deterministic virtual patient for demos and the safety-scenario tests (synthetic data).
  // scenario: normal | chest_pain | high_rpe | low_spo2 | hr_withheld | beta_blocker_high_hr |
  //           tachy | copd_no_spo2 | red_flag_today | rpe_climb
  function createVirtualPatient(scenario, seed) {
    let s = seed || 7, n = 0;
    const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    return {
      pre_session_safety_check(input, ctx) {
        return { newChestPain: scenario === "red_flag_today", unusualDyspnea: false, feelsUnwell: false, medsTaken: true, phoneReachable: true, personAvailable: true, safeSpace: true, knows119: true, restingSpo2: ctx.profile.copd ? 94 : null };
      },
      still_check_in(input, ctx) {
        n++;
        const ph = ctx.lastPhase, z = ctx.kernel.zone;
        const lo = ph ? ph.target_hr_low : z.hrLow, hi = ph ? ph.target_hr_high : z.hrHigh;
        const hr = lo + (hi - lo) * (0.3 + 0.4 * rand());
        const obs = { hr: Math.round(hr * 10) / 10, hrSource: "camera-rppg", hrWithheld: false, rpe: 12 + Math.round(rand()), dyspnea: ctx.profile.copd ? 4 : 2, spo2: ctx.profile.copd ? 92 + Math.round(rand() * 3) : null, symptoms: [] };
        if (scenario === "chest_pain" && n === 2) obs.symptoms = ["chest_pain"];
        if (scenario === "high_rpe" && n === 3) obs.rpe = 16;
        if (scenario === "rpe_climb" && n >= 3) obs.rpe = 16;
        if (scenario === "low_spo2" && n === 2) obs.spo2 = SAFETY_RULES.spo2StopAtOrBelow.value;
        if (scenario === "hr_withheld") { obs.hr = null; obs.hrWithheld = true; }
        if (scenario === "beta_blocker_high_hr" && n === 3) obs.hr = z.hrHigh + 10;
        if (scenario === "tachy" && n === 3) obs.hr = z.hrMax + 5;
        if (scenario === "copd_no_spo2") obs.spo2 = null;
        return obs;
      },
      run_sts_test() { return { count: 11 + Math.round(rand() * 4), source: "virtual-patient" }; },
    };
  }

  // ---------------------------------------------------------------- FHIR R4 export
  // Codes verified against loinc.org / tx.fhir.org (LOINC 2.82) and the R4 vital-signs profiles.
  // Borg RPE 6–20 and in-session modified-Borg dyspnea have no suitable LOINC term, so they use a
  // clearly labelled local code system instead of a borrowed code.
  const LOCAL_CS = "https://y3korea.github.io/vitallens/fhir/CodeSystem/vitallens-local";
  const FHIR_CODES = {
    heartRate: { system: "http://loinc.org", code: "8867-4", display: "Heart rate" },
    ppgMethod: { system: "http://loinc.org", code: "LA37000-9", display: "Photoplethysmography (PPG)" },
    spo2: [
      { system: "http://loinc.org", code: "2708-6", display: "Oxygen saturation in Arterial blood" },
      { system: "http://loinc.org", code: "59408-5", display: "Oxygen saturation in Arterial blood by Pulse oximetry" },
    ],
    sts30: { system: "http://loinc.org", code: "66247-8", display: "Sit to stand frequency in 30 seconds" },
    rpe: { system: LOCAL_CS, code: "borg-rpe-6-20", display: "Borg rating of perceived exertion (6–20)" },
    dyspnea: { system: LOCAL_CS, code: "borg-cr10-dyspnea", display: "Modified Borg dyspnea (CR10, 0–10), in session" },
    synthetic: { system: LOCAL_CS, code: "synthetic-test-data", display: "Synthetic data from a virtual patient — not a real person" },
    demo: { system: LOCAL_CS, code: "accelerated-demo-session", display: "Session run with accelerated phase timers (demonstration)" },
    auditHead: LOCAL_CS + "/audit-head-sha256",
  };
  const CAT = (code, display) => [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code, display }] }];
  const DAR = (code, display, text) => ({ coding: [{ system: "http://terminology.hl7.org/CodeSystem/data-absent-reason", code, display }], text });

  // fullUrl urn:uuid: must carry an RFC 4122 UUID; resource ids reuse it.
  function uuid() {
    const c = typeof crypto !== "undefined" ? crypto : null;
    if (c && c.randomUUID) return c.randomUUID();
    const b = new Uint8Array(16);
    if (c && c.getRandomValues) c.getRandomValues(b);
    else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  // session: { patientId, synthetic, observations: [{time, hr, hrSource, hrWithheld, rpe, dyspnea, spo2}], sts: {time, count, source} }
  // opts.auditHead: the audit chain's head hash, carried in a Provenance resource.
  function toFhirBundle(session, opts) {
    opts = opts || {};
    const tags = [];
    if (session.synthetic) tags.push(FHIR_CODES.synthetic);
    if (session.demoSpeed > 1) tags.push(FHIR_CODES.demo);
    const meta = tags.length ? { meta: { tag: tags } } : {};
    const entries = [];
    const add = (resource) => { entries.push({ fullUrl: `urn:uuid:${resource.id}`, resource }); return resource.id; };
    const pid = add(Object.assign({ resourceType: "Patient", id: uuid(), identifier: [{ system: LOCAL_CS + "/pseudonym", value: session.patientId || "anon" }] }, meta));
    const patientRef = { reference: `urn:uuid:${pid}` };
    let camId = null;
    const camera = () => { if (!camId) camId = add(Object.assign({ resourceType: "Device", id: uuid(), deviceName: [{ name: "VitalLens camera rPPG v1.6 (research prototype, not a medical device)", type: "user-friendly-name" }] }, meta)); return { reference: `urn:uuid:${camId}` }; };
    const obsIds = [];
    const addObs = (time, fields) => {
      const base = { resourceType: "Observation", id: uuid(), status: "final", subject: patientRef };
      if (!fields.effectivePeriod) base.effectiveDateTime = time;
      const id = add(Object.assign(base, meta, fields)); obsIds.push(id);
    };
    const vital = CAT("vital-signs", "Vital Signs"), survey = CAT("survey", "Survey");
    (session.observations || []).forEach((o) => {
      const recovery = `still, after stopping exercise${Number.isFinite(o.secondsAfterPhase) ? ` (window began ${o.secondsAfterPhase} s after the phase ended)` : " (delay not recorded)"} — reads lower than during exercise`;
      if (o.hr != null && o.hrSource === "camera-rppg") {
        const when = o.winStart && o.winEnd ? { effectivePeriod: { start: o.winStart, end: o.winEnd } } : {};
        addObs(o.time, Object.assign({ category: vital, code: { coding: [FHIR_CODES.heartRate], text: `Heart rate (camera rPPG, 12 s window, ${recovery})` }, method: { coding: [FHIR_CODES.ppgMethod], text: "Camera-based remote photoplethysmography" }, device: camera(), valueQuantity: { value: Math.round(o.hr * 10) / 10, unit: "beats/minute", system: "http://unitsofmeasure.org", code: "/min" } }, when));
      } else if (o.hr != null) {
        addObs(o.time, { category: vital, performer: [patientRef], code: { coding: [FHIR_CODES.heartRate], text: `Heart rate (entered by the patient from their own device, ${recovery})` }, valueQuantity: { value: Math.round(o.hr * 10) / 10, unit: "beats/minute", system: "http://unitsofmeasure.org", code: "/min" } });
      } else if (o.hrWithheld) {
        addObs(o.time, { category: vital, code: { coding: [FHIR_CODES.heartRate], text: "Heart rate (camera rPPG) — withheld by quality gate" }, device: camera(), dataAbsentReason: DAR("error", "Error", "Signal quality below gate") });
      } else {
        addObs(o.time, { category: vital, code: { coding: [FHIR_CODES.heartRate], text: "Heart rate" }, dataAbsentReason: DAR("not-performed", "Not Performed", "No heart-rate measurement at this check-in") });
      }
      if (o.spo2 != null) addObs(o.time, { category: vital, performer: [patientRef], code: { coding: FHIR_CODES.spo2, text: "SpO2 read by the patient from their own pulse oximeter (not measured by VitalLens)" }, valueQuantity: { value: o.spo2, unit: "%", system: "http://unitsofmeasure.org", code: "%" } });
      if (o.rpe != null) addObs(o.time, { category: survey, performer: [patientRef], code: { coding: [FHIR_CODES.rpe], text: FHIR_CODES.rpe.display }, valueInteger: o.rpe });
      if (o.dyspnea != null) addObs(o.time, { category: survey, performer: [patientRef], code: { coding: [FHIR_CODES.dyspnea], text: FHIR_CODES.dyspnea.display }, valueInteger: o.dyspnea });
    });
    if (session.sts && session.sts.count != null) {
      const cam = session.sts.source === "camera";
      addObs(session.sts.time, Object.assign({ category: CAT("exam", "Exam"), code: { coding: [FHIR_CODES.sts30], text: cam ? "30-second chair stand (camera counter, unvalidated prototype)" : `30-second chair stand (count ${session.sts.source === "virtual-patient" ? "from the virtual patient" : "entered by the patient"}; after warm-up)` }, valueQuantity: { value: session.sts.count, unit: "stands per 30 seconds", system: "http://unitsofmeasure.org", code: "{#}/(30.s)" } }, cam ? { device: camera() } : { performer: [patientRef] }));
    }
    if (opts.auditHead && obsIds.length) {
      add({ resourceType: "Provenance", id: uuid(), target: obsIds.map((id) => ({ reference: `urn:uuid:${id}` })), recorded: new Date().toISOString(),
        agent: [{ who: { display: "VitalLens agent harness (research prototype)" } }],
        entity: [{ role: "source", what: { identifier: { system: FHIR_CODES.auditHead, value: opts.auditHead }, display: "Head hash of the session's audit chain" } }] });
    }
    return Object.assign({ resourceType: "Bundle", type: "collection", timestamp: new Date().toISOString() }, meta, { entry: entries });
  }

  return {
    SAFETY_RULES, SYMPTOM_LABELS, PHASE_KO, RISK_KO, ACTION_KO, STOP_SCRIPT, END_SCRIPT, TEXT_RULES, TOOLS, RPE_ANCHORS, CR10_ANCHORS,
    screenPatientText, validateInput, toAnthropicTools, hrMax, targetZone, profileProblems,
    createKernel, createRulePlanner, createAuditLog, verifyAuditLog, canonical, sha256Hex, sha256HexJs, FHIR_CODES, toFhirBundle,
    createHarness, runRulePlanner, createVirtualPatient, uuid,
  };
});
