# CLAUDE.md

> 웹하드(P2P) 주간 순위 정적 사이트의 작업 메모. 저장소 전용이며 배포 결과물(`_site/`)에는 넣지 않는다.
> **작업 전에 소유자에게 작업 지침과 보관 정보를 받는다.** 이 파일에는 공개돼도 되는 기술 메모만 둔다.
> 받은 지침의 내용·이유는 파일·커밋 메시지·PR·코드 주석에 옮기지 않는다. 커밋·PR에는 무엇을 바꿨는지만 쓴다.

## 기술
- Node.js ESM, 내장 모듈만: `scripts/compose.mjs`(빌드), `gather.mjs`(지표 수집), `standings.mjs`(순위 계산).
- 이미지: Sharp는 `scripts/imagery.mjs`에서만. 사이트는 외부 이미지·글꼴·스크립트를 불러오지 않는다.
- 공유 이미지(`og.png`, `touch-icon.png`): `node scripts/imagery.mjs brand`(Pretendard를 fontTools로 풀어 씀). 기본 github 주소에서도 `og:url`·`og:image`만 전체 주소로 쓴다.
- 배포: GitHub Actions → Pages(Source = GitHub Actions). 워크플로 `verify`(push·PR), `publish`(main·수동·주간 호출), `refresh`(주간), `images`(수동).
- 테스트: `node --test`, Playwright 렌더 검사(`tests/render.mjs`, `tests/ui-audit.mjs`), 저장소 검사(`.github/scripts/leak_guard.py`).

## 폴더·데이터
```text
data/site.json          브랜드, 공개 수, 계산 설정 해시(recipeHash)
data/vendors.json       업체(id, 이름, status, 주소, 앱 id, 색, 혜택)
data/assets.json        이미지 받기 옵션(candidates/pick/crop/erase)
data/faq.json           FAQ 문구({metrics:을/를}, {candidates}, {public} 치환)
data/metrics.json       수집 지표(실패한 항목은 지난 값 유지)
data/ranking.json       이번 주 순위(점수는 0~100으로 저장, scale은 표시 단위)
data/history.json       주차별 순서·총점(최근 26주)
data/first-week.json    첫 수집값(복원: npm run baseline:restore)
src/css/site.css        :root 디자인 변수, @font-face
src/css/nojs.css        자바스크립트 꺼짐 화면
src/js/site.js          메뉴만
src/img/brand.svg       브랜드 마크
src/static/             재저장 이미지(og.png, touch-icon.png, icon/, logo/), font/(Pretendard 서브셋 400·500·600·700, OFL.txt)
scripts/lib/rules.mjs   공통 규칙, 금지 이름 판별값, 주소 자리표시
scripts/lib/score.mjs   점수 계산, scripts/lib/play.mjs 스토어 페이지 해석
tests/                  단위·빌드 테스트, render.mjs·ui-audit.mjs, fixtures/edge-data.mjs
```
- `vendors.json`의 `status`: `active`(순위 계산), `pending`(정보 확인 전), `excluded`(데이터만 보관, 순위·화면·기록에서 뺌).
- 혜택: `{kind: "join"|"event", text}`, 16자 이내, 날짜·마침표·"~시"·"지급"·"진행 중" 금지(`benefitProblems`가 검사). `unconfirmed: true`는 화면에서 뺀다.
- `rules.mjs`의 금지 이름이 저장소·결과물에 나오면 빌드와 테스트가 실패한다.

## 주간 갱신
- `refresh.yml`: `gather.mjs` → `standings.mjs` → 빌드·테스트 → `data/` 커밋 → `publish.yml`.
- 계산 설정은 워크플로가 Secret에서 `RANK_RECIPE` 환경 변수로만 넘긴다. 설정이 없거나 `site.json#recipeHash`와 다르면 지난 순위를 그대로 두고 경고만 남긴다.
  로컬에서 다시 계산할 때도 소유자에게 받은 값을 환경 변수로만 넣는다. 설정 값은 파일·커밋·로그에 쓰지 않는다.
- 수집 실패 시 지난 지표를 쓰고 배포는 계속한다. 비밀 값은 로그에 찍지 않는다.

## 커밋·배포
- 작성자·커미터는 GitHub no-reply 주소. 커밋은 `TZ=UTC`. `git log --format='%ae %ce'`로 확인.
- 브랜치 → PR → Squash 병합만. 병합 직후 병합 커밋 이메일 확인.
- 배포 시 `configure-pages`의 `base_url`을 `compose.mjs --base-url`로 넘긴다(코드의 주소 자리표시가 남으면 실패). `README`·`CNAME` 두지 않음.

## 화면
- 다크 모드, Material 3 다크 역할(키 컬러 보라 `#7c4dff`에서 생성). 색·여백·모서리는 `site.css :root` 변수로만.
- 글꼴 Pretendard(자체 호스팅, OFL 파일 함께). 본문 87%·보조 60% 흰색, 제목 600·본문 400, 최소 14px, 줄 간격 1.7, 글 줄 길이 42em 이하.
- 첫 화면: 주차 칩·제목·고지 한 줄·순위표(머리에 갱신일 상태 줄). 잔정보(부제·다음 갱신일·N일 전) 넣지 않음.
- 1~3위는 4위 이하와 두 가지 이상 다르게(키 컬러 비친 카드·옅은 보라 테두리·큰 숫자, 1위는 한 단계 더). 4~10위는 한 행씩.
- 점수 막대는 총점 하나. 점수는 `compose.mjs`의 `pts`로 표시 단위에 맞춘다.
- 호버는 상태 레이어만(8%, 포커스 10%). 카드 전체가 상세 링크, 바로가기는 그 위에 따로. 업체색 위 글자 7:1 이상.
- 버튼: 상세 페이지 주 행동만 채운 버튼. 목록 바로가기는 혜택 칩보다 한 단계 흰 채운 칩(`--btn-fill`). 점선 칩 금지.
- FAQ는 번호 카드(답 항상 보임), 첫 화면은 아래에 "가입 전 확인표". 기준 설명은 항목 이름과 쉬운 한 줄만.
- CSP·referrer 모든 페이지, 인라인 style 금지(`.vc-<id>`·`.st-NN`은 빌드가 생성). HTML 한 줄 140칸(한글 2칸).
- SEO: 메인 title·h1에 "웹하드 순위"+년·월, 갱신일 = `dateModified`. title 30~60자, description 80~150자.

## 렌더 검사 (`tests/ui-audit.mjs`, `tests/render.mjs`)
가로 스크롤, 글자 잘림, 44px, 카드 밖 삐져나옴, 같은 줄 세로 중심 4px 초과, 라벨 줄바꿈, 외톨이 줄, 단어 중간 끊김, 줄 첫머리 문장부호,
홀로 떨어진 점수, 목록 간격, 대비 AA, 차트 라벨 겹침, 뭉개진 이미지, 글자 크기 8종 초과, 상자 간격, 화면 가장자리, 첫 화면에서 순위보다 튀는 상자,
1~3위 강조, 호버 때 카드 안 변화 없음, 호버 대비 7:1, 메뉴 바깥 누름은 메뉴만 닫기. 극단 데이터(`tests/fixtures/edge-data.mjs`)로도 같은 검사.
통과해도 스크린샷을 눈으로 본다.

## 검증
```bash
node scripts/compose.mjs
node --test
node tests/render.mjs <폴더>
python3 .github/scripts/leak_guard.py _site
```
