// Generated from evidence.json so pages work via plain file:// (fetch() of local JSON is blocked by CORS in that context)
window.EVIDENCE = {
  "source_note": "모든 수치는 경운대학교 재활치료전공 최완석 지식베이스(TeleRehab_DTx_Knowledge_Base) 제9장 '심장·호흡 재활의 원격 전환' 및 산출 데이터(tab06~tab20, ClinicalTrials.gov 6,389건·Europe PMC 19,093건·PubMed 2,814건 기반)에서 가져왔습니다.",
  "completion_rates": {
    "label": "원격 호흡재활 프로그램 완료율 — 1차 원격재활 vs 센터 비교 RCT 3편·516명(리뷰 전체 15편·1,904명, 99% COPD)",
    "telerehab": 93,
    "inperson": 70,
    "unit": "%",
    "citation": "Cox NS 등, Cochrane Database of Systematic Reviews, 2021",
    "url": "https://doi.org/10.1002/14651858.CD013040.pub2"
  },
  "cardiac_vs_usual_care": {
    "label": "재택 심장재활(mHealth) vs 통상치료",
    "n_studies": 13,
    "n_patients": 1508,
    "sixMWT_diff_m": 24.74,
    "sixMWT_ci": [
      9.88,
      39.6
    ],
    "vo2peak_diff": 1.77,
    "vo2peak_ci": [
      1.19,
      2.35
    ],
    "vs_center_based": "유의차 없음",
    "citation": "Li L 등, The Lancet Digital Health, 2025",
    "url": "https://doi.org/10.1016/j.landig.2025.01.011",
    "n_6mwt": 532,
    "n_vo2peak": 359,
    "evidence_quality": "낮음~매우 낮음 (GRADE)",
    "vo2peak_unit_note": "초록에 단위 표기 없음"
  },
  "pulmonary_equivalence": {
    "label": "원격 호흡재활 vs 센터기반 (COPD 메타분석)",
    "n_studies": 17,
    "n_patients": 1658,
    "sixMWT_diff_m": -5.37,
    "sixMWT_ci": [
      -15.68,
      4.95
    ],
    "dropout_rr": 0.66,
    "dropout_ci": [
      0.4,
      1.07
    ],
    "conclusion": "통계적으로 유의한 차이 없음(동등성을 입증한 것은 아님) — 디지털 지원·실시간 감독형 모델에서 효과가 더 일관됨",
    "citation": "Li Y 등, Journal of Medical Internet Research, 2026",
    "url": "https://doi.org/10.2196/80500",
    "sixMWT_k": 9,
    "sixMWT_n": 950,
    "sixMWT_p": 0.26,
    "sixMWT_prediction_interval": [
      -32.73,
      22.27
    ],
    "certainty": "중등도~매우 낮음 (GRADE)"
  },
  "economic_shift": {
    "label": "1인당 프로그램 비용 (8주 프로그램, 부담 주체별)",
    "telerehab_total_aud": 2155,
    "telerehab_health_system_aud": 1601,
    "telerehab_patient_aud": 554,
    "center_total_aud": 1826,
    "center_health_system_aud": 529,
    "center_patient_aud": 1298,
    "diff_significance": "프로그램 이후 12개월 총비용의 군간 차이 A$565(표준오차 5,452), p=0.92 (유의하지 않음)",
    "insight": "원격 전환 시 환자 부담은 A$1,298→A$554로 줄고 보건체계 부담은 A$529→A$1,601로 늘었다 — 총비용은 비슷하고 부담 주체가 환자에서 보건체계로 옮겨감(원격군은 화상·동기 감독형)",
    "citation": "Burge AT 등, Annals of the American Thoracic Society, 2025",
    "url": "https://doi.org/10.1513/AnnalsATS.202405-549OC",
    "patient_share_pct": {
      "telerehab": 26,
      "center": 71
    }
  },
  "safety": {
    "label": "원격재활 유해사례 발생률",
    "rate_1": "0.31% (65,352세션 중 201건)",
    "citation_1": "Shnitzer H 등, JMIR Rehabilitation and Assistive Technologies, 2025",
    "url_1": "https://doi.org/10.2196/68681",
    "rate_2": "0.3%, 87.4% 경증 (84,534세션 중 295건)",
    "citation_2": "Yau T 등, PLOS ONE, 2024",
    "url_2": "https://doi.org/10.1371/journal.pone.0313440",
    "context": "Shnitzer: 전 재활 영역 RCT 37편·3,166명, 포함 연구의 92%가 사람이 맡는 안전장치 사용. Yau: 중증도가 보고된 사건의 87.4%가 경증, 심장재활 연구에서 유해사례가 가장 많음(6편·92건). 무인 세션에 그대로 옮길 수 없음"
  },
  "rpe_effect": {
    "label": "자각인지도(Borg RPE) 표준화평균차",
    "smd": -1.82,
    "ci": [
      -2.77,
      -0.86
    ],
    "citation": "Thanakamchokchai J 등, Digital Health (SAGE), 2025",
    "url": "https://doi.org/10.1177/20552076251325993",
    "population": "COVID-19 환자, 무치료·통상치료 대비",
    "n": "3편·135명"
  },
  "sts_effect": {
    "label": "30초 앉았다일어서기(STS) 표준화평균차",
    "smd": 0.88,
    "ci": [
      0.52,
      1.25
    ],
    "note": "원격재활 효과크기(검사의 적합성 지표가 아님). VitalLens가 STS를 택한 이유는 공간 요구가 작고 표준화가 쉽기 때문(교재 9.4)",
    "citation": "Thanakamchokchai J 등, Digital Health (SAGE), 2025",
    "url": "https://doi.org/10.1177/20552076251325993",
    "population": "COVID-19 환자, 무치료·통상치료 대비",
    "n": "3편·122명"
  },
  "sixmwt_remote_smd": {
    "label": "6분 보행검사(6MWT) 표준화평균차",
    "smd": 0.83,
    "ci": [
      0.42,
      1.24
    ],
    "citation": "Thanakamchokchai J 등, Digital Health (SAGE), 2025",
    "url": "https://doi.org/10.1177/20552076251325993",
    "population": "COVID-19 환자, 무치료·통상치료 대비",
    "n": "4편·221명"
  },
  "korea_easybreath": {
    "product": "이지브리드 (EasyBreath)",
    "maker": "쉐어앤서비스",
    "approval_date": "2024-04-19",
    "rank": "국내 4호 디지털치료기기",
    "n_patients": 84,
    "sixMWT_intervention_m": 57.68,
    "sixMWT_control_m": 21.71,
    "p_value": "0.0008",
    "other_outcomes": "호흡곤란(mMRC, p=0.0008), 증상부담(CAT, p<0.0001), 삶의 질(SGRQ, p=0.0003) 모두 개선",
    "citation": "Kim C 등, Life (Basel), MDPI, 2024",
    "url": "https://doi.org/10.3390/life14040469",
    "approval_citation": "식품의약품안전처 보도자료, 2024",
    "approval_url": "https://www.mfds.go.kr/brd/m_99/view.do?seq=48206",
    "control": "호흡재활 1회 교육 + 운동 권고(최소 중재)",
    "n_randomized": 92,
    "registry": "임상시험 레지스트리 미등록(저자 명시)"
  },
  "korea_redpill_lesson": {
    "product": "레드필 숨튼",
    "maker": "라이프시맨틱스",
    "outcome": "확증임상(100명, 12주 6MWD 변화가 1차 평가변수, 앱 미사용 대조군)에서 군간 차이 −3.97 m(95% CI 하한 −23.48 m)로 우월성 입증 실패, 안전성은 확인 → 표본 확대·소프트웨어 고도화·평가변수 보완 후 재신청 계획",
    "lesson": "이지브리드와 같은 6MWT 평가변수에서도 결과가 갈림 — 개입의 강도·충실도, 표본 크기(검정력), 대조군 처치 같은 설계 요소가 성패를 가른다",
    "citation": "팜이데일리, 2023",
    "url": "https://pharm.edaily.co.kr/news/read?newsId=01544886635735856"
  },
  "tereco_covid": {
    "label": "COVID-19 회복기 원격 호흡재활 (TERECO)",
    "n_patients": 120,
    "sixMWT_diff_m": 65.45,
    "sixMWT_ci": [
      43.8,
      87.1
    ],
    "p_value": "< 0.001",
    "comparator": "무재활 대조군 (재활을 전혀 받지 않은 군)",
    "citation": "Li J 등, Thorax, 2022",
    "url": "https://doi.org/10.1136/thoraxjnl-2021-217382"
  },
  "trial_landscape": {
    "label": "등록 임상시험 규모 (ClinicalTrials.gov 6,389건 중)",
    "cardiac_trials": 386,
    "pulmonary_trials": 419,
    "combined": 805,
    "stroke_trials": 926,
    "note": "심폐 영역을 합치면 뇌졸중(926건)에 근접하는 3대 질환군 규모",
    "citation": "ClinicalTrials.gov 등록 시험 데이터, 분석 산출",
    "url": "https://clinicaltrials.gov/"
  },
  "evidence_tech_map": {
    "label": "질환군 × 기술요소 문헌 수 (근거 지도)",
    "columns": [
      "VR/AR/XR",
      "웨어러블·센서",
      "AI/머신러닝",
      "로봇",
      "게이미피케이션",
      "모바일앱",
      "화상상담",
      "원격모니터링",
      "BCI/신경조절",
      "모션캡처"
    ],
    "cardiac": [
      26,
      198,
      162,
      13,
      21,
      191,
      35,
      159,
      2,
      5
    ],
    "pulmonary": [
      40,
      147,
      105,
      11,
      15,
      108,
      60,
      95,
      5,
      8
    ],
    "insight": "심폐 영역 문헌은 웨어러블·센서(198/147건)·모바일앱(191/108건)·원격모니터링(159/95건) 축에 몰려 있고, VR/AR/XR(26/40건)·게이미피케이션(21/15건)·로봇(13/11건)은 웨어러블·센서 대비 약 1/4(호흡 VR/AR)에서 1/15(심장 로봇) 수준이다.",
    "citation": "Europe PMC 19,093건·PubMed 상세 2,814건 기반 분석",
    "url": "https://europepmc.org/"
  },
  "market": {
    "label": "원격재활 시장 적응증별 매출 비중",
    "cardiac_share_pct": 33.75,
    "cardiac_note": "적응증별 매출 1위",
    "pulmonary_cagr_pct": 17.19,
    "pulmonary_note": "적응증별 연평균 성장률(CAGR) 1위",
    "delivery_cloud_pct": 67.9,
    "end_user_hospital_pct": 48.1,
    "citation": "Mordor Intelligence, Telerehabilitation Market Report, 2026",
    "url": "https://www.mordorintelligence.com/industry-reports/telerehabilitation-market"
  },
  "korea_telehealth_copd": {
    "label": "국내 비대면진료 전국 코호트 — COPD",
    "n_copd_total": 37460,
    "n_copd_used": 10291,
    "finding": "고혈압·당뇨는 복약순응도 향상·입원 감소 효과가 뚜렷했으나 COPD는 임상적 효과가 제한적 — 질환군마다 원격 전달의 작동 기전이 다름",
    "citation": "Kang JY 등, JMIR Public Health and Surveillance, 2024",
    "url": "https://doi.org/10.2196/59138"
  },
  "safety_protocol": {
    "steps": [
      {
        "step": "위험 층화",
        "detail": "좌심실 기능·허혈/부정맥 소견·사건 후 경과·동반질환과 인지·감각 기능·가정 조력자 유무 종합 → 저/중/고위험 분류",
        "status": "부분",
        "vitallens": "의료진이 층화한 위험군을 입력받아 고위험은 차단, 중위험은 의료진 승인·실시간 화상 감독이 있을 때만 허용. 데모의 선별 질문은 참고용이며 의료진 판정을 대신하지 않음"
      },
      {
        "step": "이중 모니터링",
        "detail": "객관(심박수·단일유도 심전도·산소포화도·혈압) + 주관(자각인지도 RPE·호흡곤란 척도) 병행",
        "status": "부분",
        "vitallens": "심박: 정지 체크인의 카메라 측정 또는 기기 값 입력 · 산소포화도: 환자 맥박산소측정기 값 입력(COPD 필수) · 주관 척도: 구현 · 심전도·혈압: 미구현"
      },
      {
        "step": "강도 처방",
        "detail": "심박예비량(HRR) 기반 카보넨 공식 목표심박수 + 자각인지도 병용, 베타차단제·저산소혈증 환자는 RPE를 1차 기준으로 격상",
        "status": "부분",
        "vitallens": "커널이 목표 구간을 계산하고, 운동부하검사 최대심박이 없거나 베타차단제(현재 약물 상태 검사 없음)·COPD면 RPE를 1차 기준으로 사용 · 증상에 따른 하향은 구현, 세션 간 강도 상향(진행) 규칙은 미구현"
      },
      {
        "step": "응급 대응",
        "detail": "중단 기준(흉통·실신전조·산소포화도 하강·목표상한 초과)·연락 경로·환자 위치·응급의료 연계를 세션 시작 전 서면 확정",
        "status": "부분",
        "vitallens": "중단 기준: 증상·SpO₂ ≤88%·최대심박 이상에서 중단, 목표 상한 초과는 하향 · 세션 전 확인: 휴대전화·연락 가능한 사람·119 확인 · 환자 위치·응급의료 연계는 미구현(의료기관 운영 절차 필요)"
      }
    ],
    "citation": "지식베이스 제9장 9.3절 종합",
    "url": ""
  },
  "remote_6mwt_note": {
    "note": "원격 6분 보행검사는 절대값의 기관 간 비교보다 동일 환자 내 변화량 추적에 사용해야 안전",
    "citation": "지식베이스 교재 9.4절",
    "url": ""
  }
};
