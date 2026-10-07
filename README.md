# VitalLens — 카메라 심박과 안전 커널로 하는 심폐 원격재활 (연구 프리뷰)

이미 가진 카메라로 멈춘 상태의 심박을 재고(rPPG), 가이드라인 기반 안전 커널이 거부권을 가진 에이전트가 가정 심장·호흡재활 세션을 이끄는 연구 프로토타입입니다. 경운대학교 「원격재활과 디지털치료기기」 기말 프로젝트이자 공학 논문의 구현물입니다.

- 공개 주소: https://y3korea.github.io/vitallens/
- 소스: https://github.com/y3korea/vitallens

> 의료기기가 아닙니다. 식품의약품안전처·FDA 허가를 받지 않았으며 진단·치료 결정에 쓰면 안 됩니다.
> 카메라로 재는 것은 정지 시 심박뿐입니다. 산소포화도·심전도 리듬은 재지 않으므로 맥박산소측정기가 필요합니다(COPD 필수, 심장재활 권장).

## 실행

```bash
python3 -m http.server 8000
```

`http://localhost:8000` 에서 엽니다. 카메라는 보안 컨텍스트(localhost 또는 HTTPS)에서만 켜집니다. 정적 파일만 있으므로 GitHub Pages 같은 곳에 그대로 올리면 HTTPS로 동작합니다. 외부 CDN을 쓰지 않으며, 모든 페이지에 콘텐츠 보안 정책(CSP)이 있습니다.

## 테스트와 검증

```bash
npm test              # rPPG 회귀, 통계식(Python·statsmodels 대조), 안전·적대적 시나리오, MCP 프로토콜
npm run verify        # 시뮬레이션 5겹 교차검증 → data/sim_results.js (약 80초)
npm run build:mcp     # mcp/tools.json 을 코드의 도구 목록에서 다시 생성
```

Node 18 이상만 있으면 됩니다(npm 패키지 설치 불필요). `npm test`의 통계 교차검증은 python3를 쓰고, 반복측정 대조에는 `pip install -r requirements.txt`(numpy·pandas·statsmodels)가 필요합니다 — 없으면 그 한 항목만 건너뜁니다.

## 안전 커널을 MCP로 쓰기

같은 도구·커널·감사 기록을 stdio MCP 서버로 엽니다. 환자는 **가상 환자**이며 카메라나 실제 사람과 연결되지 않습니다.

```bash
node mcp/server.js
```

```bash
claude mcp add vitallens -- node /절대/경로/mcp/server.js
```

환경변수 `VITALLENS_SCENARIO`(`normal`, `chest_pain`, `high_rpe`, `low_spo2`, `tachy`, `copd_no_spo2`, …)와 `VITALLENS_PROFILE`(JSON)로 시나리오를 바꿀 수 있습니다. `export_session` 도구가 감사 기록·머리 해시·FHIR Bundle을 돌려줍니다.

## 페이지

| 파일 | 내용 |
|---|---|
| `index.html` | 문제, 세 가지 차별점, 세션 흐름 |
| `evidence.html` | 근거 지도, 효과크기(대상자·비교군·근거 수준 포함), 비용 구조, 국내 사례, 안전관리 4단계와 구현 범위 |
| `technology.html` | rPPG 파이프라인(v1.6), STS, 3계층 구조, 에이전트 하네스·MCP, FHIR, 한계 |
| `validation.html` | 시뮬레이션 교차검증, 위험–적용범위 곡선, 회복기 편향, 실측 프로토콜, 기준기기 비교 도구와 반복측정 분석 |
| `agent.html` | AI 코치 — 안전 커널, 가상 환자·실제 사용자 세션, 해시 체인 감사 기록, FHIR 내보내기 |
| `demo.html` | 심박 측정, 30초 앉았다일어서기(v1 시험 기능), 강도 계산기, 위험 선별 질문 |
| `about.html` | 선행 제품 비교, CES 출품 현실 점검, 논문 구성안, 로드맵 |

## 코드

| 파일 | 역할 |
|---|---|
| `js/rppg-core.js` | 심박 추정의 단일 구현(브라우저·Node 공용): 12초 시간 창, 재표본화, 영위상 버터워스 대역통과, 스펙트럼, 배음 포함 SNR 품질 기준, POS |
| `js/agent-core.js` | 안전 규칙(출처 포함), MCP 형식 도구 정의, 스키마·순서·범위·문장 관문이 있는 커널, 하네스, 규칙 플래너(AI 아님), 가상 환자, 감사 기록(순수 JS SHA-256 대체 구현 포함), FHIR |
| `js/stats.js` | Bland–Altman(반복측정 2007 포함), 참여자 수 기준 일치한계 신뢰구간, 참여자 단위 부트스트랩(참여자 10명 이상), MAE/RMSE/MAPE, Pearson, Lin CCC, ICC |
| `js/agent-ui.js` | AI 코치 화면. Claude 플래너는 사용자 키로 브라우저에서 공식 SDK를 불러 호출하며, 키는 메모리에만 둡니다 |
| `js/vendor/anthropic-sdk-0.128.0.mjs` | `@anthropic-ai/sdk` 0.128.0을 esbuild로 묶은 파일(MIT, `anthropic-sdk-LICENSE.txt`). SHA-256 `4cd3ca6f1af95a5c236d682e6940a105d2e4d3a42bc50b8db1729a4573480505` |
| `mcp/server.js`, `mcp/tools.json` | stdio MCP 서버와, `tools/list` 응답 형식의 도구 정의 |
| `validation/` | 시뮬레이터(`sim_verify.js`)와 테스트 |
| `data/evidence.js` | 페이지에 쓰인 임상 수치의 단일 출처 (`evidence.json`에서 생성) |

## 근거

임상 수치는 `TeleRehab_DTx_Knowledge_Base` 제9장과 분석 산출물에서, 안전 커널 기준값은 EAPC 2020·AHA 2013·ATS/ERS 2013·ATS 2020·ESC 2020 원문에서 가져왔습니다. 인용된 DOI는 Crossref로, 초록 수치는 Europe PMC로 대조했습니다. "설계 선택"으로 표시한 커널 값은 가이드라인 기준이 아니라 이 프로젝트가 보수적으로 정한 값입니다.

## 라이선스

아직 정하지 않았습니다. 라이선스가 정해지기 전까지는 열람만 가능합니다(저작권은 작성자에게 있음). `js/vendor/`의 SDK는 MIT 라이선스입니다.
