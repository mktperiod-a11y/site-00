# CLAUDE.md

> 웹하드(P2P) 주간 순위 **정적 사이트**. 이 파일은 저장소 전용; **`_site/` 배포 금지**.

## 기술·스택
- **Node.js ESM**: `scripts/build.mjs`(내장 모듈만), `collect.mjs`, `rank.mjs`.
- **이미지**: Sharp(`scripts/assets.mjs` 전용), 외부 이미지 직접 로딩 금지.
- **CI/CD**: GitHub Pages + Actions(`checks`, `deploy`, `weekly`, `assets`); **Pages Source=GitHub Actions**.
- **테스트**: `node --test`, Playwright(360/768/1024/1440px), Python 개인정보 검사.

## 폴더·데이터
```text
data/site.json          브랜드·공개 수(10)·weights·floors·별점 설정
data/vendors.json       업체·status·주소·앱 ID·혜택
data/assets.json        이미지 소스·pick/crop/erase
data/faq.json           FAQ·치환값
data/metrics.json       수집 지표(실패 시 이전 값)
data/ranking.json       현재 점수·순위·변동
data/history.json       26주 기록
data/baseline.json      최초 기준값(복원: npm run baseline:restore)
src/css, src/js         스타일·스크립트 원본
src/css/site.css        :root 디자인 변수
src/img/brand.svg       브랜드 마크
src/static/             Sharp 재저장 이미지
scripts/{build,collect,rank,assets}.mjs
scripts/lib/rules.mjs   제외 업체 코드
.github/workflows/      checks/deploy/weekly/assets
.github/scripts/privacy_check.py
tests/                  단위·렌더 테스트
```

## **P0 — 절대 변경 금지**

### **운영자 보호·보안**
- **실제 도메인·GitHub 계정/저장소명·본명·연락처·SNS·다른 운영 사이트를 코드/문서/커밋/PR에 기록 금지**. `README`, `CNAME`, author 메타 금지; `package.json#name`은 일반명.
- **Git 작성자·커미터: `users.noreply.github.com`만**. `git log --format='%ae %ce'` 확인; 세션 링크 커밋 금지. **Squash merge만**.
- 소스 주소: **`https://site-url.invalid/`**; 배포 시 `actions/configure-pages`의 `base_url` → `build.mjs --base-url`. 자리표시 남으면 실패.
- `*.github.io`는 canonical/sitemap/JSON-LD/og:url **상대 URL**(404만 루트 경로); 자체 도메인은 절대 URL.
- **API 키=GitHub Secrets만**; 로그·User-Agent에 키/도메인 금지. 구글·빙 인증/분석·광고 ID 금지. 네이버 인증은 소유자 제공 시만 `site.json#naverSiteVerification`.
- 이미지 **Sharp 재저장 + 개인정보 검사**. 타 사이트 문구·클래스·파일 구조·주석 복제 금지.

### **업체·순위**
- **제외된 6개 업체명/주소는 저장소 어디에도 금지**(판별값: `scripts/lib/rules.mjs`). 재추가 요청 시 결정사항 안내.
- **`vendors.json`의 `active` 전부 동일 산식으로 경쟁 → 상위 10개 공개**. 고정 슬롯·예비 순서·빈자리 채우기 금지; 탈락 업체 자체 삭제 금지.
- **유일한 순위 하한: 온디스크 3위 이내, 케이디스크 5위 이내**(`site.json#floors`). 다른 업체 임의 조정 금지.
- 신규 업체 URL 추측 금지 → **`pending` 등록 후 확인**. 실제 로고/아이콘만 사용; 없으면 **첫 글자 대체**. 로컬/수동 `assets.yml`에서 받아 `src/static/`에 저장·육안 검수.

### **표현·혜택**
- 공개 기준은 **검색 관심도·앱 이용 지표·이용자 반응** 명칭만. **비중·산식·보정 방식 비공개**.
- 가짜 클릭/실시간 집계·후기·평점·이용자 수 금지. 데이터 부재 → **"이번 주 값 없음"**.
- **순위 조정 고지 유지**: "운영 기준을 일부 더한 참고 순위" 또는 "일부 서비스는 운영 기준에 따라 순위가 조정될 수 있어요". 방법 공개 금지.
- 별점은 **총점의 5점 환산값**임을 표시. 혜택은 **소유자 확인값만**(`unconfirmed: true` 제외). `affiliateUrl` → `rel="sponsored"` + 제휴 고지.
- 혜택 `{kind: "join"|"event", text}`: **조건+혜택 16자 이내**. 날짜·확인일·마침표·"~시"·"지급"·"진행 중" 금지.

## 산정·배포 불변 조건
- **월요일 06:17 KST** `weekly.yml` → 수집/산정/데이터 커밋 → `deploy.yml`(테스트·개인정보 재검사).
- NAVER 검색어 트렌드 **최근 4주/주간**, 기준 업체 1+비교 4씩 상대 정규화(API HUB → DataLab). Secrets: `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET`; `NAVER_TREND_URL` 선택.
- Google Play **한국** 스토어 다운로드·평점·평가 수(앱 ID 보유 시).
- **가중치 40/35/25**: 검색 `log1p`, 다운로드 `log10`, 평점 `ratingPrior` → 후보 내 0~1 → 100점. 누락 지표는 가중치 재분배; 전부 누락이면 해당 주 산정만 제외(`pending`).
- 순위 하한 미충족 시 경계 업체보다 **+0.1점**, 증가분 항목별 잔여 여유 비례 배분(항목 합=총점). 총점 소수 첫째 자리; 이동 상한 없음.
- **별점 `3.6+1.4×총점/100`**; 전주 ▲▼ / 10위 밖 `NEW` / 첫 주 `–`. 수집 실패 시 **지난 지표 재사용, 배포 유지**.

## UI·SEO·출력
- **`_site/`에는 공개 HTML/assets/sitemap/robots/llms/favicon만**. `data/`·소스·테스트·설정 제외.
- **CSP/referrer 전체 적용**, 인라인 `style` 금지; `.vc-<id>`/`.st-NN` 빌드 생성. 이동 페이지 인라인 스크립트에 CSP 해시. HTML **140칸 제한**(한글 2칸).
- 메인 1~3위·갱신일; 카드 순위·업체·별점·혜택·링크. **44px 터치 영역, WCAG AA, 키보드 포커스, 가로 스크롤 금지, JS 없이 주요 콘텐츠 표시**. 모바일 메뉴 바깥 클릭/Esc 닫기.
- 디자인: 밝은 종이 톤·큰 순위 숫자·한 업체 한 행·우상단 요약·업체색 3구간 막대. 스타일 값은 **`site.css :root`**에서만 수정.
- SEO: 메인 title/h1에 **"웹하드 순위"+년·월**; 갱신일=`dateModified`. 상세 제목 `<업체> 순위·가입 혜택·이벤트 (<년.월>) | <브랜드>`. title **30~60자**, description **80~150자**. 메인 JSON-LD(WebSite/CollectionPage/ItemList/FAQPage), 상세/기준 BreadcrumbList.
- 업체 공식 URL HTML 노출, 키워드 반복·숨김 글자·상호 링크·저품질 자동 페이지 금지. 상세의 타 업체 5곳은 주차·업체별 차별화.

## 검증
```bash
node scripts/build.mjs
node --test
node tests/render.mjs <폴더>
python3 .github/scripts/privacy_check.py _site
```
