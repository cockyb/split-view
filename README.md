# Split View

여러 공개 라이브를 플랫폼 플레이어와 분리된 한 창에서 최대 네 개까지 재생하는 Chromium Manifest V3 확장입니다.

Split View는 커뮤니티가 만드는 비공식 오픈소스 프로젝트입니다. 특정 스트리밍 플랫폼과 제휴·승인·후원 관계가 없으며, 플랫폼 이름은 호환 대상을 설명하기 위해서만 사용합니다. 공식 로고나 브랜드 자산도 포함하지 않습니다.

## 주요 기능

- 최대 네 개 공개 라이브의 동시 배치
- 레이아웃, 오디오 포커스와 화질 제한
- 로컬 설정과 선택적 작업 공간 저장

현재 지원 소스는 치지직과 SOOP의 비로그인 공개 라이브입니다. 광고 필터링, 녹화, 다운로드, 재송출은 제공하지 않습니다. 인증·연령·구독·비밀번호·지역·DRM 또는 권리 제한 콘텐츠도 우회하거나 지원하지 않습니다. 자세한 근거와 운영 경계는 [플랫폼 정책 검토](docs/platform-policy-review.md)에 기록되어 있습니다.

## 개발

Node.js 22 이상과 pnpm을 사용합니다.

```bash
corepack enable
pnpm install
pnpm dev
```

`pnpm dev`를 실행하면 개발 빌드를 감시하면서 Split View가 자동 설치된 전용 Chrome 창을 엽니다. 이 창의 로그인과 권한 상태는 `.split-view-dev/`에 유지되며, 소스를 수정하면 빌드 완료 후 확장 프로그램이 자동으로 다시 로드됩니다. 종료할 때는 터미널에서 `Ctrl+C`를 누르거나 전용 Chrome 창을 닫습니다.

Chrome 실행 파일을 자동으로 찾지 못하면 경로를 지정할 수 있습니다.

```bash
SPLIT_VIEW_BROWSER_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" pnpm dev
```

테스트와 프로덕션 빌드는 별도로 실행합니다.

```bash
pnpm check
```

`pnpm build` 결과는 `dist/`에 생성됩니다. 자동 브라우저 실행 없이 빌드만 감시하려면 `pnpm dev:build`를 사용합니다.

## 사용

1. 지원하는 공개 라이브 페이지에서 확장 아이콘을 누릅니다.
2. 현재 방송을 열거나 라이브 URL을 직접 입력합니다.
3. 최초 재생 때 표시되는 해당 CDN origin 접근 요청을 확인하고 승인합니다.
4. 타일을 클릭해 해당 방송으로 오디오 포커스를 이동합니다.

플레이어 단축키는 `1`–`4`, `Space`, `M`, `F`, `Shift+F`, `L`, `A`/`+`, `[`/`]`, `Esc`입니다.

## 개인정보와 권한

- 별도 서버, 원격 분석 또는 광고 SDK를 사용하지 않습니다.
- 재생 세션 URL, AID, 서명 쿼리와 요청 컨텍스트를 작업 공간에 저장하지 않습니다.
- 플랫폼 API와 CDN 요청은 사용자의 브라우저에서 해당 서비스로 직접 전송됩니다.
- 동적으로 배정된 CDN은 재생 직전에 origin 단위 권한을 요청하며 설정에서 해제할 수 있습니다.

수집·보관 항목, 권한별 목적과 삭제 방법은 [개인정보 처리 안내](PRIVACY.md)를 확인해 주세요. 민감한 문제는 [보안 정책](SECURITY.md)에 따라 제보해 주세요.

## 배포

배포용 ZIP은 다음 명령으로 만듭니다. 프로젝트와 런타임 의존성의 라이선스 파일도 ZIP에 포함됩니다.

```bash
pnpm package
```

`package.json`과 `public/manifest.json`의 버전을 맞춘 뒤 `v0.1.0` 형식의 태그를 원격 저장소에 푸시하면 GitHub Actions가 테스트, ZIP 생성, SHA-256 체크섬과 GitHub Release 게시를 자동으로 수행합니다.

Chrome Web Store 최초 등록은 개발자 계정, 2단계 인증, 스토어 설명·개인정보 항목과 심사가 필요하므로 자동화하지 않습니다. 최초 항목 생성 후에는 공식 [Chrome Web Store API](https://developer.chrome.com/docs/webstore/using-api)를 이용한 업로드 자동화를 별도로 연결할 수 있습니다.

## 오픈소스

Split View 코드는 [MIT License](LICENSE)로 공개합니다. 런타임 의존성의 저작권과 라이선스는 [Third-party notices](THIRD_PARTY_NOTICES.md)를 확인해 주세요. 이 라이선스는 제3자 방송 콘텐츠, 플랫폼 상표 또는 서비스 접근 권리를 부여하지 않습니다.

기여 전에 [기여 가이드](CONTRIBUTING.md)의 기능 경계와 비밀정보 처리 원칙을 확인해 주세요. 제품과 기술 결정은 [설계 문서](docs/specs/2026-08-26-split-view-design.md)에 정리되어 있습니다.
