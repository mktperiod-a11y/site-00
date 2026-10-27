# CLAUDE.md

> 웹하드(P2P) 주간 순위 **정적 사이트**. 이 파일은 저장소 전용; **`_site/` 배포 금지**.

## 기술·스택
- **Node.js ESM**: `scripts/compose.mjs`(빌드, 내장 모듈만), `gather.mjs`(수집), `standings.mjs`(순위 계산).
- **이미지**: Sharp(`scripts/imagery.mjs` 전용), 외부 이미지 직접 로딩 금지.
- **CI/CD**: GitHub Pages + Actions(`verify`, `publish`, `refresh`, `images`); **Pages Source=GitHub Actions**.
- **테스트**: `node --test`, Playwright(360/768/1024/1440px, `tests/ui-audit.mjs`), Python 개인정보 검사(`leak_guard.py`).

## 폴더·데이터
```text
data/site.json          브랜드·공개 수(10)·weights·floors·별점 설정
data/vendors.json       업체·status·주소·앱 ID·업체색·혜택
data/assets.json        이미지 소스·candidates/pick/crop/erase
data/faq.json           FAQ·치환값({metrics:을/를}, {candidates}, {public})
data/metrics.json       수집 지표(실패 시 이전 값)
data/ranking.json       현재 점수·순위·변동
data/history.json       26주 기록
data/first-week.json    최초 기준값(복원: npm run baseline:restore)
src/css/site.css        :root 디자인 변수, 글꼴 @font-face
src/css/nojs.css        자바스크립트 꺼짐 화면
src/js/site.js          메뉴·꾸밈만
src/img/brand.svg       브랜드 마크
src/static/             Sharp 재저장 이미지(og.png, touch-icon.png, icon/, logo/), font/(Pretendard KS X 1001 서브셋 400·500·600·700, OFL.txt)
scripts/{compose,gather,standings,imagery}.mjs
scripts/lib/rules.mjs   공통 규칙·제외 업체 판별값·주소 자리표시
scripts/lib/score.mjs   점수 계산, scripts/lib/play.mjs 스토어 페이지 해석
.github/workflows/      verify / publish / refresh / images
.github/scripts/leak_guard.py
tests/                  단위·빌드 테스트, render.mjs·ui-audit.mjs, fixtures/edge-data.mjs
```

## **P0 — 절대 변경 금지**

### **운영자 보호·보안 (최우선)**
- **실제 도메인·GitHub 계정/저장소명·본명·연락처·SNS·다른 운영 사이트를 코드/문서/커밋/PR/브랜치 이름에 기록 금지**.
  `README`, `CNAME`, author 메타 금지; `package.json#name`은 일반명. 위험하면 기능을 포기하고, 애매하면 넣지 말고 묻는다.
- **Git 작성자·커미터: `users.noreply.github.com`만**. 커밋은 `TZ=UTC`로. `git log --format='%ae %ce'` 확인; 세션 링크·도구 서명 금지.
  **Squash merge만**, 병합 직후 병합 커밋 이메일 확인.
- **사이트별 고유값**(프롬프트 예시와 다르게 정한 값. 다른 사이트에 재사용 금지):
  주소 자리표시 `https://as80u2ict.invalid/`(`scripts/lib/rules.mjs`), 검사 스크립트 `.github/scripts/leak_guard.py`,
  금지 문자열 Secret `LEAK_GUARD_TERMS`, 워크플로 `verify/publish/refresh/images`, 주간 실행 일요일 19:38 UTC,
  스크립트 `compose/gather/standings/imagery`, 기준값 파일 `data/first-week.json`.
- 배포 시 `actions/configure-pages`의 `base_url` → `compose.mjs --base-url`. 자리표시 남으면 실패.
  `*.github.io`는 canonical/sitemap/JSON-LD/og:url **상대 URL**(404만 루트 경로); 자체 도메인은 절대 URL.
- **API 키=GitHub Secrets만**; 로그·User-Agent에 키/도메인 금지. 로그에는 개인정보 위치(파일·줄)만. 구글·빙 인증/분석·광고 ID 금지.
  네이버 인증은 소유자 제공 시만 `site.json#naverSiteVerification`.
- 외부 원본(업체 홈페이지·원본 이미지)은 브랜치에도 커밋 금지; 재저장 결과만 커밋.
- 이미지 **Sharp 재저장 + 개인정보 검사**. 타 사이트 문구·클래스·파일 구조·주석 복제 금지.

### **업체·순위**
- **제외된 6개 업체명/주소는 저장소 어디에도 금지**(판별값: `scripts/lib/rules.mjs`의 코드값). 재추가 요청 시 결정사항 안내.
- **`vendors.json`의 `active` 전부 동일 산식으로 경쟁 → 상위 10개 공개**. 고정 슬롯·예비 순서·빈자리 채우기 금지; 탈락 업체 자체 삭제 금지.
- **유일한 순위 하한: 온디스크 3위 이내, 케이디스크 5위 이내**(`site.json#floors`). 다른 업체 임의 조정 금지.
- 신규 업체 URL 추측 금지 → **`pending` 등록 후 확인**. 실제 로고/아이콘만 사용; 없으면 **첫 글자 대체**.
  `images` 워크플로나 로컬에서 받아 `src/static/`에 저장·육안 검수(상자·잘린 조각·장식 없음).
- 로고 없음: 위디스크(받기 실패), 파일노리·지니파일·싸다파일(머리글에서 못 찾음). 아이콘 없음: 위디스크(앱 없음).
- `status: "excluded"`: 소유자가 이 사이트에서만 뺀 업체(데이터는 남기되 겨루지도 보이지도 않음, 기록에서도 지움). 현재 꿀파일.
  다시 넣을 때는 `active`로 바꾸고 `images` 워크플로로 아이콘을 다시 받는다. (프롬프트의 업체 목록에서는 빼지 않는다.)

### **표현·혜택**
- 공개 기준은 **검색 관심도·앱 이용 지표·이용자 반응** 명칭과 쉬운 한 줄 설명만. **비중·산식·보정 방식·데이터 출처·수집 기간·계산 절차 비공개**
  (소유자 결정: 기준 설명도 내부 정보의 일부라 모호하게. 상세 페이지의 공개 수치(다운로드·평점)는 출처 이름 없이 값만).
- 가짜 클릭/실시간 집계·후기·평점·이용자 수 금지. 데이터 부재 → **"이번 주 값 없음"**.
- **순위 조정 고지 유지**: "운영 기준을 일부 더한 참고 순위" 또는 "일부 서비스는 운영 기준에 따라 순위가 조정될 수 있어요". 방법 공개 금지.
- 별점은 **총점의 5점 환산값**임을 표시. 혜택은 **소유자 확인값만**(`unconfirmed: true` 제외). `affiliateUrl` → `rel="sponsored"` + 제휴 고지.
- 혜택 `{kind: "join"|"event", text}`: **조건+혜택 16자 이내**. 날짜·확인일·마침표·"~시"·"지급"·"진행 중" 금지.

## 산정·배포 불변 조건
- **월요일 04:38 KST(일요일 19:38 UTC)** `refresh.yml` → 수집/산정/데이터 커밋 → `publish.yml`(테스트·개인정보 재검사).
- NAVER 검색어 트렌드 **최근 4주/주간**, 기준 업체 1+비교 4씩 상대 정규화(API HUB → DataLab). Secrets: `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET`; `NAVER_TREND_URL` 선택.
- Google Play **한국** 스토어 다운로드·평점·평가 수(앱 ID 보유 시).
- **가중치 40/35/25**: 검색 `log1p`, 다운로드 `log10`, 평점 `ratingPrior` → 후보 내 0~1 → 100점. 누락 지표는 가중치 재분배; 전부 누락이면 해당 주 산정만 제외(`pending`).
- 순위 하한 미충족 시 경계 업체보다 **+0.1점**, 증가분 항목별 잔여 여유 비례 배분(항목 합=총점). 총점 소수 첫째 자리; 이동 상한 없음.
- **별점 `3.6+1.4×총점/100`**; 전주 ▲▼ / 10위 밖 `NEW` / 첫 주 `–`. 수집 실패 시 **지난 지표 재사용, 배포 유지**.

## UI·SEO·출력
- **`_site/`에는 공개 HTML/assets/sitemap/robots/llms/favicon만**. `data/`·소스·테스트·설정 제외.
- **CSP/referrer 전체 적용**, 인라인 `style` 금지; `.vc-<id>`/`.st-NN` 빌드 생성. 이동 페이지 인라인 스크립트에 CSP 해시. HTML **140칸 제한**(한글 2칸).
- 메인 1~3위·갱신일; 카드 순위·업체·별점·혜택·링크. 갱신일은 순위표 머리의 상태 줄(점·갱신일만)에 둔다.
  상단 정보는 주차 칩·제목·순위 조정 고지·갱신일만. 부제("주간 웹하드 차트" 등)·다음 갱신일·"N일 전 갱신" 같은 잔정보는 넣지 않는다(소유자: 피로감). **44px 터치 영역, WCAG AA, 키보드 포커스, 가로 스크롤 금지, JS 없이 주요 콘텐츠 표시**. 모바일 메뉴 바깥 클릭/Esc 닫기.
- 디자인: **일반 서비스형 다크 모드**(Material 3 다크 역할, SchemeFidelity로 키 컬러 보라 `#7c4dff`에서 생성: 강조 `#cdbdff`, 바탕 `#14121c`, 1~3위 카드 `#2b2833`)·큰 순위 숫자·한 업체 한 행·업체색 총점 막대 하나
  (항목별로 투명도를 달리한 3구간 막대는 "이전 수치인가?"처럼 읽혀서 뺌).
  업체색은 빌드가 밝은 톤으로 올려 쓰고(`darkTone`), 업체색 위 글자는 **AAA(7:1) 이상**(호버 포함, `render.mjs`가 검사).
  **호버는 Material 상태 레이어만**: 카드 전체가 상세 링크(이름 링크를 카드 위로 늘림), 호버 8%·포커스 10% 덧칠. 테두리·색 바뀜·떠오르는 상세·왼쪽 막대 금지
  (`render.mjs`가 호버 전후로 카드 안 요소가 하나라도 바뀌면 실패).
  글꼴: Pretendard 자체 호스팅(외부 CDN 금지, OFL 라이선스 파일 함께 배포). 쓰는 굵기만 넣고 400·600은 preload. 서브셋에 없는 글자(▲▼)는 시스템 글꼴로 대체.
  키 컬러를 바꿀 때는 Material 색 도구로 씨앗 색 하나에서 역할 전체를 다시 만들고 `compose.mjs`의 `SURFACE`·`SURFACE_HIGH`, 로고·공유 이미지도 맞춘다.
  버튼: 상세 페이지의 주 행동만 채운 버튼. 목록 버튼은 혜택 칩보다 한 단계 흰 채운 칩(`--btn-fill`, 카드 위 흰색 약 24%, 테두리 없음,
  모서리 `--r-btn` 8px, 밝은 글자 600, 대비 7:1 이상). 혜택 칩은 채운 칩만(점선 칩 금지: 미완성처럼 보임).
  다크 글자: 본문 87%·보조 60% 흰색(`--on-surface`·`--on-surface-variant`), 굵기는 한 단계 가볍게(제목 600, 본문 400), 최소 14px, 줄 간격 1.7,
  글 줄 길이 42em 이하, 단락·섹션 여백 넉넉히. 메뉴가 열린 상태의 바깥 누름은 메뉴만 닫는다(아래 링크가 눌리지 않게).
  FAQ: 번호 칩(01~) 질문 카드(펼침 목록 아님, 답 항상 보임 = FAQPage 구조화 데이터와 일치). 첫 화면 FAQ 아래 "가입 전 확인표"(조언용, 업체별 점검처럼 쓰지 않음;
  휴대폰은 행을 블록으로 쌓음). 소유자가 준 참고 사이트에서 구조 원칙만 가져옴(문구·클래스 복제 금지).
  컨셉 장식(종이 질감, 굵은 검정 테두리·겹친 그림자, 사물 흉내 로고, 영문 장식 문구) 금지. 우상단 요약은 **배경 없는 옅은 패널**(왼쪽 선만)로 순위표보다 약하게, **줄글 없이 라벨+값 핵심 수치만**.
  스타일 값은 **`site.css :root`**에서만 수정.
- 시각 위계: 제목 → 1~3위 → 4~10위 → 나머지 순으로 눈이 가게. **1~3위는 항상 4위 이하보다 두 가지 이상 다르게 강조**(현재: 키 컬러를 살짝 비친 카드 `--podium-bg`·옅은 보라 테두리 `--podium-edge`·큰 순위 숫자, 데스크톱은 3단 카드.
  1위는 한 단계 더: `.is-first`로 더 진한 바탕·테두리, 데스크톱에서 더 넓은 칸과 더 큰 숫자. 바탕을 바꿀 때 보조 글자 AA 4.5 유지).
  첫 화면에서 순위 카드보다 눈에 띄는 상자(진한 배경 등) 금지. 머리글과 첫 상자 24px, 배경 있는 상자끼리 16px 이상(검사로 확인).
- SEO: 메인 title/h1에 **"웹하드 순위"+년·월**; 갱신일=`dateModified`. 상세 제목 `<업체> 순위·가입 혜택·이벤트 (<년.월>) | <브랜드>`. title **30~60자**, description **80~150자**.
  메인 JSON-LD(WebSite/CollectionPage/ItemList/FAQPage), 상세/기준 BreadcrumbList.
- 업체 공식 URL HTML 노출, 키워드 반복·숨김 글자·상호 링크·저품질 자동 페이지 금지. 상세의 타 업체 5곳은 주차·업체별 차별화.

## UI 어색함 검사 (`tests/ui-audit.mjs`)
- 가로 스크롤, 글자 잘림, 44px, 카드 밖 삐져나옴, 같은 줄 세로 중심 4px 초과, 한 줄 라벨 줄바꿈, 외톨이 줄(1~2글자), 단어 중간 끊김,
  줄 첫머리 문장부호, 홀로 떨어진 점수, 목록 간격 불균일, 대비 AA, 차트 라벨 겹침, 뭉개진 이미지·검은 테두리, 글자 크기 8종 초과,
  머리글·상자 간격, 화면 가장자리, 첫 화면에서 순위보다 튀는 상자.
- 극단 데이터(`tests/fixtures/edge-data.mjs`)로도 같은 검사. 통과해도 스크린샷 육안 확인; 새 어색함은 검사에 추가.

## 검증
```bash
node scripts/compose.mjs
node --test
node tests/render.mjs <폴더>
python3 .github/scripts/leak_guard.py _site
```

## 소유자 결정 사항
- 브랜드: 디스크차트(임시, `site.json`에서 변경). 공개 10곳. 하한 온디스크 3위·케이디스크 5위.
- 혜택은 2026-10 소유자 확인값. 빅파일 혜택은 웹 확인값이라 확인 전까지 숨김(`unconfirmed`).
- 남은 위험(소유자 조치 필요): 저장소 공개, 기본 주소에 계정 이름, GitHub 병합 커밋의 계정 시간대(+0900), 종료된 PR 기록에 남은 업체 원본 파일.
