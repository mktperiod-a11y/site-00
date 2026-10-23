# 작업 지침

웹하드(P2P) 주간 순위 정적 사이트. 이 문서는 저장소 안에서만 쓰며 배포 결과물(`_site/`)에는 들어가지 않는다.

## 1. 절대 원칙

### 운영자 신원 보호
- 코드·문서·커밋·PR에 사이트 도메인, GitHub 계정 이름, 저장소 이름, 본명, 이메일을 적지 않는다.
- 커밋 작성자·커미터 이메일은 GitHub 비공개 주소(users.noreply.github.com)만 쓴다. 커밋 메시지에 세션 링크를 넣지 않는다.
  커밋 전에 `git log --format='%ae %ce'`로 확인한다.
- 코드에는 주소 자리표시 `https://site-url.invalid/`만 둔다. 배포 워크플로가 `actions/configure-pages`의 `base_url`을
  `scripts/build.mjs --base-url`로 넘겨 바꾼다. 자리표시가 남으면 빌드와 배포가 멈춘다. `CNAME` 파일은 두지 않는다.
- 주소가 GitHub 기본 주소(`*.github.io`)이면 canonical·sitemap·구조화 데이터·og:url에 절대 주소를 쓰지 않고 상대 주소로 바꾼다
  (빌드가 자동 처리). 404 페이지만 루트 기준 경로를 쓴다. 자체 도메인을 연결하면 자동으로 절대 주소가 들어간다.
- 운영자 이름·연락처·사업자번호·주소·author 메타·개인 SNS, 다른 운영 사이트 링크를 넣지 않는다.
- 구글 서치콘솔 확인 코드, 분석·광고 ID, 빙 확인 코드를 넣지 않는다. 네이버 서치어드바이저 확인 코드는 소유자가 값을 줄 때만
  `data/site.json`의 `naverSiteVerification`에 넣는다.
- 이미지는 모두 sharp로 다시 저장한다(`scripts/assets.mjs`). 메타데이터 검사는 `.github/scripts/privacy_check.py`가 한다.
- 수집 요청의 User-Agent에 사이트 주소를 넣지 않는다. API 키는 GitHub Secrets에만 두고 로그에 찍지 않는다.
- README는 두지 않는다. `package.json`의 `name`은 일반 이름이다.
- 다른 사이트의 문구·클래스 이름·파일 구조·주석을 복사하지 않는다.

### 정직한 순위
- 화면에는 기준을 항목 이름(검색 관심도, 앱 이용 지표, 이용자 반응)까지만 적는다. 비중·세부 공식·보정 방법은 적지 않는다.
- 실제로 하지 않는 집계(클릭 수, 실시간 등)를 한다고 적지 않는다. 그 주에 값이 없는 항목은 "이번 주 값 없음"으로 표시된다.
- 최저 순위 조정이 실제로 있으므로, 화면에는 "운영 기준을 일부 더한 참고 순위", "일부 서비스는 운영 기준에 따라 순위가 조정될 수 있어요"
  수준으로만 알린다(방법은 적지 않는다). 이 문구를 지우면 "실제로 하는 것만 적는다" 원칙과 어긋난다.
- 지어낸 후기·평점·이용자 수를 넣지 않는다. 별점은 총점을 5점 만점으로 바꾼 값이며 화면에도 그렇게 안내한다.
- 혜택 문구는 소유자가 확인한 값만 화면에 낸다. 확인 전 값은 `"unconfirmed": true`로 두면 화면에서 빠진다.
- 제휴 링크(`affiliateUrl`)가 있으면 바로가기에 `rel="sponsored"`가 붙고 제휴 고지가 자동으로 나온다.

### 업체 목록
- 다루지 않는 업체 6곳은 이름을 저장소 어디에도 적지 않는다. 판별용 값은 `scripts/lib/rules.mjs`에 코드값으로만 있다.
  한글·영문 이름이나 주소가 어느 파일에든 들어가면 빌드·테스트가 실패한다. 다시 넣자는 요청이 오면 먼저 이 결정을 알린다.
- 후보는 `data/vendors.json`의 `status: "active"` 업체 전부다. 매주 같은 계산으로 공개 10자리 전부를 두고 겨룬다.
  고정 자리·예비 목록·빈자리 채우기 순서는 없다. 10위 밖 업체는 그 주 화면(카드·상세·이동 페이지)에서만 빠진다.
- 예외는 `data/site.json`의 `floors` 두 곳뿐: 온디스크 3위 이내, 케이디스크 5위 이내.
- 표에 없는 업체를 더할 때 주소를 추측하지 않는다. `status: "pending"`으로 넣고 소유자에게 확인할 목록으로 보고한다.
- 로고·아이콘은 업체가 쓰는 실제 파일만 쓴다. 없으면 이니셜 표시. 새로 그리거나 다른 로고에서 잘라 만들지 않는다.
- 사이트는 외부 이미지를 직접 불러오지 않는다. 받은 파일만 `src/static/`에 커밋한다.
- 이미지 받기는 네트워크가 열린 `assets.yml`(수동 실행)이나 로컬에서 한다. 로고 후보가 여러 개면 `data/assets.json`의
  `candidates`·`pick`으로 고르고, `crop`·`erase`로 장식을 잘라 낸다. 흰 글자 로고는 자동으로 어둡게 바꾼다.
  다시 받은 뒤에는 결과 이미지를 눈으로 확인하고(상자·잘린 조각·장식이 없는지) 커밋한다.
- 현재 로고 없음: 위디스크(받기 실패), 파일노리·지니파일·싸다파일·꿀파일(머리글에서 찾지 못함). 아이콘 없음: 위디스크(앱 없음).
  없는 이미지는 화면에서 업체 이름 첫 글자 표시로 대신한다.

### 혜택 문구
- `{"kind": "join"|"event", "text": "..."}`. "조건 + 혜택"을 16자 이내로("가입 1,000P", "앱 설치 2,000P").
  "~시", "지급", "진행 중" 꼬리말, 끝 문장부호, 날짜를 넣지 않는다(`benefitProblems`가 검사).
- 확인 날짜를 화면에 쓰지 않는다.

## 2. 구조

```
data/site.json        브랜드, 공개 수, 별점 하한, 최저 순위, 가중치, 평점 보정 강도
data/vendors.json     후보 업체(공식 주소, 앱 id, 업체 색, 혜택)
data/assets.json      로고 출처("header"는 공식 사이트 머리글에서 찾기)와 자르기·색 바꾸기 옵션
data/faq.json         첫 화면·기준 페이지 질문. {metrics:을/를}, {candidates}, {public} 치환
data/metrics.json     수집 값(검색 상대값, 스토어 다운로드·평점·평가 수). 실패 항목은 지난 값 유지
data/ranking.json     이번 주 계산 결과(항목별 점수, 총점, 별점, 변동)
data/history.json     주차별 전체 순서와 총점(최근 26주)
data/baseline.json    첫 수집 때의 metrics·ranking. "기본 값으로 돌려줘" → npm run baseline:restore
src/css, src/js       스타일·스크립트 원본(빌드 때 주석 제거, ?v=는 내용 해시로 자동 갱신)
src/img/brand.svg     브랜드 마크(직접 그림). favicon과 공유 이미지에 쓴다
src/static/           sharp로 다시 저장한 이미지(공유 이미지, 터치 아이콘, icon/, logo/)
scripts/build.mjs     유일한 빌드 스크립트(Node 내장 모듈만 사용)
scripts/collect.mjs   주간 지표 수집
scripts/rank.mjs      점수 계산 → ranking.json, history.json, (처음 한 번) baseline.json
scripts/assets.mjs    이미지 받기·다시 저장(sharp는 이 스크립트만 쓴다)
tests/                node --test 테스트, render.mjs(Playwright 4개 화면 폭 검사)
.github/scripts/privacy_check.py   개인정보 검사
.github/workflows/    checks(push·PR), deploy(main push·수동·주간 호출), weekly(월요일), assets(수동)
```

- 배포 결과물: `index.html`, `webhard/<id>/`, `criteria/`, `go/<id>/`, `404.html`, `sitemap.xml`, `robots.txt`,
  `llms.txt`, `assets/`, `favicon.svg`. `data/`·지침·스크립트·테스트·설정 파일은 나가지 않는다.
- 모든 HTML에 CSP(자기 사이트의 스크립트·스타일·이미지만, form-action·object 금지)와 referrer 메타가 있다.
  인라인 style 속성은 CSP에 막히므로 쓰지 않는다. 업체 색은 `.vc-<id>` 클래스, 별점 너비는 `.st-NN` 클래스로 빌드가 만든다.
- 이동 페이지는 주소를 base64로 바꿔 뒤집은 값을 인라인 스크립트로 푼다. 스크립트 해시를 그 페이지 CSP에 넣는다.
- 페이지 소스는 들여쓰기를 지키고 한 줄 140칸(한글 2칸)을 넘기지 않는다. 빌드가 긴 줄을 접고, 남으면 실패한다.
- 화면 폭 기준은 640px, 1024px 두 개.
- Pages Source는 "GitHub Actions"여야 한다(브랜치 배포 금지).

## 3. 주간 계산

1. `weekly.yml`이 매주 월요일 06:17 KST(일요일 21:17 UTC)에 돈다.
2. 검색 관심도: NAVER API HUB 검색어 트렌드(헤더 `X-NCP-APIGW-API-KEY-ID`·`X-NCP-APIGW-API-KEY`, Secrets
   `NAVER_CLIENT_ID`·`NAVER_CLIENT_SECRET`). 최근 4주, 주 단위. 한 번에 5개까지라 기준 업체 1곳 + 4곳씩 묶고
   기준 업체 값으로 나눠 맞춘다. 주소는 `naverapihub.apigw.ntruss.com/search-trend/v1/search`를 먼저, 안 되면
   `naveropenapi.apigw.ntruss.com/datalab/v1/search`를 쓴다(`NAVER_TREND_URL`로 바꿀 수 있다).
3. 앱 지표: 구글 플레이 한국 스토어 상세 페이지의 다운로드 수, 평점, 평가 수(앱 id가 있는 업체만).
4. 점수: 검색 log1p(상대값×100), 다운로드 log10, 평점은 평가 수가 적으면 전체 평균 쪽으로 당긴 값(`ratingPrior`)을
   후보 안에서 0~1로 맞추고 `weights`(40·35·25)로 합쳐 100점 만점. 값이 있는 항목만으로 비중을 다시 나눈다.
   항목이 하나도 없으면 그 주 계산에서 빠지고(pending) 목록에서는 지우지 않는다.
5. 총점(소수 첫째 자리) 순으로 후보 전체를 다시 세운다. 이동 폭·변경 수 상한 없음.
6. 최저 순위: 온디스크가 3위 밖이면 3위 자리의 업체보다 0.1점 높게, 케이디스크가 5위 밖이면 5위 자리의 업체보다 0.1점 높게
   총점을 올린다. 올린 만큼은 항목별 남은 여유에 비례해 나눠 더해, 화면의 항목 점수 합이 총점과 같게 한다.
   다른 업체는 손대지 않는다.
7. 별점 = 하한 3.6 + 1.4 × 총점/100 (3.6~5.0).
8. 지난주 순서와 비교해 ▲▼, 지난주 10위 밖이었으면 NEW, 첫 주는 –.
9. 수집 실패는 Actions 경고만 남기고 지난 값을 쓴다. API를 못 부른 주에도 배포는 정상으로 된다.
10. 데이터 커밋 뒤 `deploy.yml`을 불러 배포한다. 배포 전에 테스트와 개인정보 검사를 다시 돈다.

## 4. 검색 노출

- 첫 화면 title·h1에 "웹하드 순위"와 년·월, 갱신일은 화면과 `dateModified`에 함께.
- 업체 상세 `webhard/<id>/` 제목: "<업체> 순위·가입 혜택·이벤트 (<년.월>) | <브랜드>". 다른 웹하드 5곳은 주·업체마다 다르게 고른다.
- 구조화 데이터: 첫 화면 WebSite·CollectionPage(dateModified)·ItemList·FAQPage, 상세·기준 페이지 BreadcrumbList.
- 제목 30~60자, 설명 80~150자(빌드·테스트가 검사). 업체 공식 주소는 HTML에 넣지 않는다.
- 편법(키워드 반복, 숨긴 글자, 상호 링크, 저품질 자동 페이지) 금지.

## 5. 디자인

- 방향(이 사이트 고유): ① 밝은 종이 톤 바탕에 먹색 큰 숫자, 주간 음반 차트 지면 같은 분위기
  ② 한 줄에 한 업체가 놓이는 차트 행 + 데스크톱에서 오른쪽 위 요약 패널 ③ 업체 고유색 3구간 점수 막대, 가리키면 행이 업체 색으로 물든다.
- 고정 사용성: 첫 화면에 1~3위와 갱신일, 카드 안에 순위·이름·별점·혜택·바로가기, 360·768·1024·1440px 가로 스크롤 없음,
  누르는 영역 44px 이상, WCAG AA 대비, 키보드 포커스 표시, 모바일 메뉴는 버튼 하나(바깥 누르면·Esc로 닫힘),
  자바스크립트가 꺼져도 순위·혜택·링크가 보인다(`nojs.css`).
- 색·여백·모서리는 `src/css/site.css`의 `:root` 변수로만 바꾼다.

## 6. 확인 명령

```
node scripts/build.mjs            빌드(_site/)
node --test                       테스트
node tests/render.mjs <폴더>      Playwright 렌더 검사(+스크린샷)
python3 .github/scripts/privacy_check.py _site
```

## 7. 소유자 결정 사항

- 브랜드 이름: 디스크차트(소유자가 정하지 않아 임시로 정함, `data/site.json`에서 바꾼다).
- 공개 수 10곳. 최저 순위 온디스크 3위·케이디스크 5위.
- 혜택은 2026-10 소유자 확인값. 빅파일 혜택은 웹에서 찾은 값이라 확인 전까지 화면에서 뺀다(`unconfirmed`).
- 머지는 Squash만 쓴다(merge commit 금지).
