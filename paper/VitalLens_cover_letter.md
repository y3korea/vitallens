# Cover Letter

Wansuk Choi, PT, PhD
Department of Physical Therapy, College of Health Sciences
Kyungwoon University
730 Gangdong-ro, Sandong-myeon, Gumi-si, Gyeongsangbuk-do, Republic of Korea
wschoi@ikw.ac.kr

October 7, 2026

The Editor-in-Chief
*JMIR Rehabilitation and Assistive Technologies*

**Re: Submission of Original Paper**

Dear Editor,

Please consider our manuscript, **"A Browser-Based Camera Heart-Rate Monitor With a Guideline-Based Deterministic Safety Kernel for Home Cardiopulmonary Telerehabilitation: Development and Simulation Validation Study,"** for publication as an Original Paper in *JMIR Rehabilitation and Assistive Technologies*.

Home-based cardiopulmonary telerehabilitation improves completion and is noninferior to center-based programs, but it still depends on dedicated heart-rate hardware, and the growing use of large language models (LLMs) for exercise prescription introduces safety risks (58% of published studies report safety defects). We describe **VitalLens**, a browser-based research prototype that (1) estimates still heart rate from an ordinary webcam using remote photoplethysmography with a spectral quality gate that withholds rather than fabricates a reading, and (2) wraps the session in a deterministic, guideline-derived safety kernel with veto power over every tool call and every patient-facing sentence an LLM or rule-based planner may propose.

The manuscript reports the system design and its validation to date: a 6,600-signal synthetic validation of the rPPG pipeline (5-fold cross-validation; the quality-gated spectral method reduced wrong outputs from 72.2% to 4.7%, mostly by withholding, with a mean absolute error of 3.9 bpm among displayed values) and fully automated safety-kernel validation (19 safety scenarios, 6 adversarial proposals, 222 exhaustive patient profiles, 6 conformance checks, and an MCP protocol check). We believe this work is well matched to the journal's focus on rehabilitation and assistive technologies, mHealth, and the safe application of AI in rehabilitation.

This manuscript is original, has not been published elsewhere, and is not under consideration by any other journal. All authors have approved the submission and agree to be accountable for the work. No human participants were involved, as the reported validation is simulation- and script-based, and the planned real-world validation protocol explicitly requires institutional review board approval before any participant recruitment. The authors declare no conflicts of interest. This research was supported by the ANCHOR program through the Gyeongbuk ANCHOR Center, funded by the Ministry of Education (MOE) and Gyeongsangbuk-do, Republic of Korea (2026-ANCHOR-15-102). The source code, safety-kernel rules with their guideline sources, and reproducible validation scripts are publicly available at https://github.com/y3korea/vitallens.

Thank you for your consideration. We look forward to your response and would be glad to provide any additional information the reviewers may require.

Sincerely,

Wansuk Choi, PT, PhD
Corresponding author
