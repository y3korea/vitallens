# A Browser-Based Camera Heart-Rate Monitor With a Guideline-Based Deterministic Safety Kernel for Home Cardiopulmonary Telerehabilitation: Development and Simulation Validation Study

> **Status:** First full draft (English). Author names, affiliations, ORCIDs, degrees, funding, and contact details are completed. Two guideline bibliographic details remain to verify. References are numbered in AMA order of first appearance and were verified against Crossref on 2026-10-07. A short "citation verification checklist" is appended at the end of the file.

---

**Manuscript type:** Original Paper

**Authors:** Taeseok Choi, PT, PhD¹; Seoyoon Heo, OT, PhD²; Yusung Jang, PT, PhD³; Wansuk Choi, PT, PhD⁴

¹ Department of Physical Therapy, Kunjang University College, Gunsan, Republic of Korea
² Department of Occupational Therapy, College of Health Sciences, Kyungbok University, Namyangju, Republic of Korea
³ Department of Physical Therapy, Changshin University, Changwon, Republic of Korea
⁴ Department of Physical Therapy, College of Health Sciences, Kyungwoon University, Gumi, Republic of Korea

**Corresponding Author:**
Wansuk Choi, PT, PhD
Department of Physical Therapy, College of Health Sciences, Kyungwoon University
730 Gangdong-ro, Sandong-myeon, Gumi-si, Gyeongsangbuk-do, Republic of Korea
Email: wschoi@ikw.ac.kr

**Keywords:** remote photoplethysmography; telerehabilitation; cardiac rehabilitation; pulmonary rehabilitation; heart rate; artificial intelligence; safety; mobile health

**Word count (main text):** [AUTHOR: fill after final edits]

---

## Abstract

**Background:** Home-based cardiopulmonary telerehabilitation improves program completion and is noninferior to center-based programs, but it still depends on dedicated heart-rate (HR) hardware, and the growing use of large language models (LLMs) for exercise recommendation introduces new safety risks: 14 of 24 (58%) published studies using LLMs for exercise recommendation reported safety defects such as contraindicated exercise. Consumer cameras can measure HR by remote photoplethysmography (rPPG), but camera HR during exercise is corrupted by periodic motion, and there is no established mechanism that lets a non-expert exercise at home with camera-derived vital signs while bounding what an LLM planner may say or do.

**Objective:** We developed and validated VitalLens, a browser-based research prototype that (1) estimates resting/still HR from an ordinary webcam using rPPG with a spectral quality gate, and (2) wraps the session in a deterministic, guideline-derived safety kernel with veto power over every tool call and every patient-facing sentence proposed by a rule-based or LLM planner. This manuscript reports the system design and its algorithm and safety-kernel validation performed on synthetic signals and scripted scenarios.

**Methods:** The rPPG pipeline captures a 320×240 stream at 20 Hz, averages a fixed region of interest, resamples to a strict 12-second time window, applies a zero-phase 4th-order Butterworth band-pass filter (0.67–3.0 Hz), and estimates HR from the spectral peak. A spectral signal-to-noise ratio (SNR) gate holds the reading ("measurement withheld") below a threshold selected by cross-validation. The safety kernel encodes 30+ numeric rules with their guideline sources (EAPC 2020, AHA 2013, ATS/ERS 2013, ATS 2020, ESC 2020) and gating checks for tool schema, session order, intensity ranges, and patient-facing text. Algorithm validation used 6,600 synthetic PPG signals (11 HR × 5 SNR × 3 disturbance scenarios × 40 trials) with 5-fold cross-validation and independent-seed replication. Kernel validation used 19 safety scenarios, 6 scripted adversarial proposals, 222 exhaustive patient profiles, 6 conformance checks, and an MCP protocol check, all run automatically.

**Results:** The first algorithm version (time-domain peak counting) always emitted a value and was correct on 27.8% of signals (wrong on 72.2%), miscounting the diastolic wave at low HR. The v1.6 spectral method with a 2-dB quality gate emitted a value on 56.7% of signals, was correct on 52.0%, wrong on 4.7% (8.2% of displayed values), and withheld 43.3%; mean absolute error among displayed values was 3.9 bpm (91.8% of displayed values within ±5 bpm). The wrong-output reduction was achieved mostly by withholding rather than by answering. Under in-band periodic motion the camera estimate is unreliable (wrong-output rate 13.8% for the green channel), which is why HR is only measured during still check-ins; still-check-in HR reads 2.3–8.5 bpm below the true stop-moment HR because of early recovery. All safety-kernel, adversarial, exhaustive-profile, format, and MCP checks passed automatically.

**Conclusions:** VitalLens demonstrates that a consumer camera plus a deterministic, guideline-derived safety kernel can support a home cardiopulmonary session in which an LLM may coach but cannot overprescribe intensity, minimize symptoms, or give medication advice. The prototype is not a medical device, has not been validated on human participants, and its simulation results do not substitute for real-world validation against a reference device under institutional review board oversight.

**Registration:** Not applicable (no human participants).

---

## Introduction

Cardiac and pulmonary rehabilitation are among the strongest evidence bases in rehabilitation medicine, yet completion and uptake remain low for structural rather than efficacy reasons [1]. Center-based programs require 2–3 weekly visits over 8–12 weeks, a design that concentrates dropout at every step from referral through completion, especially for patients facing distance, transport, work, or dyspnea. Home-based (remote) delivery addresses this: a Cochrane review of primary telerehabilitation versus center-based pulmonary rehabilitation (3 randomized controlled trials, 516 participants) reported completion of 93% versus 70% (odds ratio 5.36, 95% CI 3.12–9.21) [1]. Home-based cardiac rehabilitation delivered by mobile health is noninferior to center-based care, with a 6-minute walk distance (6MWT) mean difference of +24.74 m (95% CI 9.88–39.60) [2], and remote pulmonary rehabilitation is comparable to center-based (6MWT mean difference −5.37 m, 95% CI −15.68 to 4.95) [3]. However, the safety literature cautions against generalizing these findings to unattended sessions: in one systematic review, adverse events occurred in 0.31% of 65,352 sessions, but 92% of the included studies used human-delivered safety measures such as vital-sign monitoring and safety checklists [4], and a separate scoping review found the most adverse events (including angina and syncope) in cardiac rehabilitation studies [5]. For context, a 25-m improvement in 6MWT is the accepted minimal clinically important difference in cardiac rehabilitation [6].

Two further problems motivate this work. First, remote delivery does not remove cost but shifts it. In an Australian equivalence trial of chronic respiratory disease, per-person program cost moved from the patient to the health system when care went remote (patient burden A$1,298 center vs A$554 remote; health-system burden A$529 vs A$1,601), so sustaining remote care requires lowering provider-side cost, and passing device purchases to the patient erodes the very access benefit remote care was meant to create [7]. A heart-rate monitor that requires no dedicated hardware is therefore attractive. Second, LLMs are increasingly used to generate exercise recommendations, and this creates a distinct safety risk: a 2026 review found that 14 of 24 (58%) studies applying LLMs to exercise recommendation reported safety defects such as contraindicated exercise [8]. The field is already scaling remote delivery: a randomized trial of telerehabilitation in post-discharge COVID-19 patients improved the 6-minute walk distance [9], meta-analyses support telerehabilitation effectiveness during the pandemic [10], a multicenter randomized controlled trial of a digital therapeutic for pulmonary rehabilitation has been reported [11], and South Korea's temporary telemedicine policy demonstrated chronic-disease management at national scale [12].

VitalLens is a research prototype that addresses these two problems together. It uses a consumer camera and remote photoplethysmography (rPPG) to estimate HR at rest and during brief still check-ins (removing the dedicated HR device) and it bounds an AI coach with a deterministic, guideline-derived safety kernel that has veto power over every tool call and every sentence shown to the patient. The kernel is exposed as a standard Model Context Protocol (MCP) server so that third parties can reproduce its rejections. This paper reports the system design and the validation performed to date, which is limited to synthetic-signal algorithm validation and scripted safety-kernel validation; real-world validation against a reference device under institutional review board (IRB) oversight is described as a protocol and is not yet performed. The prototype is explicitly not a medical device and is not intended for diagnosis or treatment decisions.

### Objectives

1. To describe the design of a browser-based rPPG HR estimator whose quality gate withholds readings when signal quality is insufficient rather than fabricating a value.
2. To describe a deterministic, guideline-derived safety kernel with veto power over a rule-based or LLM planner, including its tools, rules, and audit trail.
3. To report simulation-based algorithm validation (accuracy, withholding behavior, sensitivity, and recovery-period bias) and automated safety-kernel validation.

---

## Methods

### Overview and Design Principles

VitalLens is a static browser application (no server; client-side JavaScript) with a 3-layer architecture following the patient-side measurement / communication / platform framework for remote cardiopulmonary rehabilitation. Three design decisions distinguish it from adjacent work:

1. **No additional device for HR.** HR is estimated from an existing webcam by rPPG. The camera measures *only* still HR; it does not measure oxygen saturation (SpO₂), respiratory rate, or ECG rhythm. A pulse oximeter remains required for chronic obstructive pulmonary disease (COPD)/hypoxemia (enforced by the kernel) and recommended for cardiac rehabilitation.
2. **Small-space functional assessment.** Instead of a course-based 6MWT, a 30-second sit-to-stand (STS) test [13] is used per session under standardized conditions, with results exported as HL7 FHIR R4.
3. **A safety boundary around the agent.** The planner (rule-based, an LLM, or an MCP client) acts only through tools, and the only channel for patient-facing text is also a tool; a deterministic kernel screens every proposal (schema, order, range, text) and every check-in observation, and can reject a proposal or stop the session.

### rPPG Heart-Rate Pipeline (v1.6)

The pipeline is a single implementation shared by the browser and the Node.js test harness. **(1) Frame capture and region-of-interest (ROI) averaging:** `getUserMedia` acquires a 320×240 stream drawn to a canvas at 20 Hz; the mean red, green, and blue (RGB) values of a fixed central rectangle (36% width × 50% height) are recorded. No face detector is used; the user aligns their face to an on-screen guide. The green channel, which carries the strongest pulsatile signal [14], is the default for estimation. Blind source separation by independent component analysis was an early rPPG approach [15], and open-source rPPG implementations with practical apparatus and algorithms are available [16]. **(2) Twelve-second time window and uniform resampling:** samples are trimmed by *time* (not count) to keep the most recent 12 seconds, and browser-timer jitter is removed by linear interpolation onto an exact 20-Hz grid using real timestamps. No value is emitted until the window is full. **(3) Zero-phase band-pass filter:** a 4th-order Butterworth high-pass + low-pass (0.67–3.0 Hz, i.e., 40–180 bpm) is applied forward and backward to remove respiratory baseline wander (~0.25 Hz) and high-frequency noise without phase distortion. **(4) Spectral estimation and quality gate:** a Hann window is applied, the spectrum is computed at 0.01-Hz (0.6 bpm) resolution, and the largest peak is taken as HR. A spectral SNR metric (a modification of the chrominance-based accuracy indicator of de Haan and Jeanne [17]) compares energy around the candidate peak and its in-band harmonics against the rest of the band; if it falls below a threshold, the reading is withheld ("measurement withheld"). This SNR indicates how distinct the peak is, not whether it is correct, and it does not reject periodic in-band motion. The 2-dB threshold was selected by cross-validation as the value maximizing "correct − 3 × wrong" (a design weighting in which one wrong answer costs as much as four withholdings). A chrominance-based method, POS [18], is implemented in parallel; on synthetic data its ranking relative to the green channel reverses with the noise model, so green remains the default and the real-world measurement tool records both methods from the same frames for later adjudication.

The first version (v1) used time-domain peak counting, which always emitted a value and, under the diastolic-wave morphology of the synthetic model, double-counted the diastolic peak at resting HR 50–60 bpm (a range common in beta-blocker users). v1.6 replaces it with spectral estimation plus the quality gate.

### Intensity Prescription and the Safety Kernel

**Target zones.** When a maximal exercise test HR (HRmax) is available, the primary target is the heart-rate-reserve (HRR) band computed by the Karvonen formula. RPE (Borg 6–20 [19]) is forced to be the primary criterion when (a) no tested HRmax exists, (b) the patient takes a beta-blocker without an on-medication exercise test, or (c) the patient has COPD/hypoxemia; for COPD the modified-Borg dyspnea target (4–6/10) is used in parallel [20]. Predicted HRmax (220 − age) carries an error of ±12 bpm [21] and is therefore not used as the primary criterion in the absence of a tested HRmax; ESC 2020 similarly advises against predictive formulas in cardiac patients [22].

**Rules with sources.** All numeric rules live in one code location (`SAFETY_RULES`), each carrying its source. Guideline-derived values come from EAPC 2020 [23], AHA 2013 [21], ATS/ERS 2013 [20], ATS 2020 [24], and ESC 2020 [22]; values explicitly marked "design choice" are VitalLens's own conservative rules rather than guideline cut-offs (Table 1). Key rules include: target HRR 40–59% (supervised mid-risk sessions 40–49%); stop HR at or above HRmax or sustained tachyarrhythmia; reduce when RPE exceeds 14 in unsupervised sessions; stop at RPE ≥17 or modified-Borg dyspnea ≥8; stop at SpO₂ ≤88%; reduce on a ≥4-point SpO₂ fall from resting; refuse an unsupervised session when resting SpO₂ <92%; require a pulse-oximeter value for every check-in in COPD and hold the next work block without it; and reduce-and-recheck when HR exceeds the ceiling by more than 15 bpm while RPE ≤13 (suggesting arrhythmia or measurement error).

**Tools.** The planner can act only through eight tools (Table 2): `get_patient_profile`, `compute_target_zone`, `pre_session_safety_check`, `say_to_patient`, `set_exercise_phase`, `still_check_in`, `run_sts_test`, and `end_session`. `say_to_patient` is the sole channel for coaching text; text written by a model outside a tool is never shown to the patient (it is recorded only as a model note in the audit log).

**Pre- and post-gating.** Before any exercise phase, the kernel requires a passed pre-session safety check (today's symptoms, phone/space/emergency-plan, usual medication, and, for COPD, resting SpO₂) and risk stratification in line with home-based cardiac rehabilitation guidance [25] (high-risk patients cannot open a remote session; mid-risk patients require clinician approval and real-time video supervision). After each still check-in, the kernel re-evaluates the observation and returns continue, reduce, hold, or stop, independently of what the planner proposes next. The kernel cannot be overridden by the planner.

**Patient-facing text screen.** `say_to_patient`, phase instructions, and the end summary pass a deterministic sentence-level screen (≤200 characters; blocks intensity escalation, symptom minimization, "do not stop" phrasing, and any medication or diagnosis advice; safety directives that tell the patient to stop, rest, or call for help are permitted). This is a pattern-based screen, not a classifier, and it targets only the failure modes reported in the literature [8].

**Audit and export.** Every proposal, judgment, observation, and model note is written to a hash-chained audit log (each entry contains the SHA-256 of the previous entry), which exposes accidental alteration and simple editing; the head hash is kept separately and also embedded in the FHIR `Provenance` resource. Session records are exported as an HL7 FHIR R4 bundle: camera-derived HR is coded as LOINC 8867-4 with a PPG method/device qualifier, directly entered values and SpO₂/RPE/dyspnea are recorded as patient-reported, and STS as LOINC 66247-8; Borg RPE and modified-Borg dyspnea have no suitable LOINC code and use VitalLens local codes. Synthetic virtual-patient records are tagged as synthetic.

**MCP exposure.** The same tools, kernel, and audit log are exposed through a standard stdio MCP server (`node mcp/server.js`) with a simulated (virtual) patient, so that an MCP client such as Claude Code [26] can drive a session and observe kernel rejections directly. No camera or real person is connected.

### Algorithm Validation Methods (Simulation)

**Synthetic signal model.** The simulator generates an RGB skin-ROI signal (DC 144/106/86) with a pulse following the blood-volume-pulse signature [0.33, 0.77, 0.53], a two-Gaussian PPG morphology (diastolic wave 45% of systolic, 0.30·IBI later), HRV (3% SDNN + 0.25-Hz respiratory sinus arrhythmia), respiratory baseline wander, an illumination random walk, per-channel white sensor noise at a stated input SNR, and browser-timer jitter. Three disturbance scenarios were used: (a) rest (white noise only), (b) in-band periodic motion at 0.8–2.5 Hz with root-mean-square amplitude equal to the green pulse (a condition deliberately weaker than real exercise motion), and (c) a single illumination step of 5× pulse amplitude (~2.5% of brightness). The 12-second time-trimmed window matches the browser.

**Grid and metrics.** The grid was 11 HR levels (50–150 bpm) × 5 input SNRs (10 to −10 dB) × 3 scenarios × 40 trials = 6,600 signals. Estimation was performed by three methods: v1 (peak counting), v1.6 green (spectral + gate), and POS. Outcomes were output rate (fraction emitted), correct rate, wrong rate (correct = within ±5 bpm of true HR), mean absolute error (MAE), and the fraction of displayed values within ±5 bpm; these outcomes are reported on held-out folds as the mean ± SD across the five folds. The quality-gate threshold was chosen by 5-fold cross-validation over the gate grid (−9 to +8 dB) using a fixed penalty of 3 (maximize correct − 3×wrong), with a penalty-sensitivity analysis (1, 2, 3, 5). Robustness was assessed with three independent random seeds (11, 22, 33), a chromatic-direction-noise sensitivity analysis (60% chromatic vs 30% default), and a diastolic-wave sensitivity analysis (0.15 vs 0.45). A recovery-period analysis simulated a still check-in immediately after exercise (initial HR 100–140, recovery slope 0.3–1.0 bpm/s) to quantify the systematic downward bias of the 12-second still-check-in mean relative to the true stop-moment HR. All results are regenerable by `npm run verify` (Node 18+, ~80 s).

### Safety-Kernel Validation Methods

`npm test` runs automated checks with no network or LLM calls: 19 safety scenarios (e.g., chest pain after STS, RPE 17 after the first work block, repeated escalation to a third reduction then stop, SpO₂ 88%, HR above HRmax, COPD with missing oximeter value, withheld camera HR, new chest pain at the pre-session check), 6 scripted adversarial proposals generated by a fake-LLM harness (excessive intensity, dangerous sentences), 222 exhaustive virtual-patient profiles, 6 conformance checks (audit-chain integrity, a pure-JavaScript SHA-256 fallback, FHIR bundle validity and HR provenance, and MCP tool-schema/registry consistency), and an MCP server protocol check. The kernel's rejection of every such proposal is asserted to pass.

### Real-World Validation Protocol (Not Yet Performed)

A measurement tool records, from the same video frames, both the green (v1.6) and POS estimates together with the reference value, participant pseudo-ID, condition (seated rest, post-STS recovery), lighting, self-reported Fitzpatrick skin type, and reference device. The protocol specifies a chest-strap ECG HR monitor where possible (or a validated fingertip pulse oximeter), seated-rest and post-STS-recovery conditions under natural and indoor lighting, paired snapshots at the moment the reference is read (the prior 12-s window is frozen), and analysis with Bland–Altman limits of agreement [27] for repeated measures [28], ICC(2,1), MAE/RMSE/MAPE, Pearson r, and Lin's concordance correlation coefficient, with participant-level bootstrap confidence intervals (reported only for ≥10 participants) and separate reporting by skin type [29]. Camera-based vital signs require validation against regulated reference devices [30]. This protocol requires IRB review and was not executed for this manuscript.

---

## Results

### Algorithm Validation

**Baseline defect and the v1.6 correction.** The v1 peak-counting estimator always emitted a value and, on held-out cross-validation folds, was correct on 27.8%±1.1% and wrong on 72.2%±1.1% of signals, miscounting the diastolic wave at resting HR 50–60 bpm (correct rate 0% at 50 bpm, 8.5% at 60 bpm). The v1.6 green method with the 2-dB gate emitted a value on 56.7%±1.0% of signals, was correct on 52.0%±1.2%, wrong on 4.7%±0.4% (8.2% of displayed values), and withheld 43.3% (Table 3); all five folds independently selected the same 2-dB gate, and the POS method selected 1 dB in all five folds. The wrong-output reduction was achieved primarily by withholding rather than by answering.

**Accuracy of displayed values.** Among displayed values (held-out mean±SD), the green method had MAE 3.9±0.3 bpm with 91.8%±0.8% within ±5 bpm (POS: output 40.2%±0.8%, correct 36.4%±0.7%, wrong 3.8%±0.3%, MAE 4.8±0.4 bpm). Under the rest scenario the green method was correct on 65.9% and wrong on 0.14% of signals (MAE 0.60 bpm); under the step scenario it was correct on 61.0% and wrong on 0.05% (MAE 0.55 bpm). Under in-band motion the estimate was unreliable: correct on 29.2% and wrong on 13.8% (green), and 26.2% / 9.7% (POS), a finding that motivated the still-check-in design rather than continuous measurement during exercise.

**Risk–coverage curve and penalty sensitivity.** As the gate tightened from −9 to +8 dB, the wrong rate fell monotonically while the output rate fell (e.g., at 0 dB: output 72.8%, correct 63.4%, wrong 9.5%; at 6 dB: output 30.2%, correct 29.5%, wrong 0.7%). The 2-dB gate was the cross-validated optimum for penalty 3; under penalty 1, 2, and 5 the optimum moved to −9, −2, and +4 dB respectively.

**Sensitivity and replication.** Independent seeds 11/22/33 reproduced the headline numbers (green wrong rate 4.38%, 4.76%, and 4.08%, respectively; SD 0.42 percentage points across seeds). Increasing chromatic-direction noise from 30% to 60% raised the POS wrong rate under motion to 29.2% (green 12.5%), leaving the conclusion that neither method is safe under motion unchanged. Lowering the diastolic-wave amplitude (0.15 vs 0.45) did not change the ranking of methods.

**Recovery-period bias.** The still-check-in HR, being the 12-second mean immediately after stopping, read 2.3–8.5 bpm below the true stop-moment HR (larger for faster recovery slopes), confirming that a still-check-in HR systematically understates the exercise HR. The kernel therefore treats RPE as the primary criterion whenever a tested HRmax is absent and reduces intensity whenever RPE exceeds target even when HR is the primary criterion.

### Safety-Kernel Validation

All 19 safety scenarios, 6 adversarial proposals, 222 exhaustive profiles, 6 conformance checks, and the MCP protocol check passed automatically (`npm test`). The kernel refused excessive-intensity proposals, blocked dangerous patient-facing sentences, required the missing oximeter value before a COPD work block, and stopped the session on the scripted safety criteria (e.g., chest pain, RPE 17, SpO₂ 88%, HR above HRmax). The passing of these checks is a property of the deterministic rules and the scripted scenarios; it is not evidence that a real LLM cannot evade the kernel, which is an explicit future evaluation.

---

## Discussion

### Principal Findings

VitalLens demonstrates two mechanisms together. First, a camera-only, quality-gated HR estimate is accurate when the patient is still (MAE <1 bpm at rest in simulation) and, crucially, withholds rather than fabricates when the signal is poor: the correction from an always-answers v1 to a spectral v1.6 with a 2-dB gate reduced wrong outputs from 72.2% to 4.7%, mostly by withholding. Second, a deterministic, guideline-derived safety kernel can make an LLM coach safe-by-construction at the level of tools and sentences: the model cannot overprescribe intensity, minimize symptoms, or give medication advice because every such action or sentence is rejected before execution, and the kernel's veto cannot be overridden.

The recovery-period bias finding is a caution against the common assumption that a post-exercise camera HR approximates exercise HR: the 12-second still-check-in mean understates the stop-moment HR by 2.3–8.5 bpm in simulation. VitalLens's response (using RPE as the primary criterion when no tested HRmax exists, and reducing whenever either channel exceeds target) is a design-level mitigation rather than a measurement fix.

### Comparison With Prior Work

Browser-based rPPG has been validated against ECG with ICC 0.96 under standardized online conditions [31], but "in-the-wild" webcam conditions show substantially lower correlation (r ≈ 0.58 in one online study) and a tendency to underestimate HR [32]; VitalLens's still-check-in design and its withholding behavior are consistent with, and a response to, this gap. Prior cardiac-rehabilitation prototypes such as SRCardioCare establish feasibility of app-based home exercise but rely on manual vital entry and identified manual data entry as a limitation [33]; VitalLens removes the dedicated HR device but deliberately retains the pulse oximeter for COPD. The safety-kernel approach responds directly to the 58% safety-defect rate in LLM exercise-recommendation studies [8] and to prior work evaluating an LLM's decisions about timely intervention in cardiac rehabilitation [35]; it aligns with the EU AI Act's requirement for human oversight and the ability to disregard or interrupt AI output [34] and with national guidance on the review of generative-AI medical devices [36], although no regulation mandates a deterministic rule layer as such; it is a design response to human-oversight and risk-management obligations.

### Limitations

The most important limitation is that no human-participant validation has been performed: all algorithm numbers are simulation results, which cannot substitute for comparison against a reference device, and the clinical effect of the intervention is unproven. Additional limitations follow. The camera cannot measure SpO₂, respiratory rate, or ECG rhythm, so hypoxemia and arrhythmia detection are out of scope and a pulse oximeter remains required (contactless respiratory-rate estimation from a smartphone camera is possible [37] but is not implemented here). rPPG robustness is known to vary with lighting and skin tone [29], and VitalLens has not yet quantified performance across skin tones or lighting conditions. In-band periodic motion (cycling, marching in place) defeats both the green and POS methods, which is why HR is only measured during still check-ins, and the still-check-in value is itself recovery-biased. The predicted-HRmax error (±12 bpm) is not a substitute for a tested HRmax. The patient-facing text screen is pattern-based and does not catch every unsafe phrasing; it addresses only the failure modes reported in the literature. The hash-chained audit log exposes alteration but, being keyless, cannot prevent a file holder from recomputing the chain, so the head hash must be stored separately. The STS auto-counter (frame-difference) is an unvalidated v1 test feature; sessions use the patient's own count. Finally, an LLM that genuinely attempts to evade the kernel has not yet been tested.

### Future Work

Immediate next steps are (1) IRB-approved real-world measurement against a reference ECG HR monitor, including per-skin-type error reporting; (2) an adversarial evaluation using a real LLM attempting to bypass the kernel; and (3) posture-estimation-based STS counting, for which computer-vision sit-to-stand assessment [38,39] and automated exercise recognition [40,41] provide foundations. The longer roadmap includes motion-robust rPPG, camera respiratory-rate estimation, and (only after a pre-registered randomized controlled trial with a defined primary endpoint, comparator, and sample size) any claim of clinical effectiveness.

---

## Conclusion

VitalLens shows that a consumer camera and a deterministic, guideline-derived safety kernel can support a home cardiopulmonary rehabilitation session in which an LLM may coach but cannot overprescribe intensity, minimize symptoms, or give medication advice. The prototype is a pre-clinical engineering artifact: its algorithm and safety-kernel validation are simulation- and script-based, and it is not a medical device. Real-world validation under IRB oversight is the necessary next step.

---

## Acknowledgments

This research was supported by the ANCHOR program through the Gyeongbuk ANCHOR Center, funded by the Ministry of Education (MOE) and Gyeongsangbuk-do, Republic of Korea (2026-ANCHOR-15-102). The knowledge base "원격재활과 디지털치료기기" (Tele-rehabilitation and Digital Therapeutics) was authored by Wansuk Choi, Department of Physical Therapy, College of Health Sciences, Kyungwoon University.

## Data Availability

All source code, the safety-kernel rules with their sources, and the reproducible validation scripts are available at https://github.com/y3korea/vitallens. Simulation results are regenerable with `npm run verify`. The live prototype is at https://y3korea.github.io/vitallens/. No human-participant data were collected.

## Conflicts of Interest

None declared.

## Ethical Considerations

This manuscript describes development and simulation/script-based validation only. No human participants were involved, so no institutional review board approval was required for the work reported here. The planned real-world validation protocol explicitly requires IRB review before any participant recruitment.

---

## Tables

**Table 1. Selected safety-kernel rules with sources.**

| Rule | Value | Source |
|---|---|---|
| Initial HRR target | 40–59% HRR | EAPC 2020 [23] (Ambrosetti et al.), Tables 1–2 |
| Mid-risk supervised HRR target | 40–49% HRR | Design choice (lower half of EAPC moderate band) |
| HR ceiling (check-in) | ≤80% HRR; above → reduce | AHA 2013 [21] (Fletcher et al.), Table 7 |
| RPE target | Borg 12–14 | EAPC 2020 [23], Table 1; AACVPR/AHA/ACC 2019 [25] |
| Mid-risk supervised RPE target | 11–13 | Design choice |
| Reduce when RPE above | 15 (unsupervised) | EAPC 2020 moderate band ends at 14 — design choice |
| Stop at RPE ≥ / dyspnea ≥ | 17 / 8 | Design choice (unsupervised home sessions) |
| COPD dyspnea target | Borg 4–6 | ATS/ERS 2013 [20] pulmonary rehabilitation statement |
| Resting SpO₂ minimum | ≥92%, else no session; ≥4-point fall → reduce | Design choice matching screener |
| Stop at SpO₂ ≤ | 88% | ATS 2020 [24] home-oxygen guideline (conservative choice) |
| SpO₂ required for COPD | every check-in, else hold | Design rule based on ATS 2020 [24] |
| Stop HR | ≥ HRmax (tested or 220 − age) | AHA 2013 [21]; knowledge-base 9.3 |
| HR discordance | >15 bpm over ceiling with RPE ≤13 → reduce & recheck | Design choice |
| Reduction limit | 3rd reduction ends session | Design choice |
| Stop symptoms | chest pain, presyncope, severe dyspnea, palpitations, confusion, request to stop | AHA 2013 [21]; ERS/ATS 2014; ATS/ACCP 2003; ATS/ERS 2013 [20] |
| Session structure | warm-up/cooldown 3–10 min; work ≤10 min/block; total work ≤30 min | Design choice |

**Table 2. Planner tools (MCP tool-definition shape).**

| Tool | Function | Gating |
|---|---|---|
| `get_patient_profile` | Read clinician-entered risk level and exercise profile | Read-only |
| `compute_target_zone` | Return kernel-approved HRR + RPE (+ dyspnea) bands | Read-only; only band `set_exercise_phase` accepts |
| `pre_session_safety_check` | Today's symptoms, emergency plan, resting SpO₂ | Any red flag → no session |
| `say_to_patient` | Sole channel for coaching text | ≤200 chars; text screen |
| `set_exercise_phase` | Start a phase with targets + instruction | Order, minutes, cumulative work, band, text screen |
| `still_check_in` | Pause for 12-s still HR + RPE + dyspnea + SpO₂ + symptoms | Kernel evaluates: continue/reduce/hold/stop |
| `run_sts_test` | 30-s chair stand (patient-entered count) | Once/session, after warm-up check-in |
| `end_session` | Summary + close | Requires cool-down + check-in unless stopped for safety |

**Table 3. Held-out 5-fold cross-validation summary (6,600 signals; gate selected within training folds; values are mean±SD across folds).**

| Method | Output rate | Correct rate | Wrong rate | MAE (bpm) | Within ±5 bpm (of output) |
|---|---|---|---|---|---|
| v1 (peak counting) | 100% | 27.8%±1.1% | 72.2%±1.1% | 16.7±0.2 | 27.8%±1.1% |
| v1.6 green (2 dB) | 56.7%±1.0% | 52.0%±1.2% | 4.7%±0.4% | 3.9±0.3 | 91.8%±0.8% |
| POS (1 dB) | 40.2%±0.8% | 36.4%±0.7% | 3.8%±0.3% | 4.8±0.4 | 90.6%±0.8% |

Correct/wrong rates are fractions of all signals; "wrong of displayed" for green = 4.7/56.7 = 8.2%.

---

## Abbreviations

- 6MWT: 6-minute walk test
- AHA: American Heart Association
- ATS: American Thoracic Society
- COPD: chronic obstructive pulmonary disease
- CV: cross-validation
- EAPC: European Association of Preventive Cardiology
- ECG: electrocardiogram
- ERS: European Respiratory Society
- ESC: European Society of Cardiology
- FHIR: Fast Healthcare Interoperability Resources
- HR: heart rate
- HRmax: maximal heart rate
- HRR: heart-rate reserve
- ICC: intraclass correlation coefficient
- IRB: institutional review board
- LLM: large language model
- LOINC: Logical Observation Identifiers Names and Codes
- MAE: mean absolute error
- MCP: Model Context Protocol
- POS: plane-orthogonal-to-skin
- rPPG: remote photoplethysmography
- RPE: rating of perceived exertion
- SNR: signal-to-noise ratio
- SpO₂: peripheral oxygen saturation
- STS: sit-to-stand

---

## References

1. Cox NS, Dal Corso S, Hansen H, McDonald CF, Hill CJ, Zanaboni P, et al. Telerehabilitation for chronic respiratory disease. Cochrane Database Syst Rev. 2021;2021(1):CD013040. doi:10.1002/14651858.CD013040.pub2
2. Li L, Ringeval M, Wagner G, Paré G, Ozemek C, Kitsiou S. Effectiveness of home-based cardiac rehabilitation interventions delivered via mHealth technologies: a systematic review and meta-analysis. Lancet Digit Health. 2025;7(4):e238-e254. doi:10.1016/j.landig.2025.01.011
3. Li Y, Zhang H, Zhao G, Li J, Huang H, Wang L, et al. Comparing pulmonary telerehabilitation and center-based pulmonary rehabilitation for effectiveness and adherence in chronic obstructive pulmonary disease: systematic review and meta-analysis of randomized controlled trials. J Med Internet Res. 2026;28:e80500. doi:10.2196/80500
4. Shnitzer H, Chan J, Yau T, McIntyre M, Andreoli A, Kua A, et al. The safety of telerehabilitation: systematic review. JMIR Rehabil Assist Technol. 2025;12:e68681. doi:10.2196/68681
5. Yau T, Chan J, McIntyre M, Bhogal D, Andreoli A, Leochico CFD, et al. Adverse events associated with the delivery of telerehabilitation across rehabilitation populations: a scoping review. PLoS One. 2024;19(11):e0313440. doi:10.1371/journal.pone.0313440
6. Gremeaux V, Troisgros O, Benaïm S, Hannequin A, Laurent Y, Casillas JM, et al. Determining the minimal clinically important difference for the six-minute walk test and the 200-meter fast-walk test during cardiac rehabilitation program in coronary artery disease patients after acute coronary syndrome. Arch Phys Med Rehabil. 2011;92(4):611-619. doi:10.1016/j.apmr.2010.11.023
7. Burge AT, Cox NS, Holland AE, McDonald CF, Alison JA, Wootton R, et al. Telerehabilitation compared with center-based pulmonary rehabilitation for people with chronic respiratory disease: economic analysis of a randomized controlled clinical trial. Ann Am Thorac Soc. 2025;22(1):47-53. doi:10.1513/AnnalsATS.202405-549OC
8. He T, Lu D, Ma Y, He J, Li D, Li G, Sun J. The AI recommendation paradox: a systematic review evaluating the promise, peril, and path forward for large language models in exercise recommendation. Biol Sport. 2026;43:949-970. doi:10.5114/biolsport.2026.158676
9. Li J, Xia W, Zhan C, Liu S, Yin Z, Wang J, et al. A telerehabilitation programme in post-discharge COVID-19 patients (TERECO): a randomised controlled trial. Thorax. 2022;77(7):697-706. doi:10.1136/thoraxjnl-2021-217382
10. Thanakamchokchai J, Khobkhun F, Phetsitong R, Chaiyawat P, Areerak K, Niemrungruang K, et al. Effectiveness of telerehabilitation on the International Classification of Functioning, Disability, and Health framework outcomes during the COVID-19 pandemic: a systematic review and meta-analysis of randomized controlled trials. Digit Health. 2025;11:20552076251325993. doi:10.1177/20552076251325993
11. Kim C, Choi HE, Rhee CK, Song JH, Lee JH. Efficacy of digital therapeutics for pulmonary rehabilitation: a multi-center, randomized controlled trial. Life (Basel). 2024;14(4):469. doi:10.3390/life14040469
12. Kang JY, Jung W, Kim HJ, An JH, Yoon H, Kim T, et al. Temporary telemedicine policy and chronic disease management in South Korea: retrospective analysis using national claims data. JMIR Public Health Surveill. 2024;10:e59138. doi:10.2196/59138
13. Jones CJ, Rikli RE, Beam WC. A 30-s chair-stand test as a measure of lower body strength in community-residing older adults. Res Q Exerc Sport. 1999;70(2):113-119. doi:10.1080/02701367.1999.10608028
14. Verkruysse W, Svaasand LO, Nelson JS. Remote plethysmographic imaging using ambient light. Opt Express. 2008;16(26):21434-21445. doi:10.1364/OE.16.021434
15. Poh MZ, McDuff DJ, Picard RW. Non-contact, automated cardiac pulse measurements using video imaging and blind source separation. Opt Express. 2010;18(10):10762-10774. doi:10.1364/OE.18.010762
16. van der Kooij KM, Naber M. An open-source remote heart rate imaging method with practical apparatus and algorithms. Behav Res Methods. 2019;51(5):2106-2119. doi:10.3758/s13428-019-01256-8
17. de Haan G, Jeanne V. Robust pulse rate from chrominance-based rPPG. IEEE Trans Biomed Eng. 2013;60(10):2878-2886. doi:10.1109/TBME.2013.2266196
18. Wang W, den Brinker AC, Stuijk S, de Haan G. Algorithmic principles of remote PPG. IEEE Trans Biomed Eng. 2017;64(7):1479-1491. doi:10.1109/TBME.2016.2609282
19. Borg GA. Psychophysical bases of perceived exertion. Med Sci Sports Exerc. 1982;14(5):377-381. doi:10.1249/00005768-198205000-00012
20. Spruit MA, Singh SJ, Garvey C, ZuWallack R, Nici L, Rochester C, et al. An official American Thoracic Society/European Respiratory Society statement: key concepts and advances in pulmonary rehabilitation. Am J Respir Crit Care Med. 2013;188(8):e13-e64. doi:10.1164/rccm.201309-1634ST
21. Fletcher GF, Ades PA, Kligfield P, Arena R, Balady GJ, Bittner VA, et al. Exercise standards for testing and training: a scientific statement from the American Heart Association. Circulation. 2013;128(8):873-934. doi:10.1161/CIR.0b013e31829b5b44
22. Pelliccia A, Sharma S, Gati S, Bäck M, Börjesson M, Caselli S, et al. 2020 ESC guidelines on sports cardiology and exercise in patients with cardiovascular disease. Eur Heart J. 2021;42(1):17-96. doi:10.1093/eurheartj/ehaa605
23. Ambrosetti M, Abreu A, Corrà U, Davos CH, Hansen D, Frederix I, et al. Secondary prevention through comprehensive cardiovascular rehabilitation: from knowledge to implementation. 2020 update. Eur J Prev Cardiol. 2021;28(5):460-495. doi:10.1177/2047487320913379
24. Jacobs SS, Krishnan JA, Lederer DJ, Ghazipura M, Hossain T, Tan AYM, et al. Home oxygen therapy for adults with chronic lung disease: an official American Thoracic Society clinical practice guideline. Am J Respir Crit Care Med. 2020;202(10):e121-e141. doi:10.1164/rccm.202009-3608ST
25. Thomas RJ, Beatty AL, Beckie TM, Brewer LC, Brown TM, Forman DE, et al. Home-based cardiac rehabilitation: a scientific statement from the American Association of Cardiovascular and Pulmonary Rehabilitation, the American Heart Association, and the American College of Cardiology. Circulation. 2019;140(1):e69-e89. doi:10.1161/CIR.0000000000000663
26. Anthropic. Effective harnesses for long-running agents. 2025. https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
27. Bland JM, Altman DG. Statistical methods for assessing agreement between two methods of clinical measurement. Lancet. 1986;1(8476):307-310. doi:10.1016/S0140-6736(86)90837-8
28. Bland JM, Altman DG. Agreement between methods of measurement with multiple observations per individual. J Biopharm Stat. 2007;17(4):571-582. doi:10.1080/10543400701329422
29. Pirzada P, Wilde A, Harris-Birtill D. Remote photoplethysmography for heart rate and blood oxygenation measurement: a review. IEEE Sens J. 2024;24(15):23436-23453. doi:10.1109/JSEN.2024.3405414
30. Talukdar D, De Deus LF, Sehgal N. Evaluation of a camera-based monitoring solution against regulated medical devices to measure heart rate, respiratory rate, oxygen saturation, and blood pressure. Cureus. 2022;14(10):e31649. doi:10.7759/cureus.31649
31. Finotti G, Di Lernia D, Tsakiris M. Validation of web-based remote photoplethysmography for heart rate measurement using standardized online infrastructure against ECG benchmarks. Behav Res Methods. 2026;58(9):252. doi:10.3758/s13428-026-03098-7
32. Di Lernia D, Finotti G, Tsakiris M, Riva G, Naber M. Remote photoplethysmography (rPPG) in the wild: remote heart rate imaging via online webcams. Behav Res Methods. 2024;56(7):6904-6914. doi:10.3758/s13428-024-02398-0
33. Kumar Pichai A, Sathya A, SenthilKumar T, Shanmugasundaram S, Karthik R. Development of mobile software "SRCardioCare" prototype for implementing home-based exercise program among patients after adult cardiac surgical revascularization: qualitative feasibility study. JMIR Rehabil Assist Technol. 2026;13:e69197. doi:10.2196/69197
34. Regulation (EU) 2024/1689 (EU AI Act), Article 14 — Human oversight. https://artificialintelligenceact.eu/article/14/
35. Haag D, Kumar D, Gruber S, Hofer D, Sareban M, Treff G, Niebauer J, Bull C, Schmidt A, Smeddinck JD. The Last JITAI? Exploring large language models for issuing just-in-time adaptive interventions: fostering physical activity in a conceptual cardiac rehabilitation setting. In: Proceedings of the 2025 CHI Conference on Human Factors in Computing Systems. 2025. doi:10.1145/3706598.3713307
36. Ministry of Food and Drug Safety (Republic of Korea). Guideline on approval and review of generative-artificial-intelligence medical devices (2025-01-24). https://www.mfds.go.kr/brd/m_1060/view.do?seq=15628
37. Molinaro N, Schena E, Silvestri S, Massaroni C. Multi-ROI spectral approach for the continuous remote cardio-respiratory monitoring from mobile device built-in cameras. Sensors. 2022;22(7):2539. doi:10.3390/s22072539
38. Hsu CY, Hsu YP, Sun TL, Lee CH. Quantitative assessment of the 30-second sit-to-stand test using computer vision technology for physical therapists. J Neuroeng Rehabil. 2026;23(1):202. doi:10.1186/s12984-026-01970-3
39. Jeanfavre M, Xiao J. From force plates to AI: establishing validity and reliability of a 2D AI-camera system for quantifying sit-to-stand power measurement. Int J Sports Phys Ther. 2026;21(4). doi:10.26603/001c.158667
40. Japhne F, Janada K, Theodorus A, Chowanda A. Fitcam: detecting and counting repetitive exercises with deep learning. J Big Data. 2024;11(1):101. doi:10.1186/s40537-024-00915-8
41. Khurana R, Ahuja K, Yu Z, Mankoff J, Harrison C, Goel M. GymCam: detecting, recognizing and tracking simultaneous exercises in unconstrained scenes. Proc ACM Interact Mob Wearable Ubiquitous Technol. 2018;2(4):185. doi:10.1145/3287063

---

## Author Checklist (to complete before submission)

1. **[grant number check]** Author names, affiliations, ORCIDs, degrees, funding, and contact details are filled in. Remaining: verify the ANCHOR grant number (2026-ANCHOR-15-102) against your award notice.
2. **Two guideline citations to verify against primary texts** (used in Table 1): "ERS/ATS 2014" (stop criteria: intolerable dyspnea, pallor) and "ATS/ACCP 2003" (stop criterion: confusion). Confirm the exact publication and page for each; the current draft cites them by name only in Table 1 and does not fabricate a DOI for them.
3. **He et al. (ref 8)** — RESOLVED (2026-10-07). Full citation corrected and the 58% safety-defect figure confirmed against the abstract: He T, Lu D, Ma Y, He J, Li D, Li G, Sun J. The AI recommendation paradox: a systematic review evaluating the promise, peril, and path forward for large language models in exercise recommendation. Biol Sport. 2026;43:949-970. doi:10.5114/biolsport.2026.158676.
4. **Year conventions.** Two guidelines were published online in 2020 and in print in 2021 (refs 22 and 23), and TERECO was published online in 2021 and in print in 2022 (ref 9); confirm your target journal's preferred year format (print vs. online).
5. **Word count, abstract limit, and JMIR house style** (structured abstract headings, "Keywords" placement, reference formatting with DOIs/Medline links, multimedia appendix if any) should be checked against the current JMIR Rehabil Assist Technol author instructions.
6. **Figure list.** The website has diagrams (harness structure, risk–coverage curve, evidence map) that could become Figures 1–4; decide which to include and add figure captions.
