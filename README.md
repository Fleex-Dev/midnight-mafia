# 심야 마피아

같은 공간에 있는 참가자들이 각자의 휴대폰으로 역할을 확인하고 행동·투표하는 실시간 마피아 게임입니다. Cloudflare Workers의 정적 자산과 Durable Objects를 사용해 별도 서버나 Redis 없이 배포합니다.

## 구조

- Cloudflare Worker: 정적 파일, API와 방 라우팅
- Durable Object: 방 하나의 참가자·역할·행동·투표 상태와 WebSocket 연결
- SQLite 기반 Durable Objects Storage: 방 상태 복구
- WebSocket Hibernation: 연결을 유지하면서 유휴 실행 시간 절약
- Durable Objects Alarm: 연결 종료 유예와 비활성 방 정리

게임방은 마지막 활동 후 최대 8시간 동안 보존됩니다. 연결이 끊긴 참가자는 30분 안에 같은 브라우저로 돌아오면 기존 참가 정보로 복구됩니다. 화면을 다시 켜거나 네트워크가 돌아오면 자동으로 재연결합니다.

## 게임 흐름

1. 방장이 방을 만들고 경찰·의사 포함 여부를 선택합니다.
2. 4~12명이 참가하면 방장이 게임을 시작합니다.
3. 모두 역할을 확인하고 준비하면 투표 없는 첫 번째 낮이 시작됩니다.
4. 첫 낮의 대화를 마치고 모두 준비하면 첫 번째 밤으로 넘어갑니다.
5. 역할별 밤 행동이 모두 끝나면 서버가 즉시 다음 낮을 시작합니다.
6. 이후 낮에는 모든 생존자가 준비하면 투표합니다. 투표 결과 화면에서 탈락자와 역할을 확인한 뒤 생존자 전원이 확인하면 다음 밤 또는 게임 종료로 넘어갑니다.

## 로컬 실행

Node.js 20 이상이 필요합니다.

```bash
npm install
npm start
```

Wrangler 로컬 주소는 기본적으로 `http://localhost:8787`입니다. 다른 기기에서 시험하려면 다음처럼 네트워크 인터페이스를 열고, 터미널에 표시되는 컴퓨터의 Wi-Fi 주소로 접속하세요.

```bash
npm start -- --ip 0.0.0.0
```

Cloudflare 배포 구조에서는 별도의 `.env` 파일이 필요하지 않습니다. 추후 비밀 값이 추가되면 로컬에서는 `.dev.vars`, 배포 환경에서는 Cloudflare Secrets를 사용하세요.

## 테스트와 배포 검사

```bash
npm test
npm run deploy:check
```

게임 단계 전환, 닉네임 중복, 방장 위임, 참가자 이탈, QR 경로, 템플릿과 안내 페이지를 자동 검사합니다. `deploy:check`는 실제 업로드 없이 Worker 번들과 Durable Object 바인딩을 확인합니다.

## Cloudflare 직접 배포

Wrangler로 배포하려면 먼저 Cloudflare 계정에 로그인한 뒤 실행합니다.

```bash
npx wrangler login
npm run deploy
```

배포 설정은 [wrangler.jsonc](./wrangler.jsonc)에 있습니다. 첫 배포 시 SQLite 기반 `RoomDurableObject` 네임스페이스가 자동으로 생성됩니다.

## GitHub 자동 배포

1. 프로젝트를 GitHub 저장소에 push합니다.
2. Cloudflare 대시보드에서 **Workers & Pages → Create application → Import a repository**를 선택합니다.
3. GitHub 저장소와 운영 브랜치를 연결합니다.
4. Build command는 `npm ci`, Deploy command는 `npx wrangler deploy`로 설정합니다.
5. 별도 환경 변수 없이 첫 배포를 실행합니다.

Durable Objects를 사용하는 프로젝트는 일반 Worker와 Preview 동작이 다를 수 있으므로 운영 브랜치 배포 전 `npm run deploy:check`와 로컬 다중 접속 테스트를 먼저 실행하세요.

## 주요 파일

- `src/worker.js`: Worker 라우터, Durable Object, WebSocket과 영구 상태
- `src/game.js`: 방, 역할, 행동, 투표와 승리 판정
- `wrangler.jsonc`: 정적 자산과 Durable Objects 배포 설정
- `public/app.js`: 브라우저 상태, 자동 재연결과 이벤트 처리
- `public/js/screens.js`: 단계별 화면 렌더링
- `public/templates/`: 화면별 HTML 템플릿
- `public/i18n.js`: 한국어·영어 번역
- `public/icons/game/`: 역할 SVG 아이콘
- `test/`: 자동 테스트

게임 데이터에는 닉네임, 임시 인증 토큰, 역할과 선택 정보가 포함됩니다. 방 상태는 방별 Durable Object에만 저장되며 공개 정적 파일에는 포함되지 않습니다.
