# 안건톡 (AngeonTalk)

건설 현장 업무 메신저 — 카카오톡과 동일한 사용성의 채팅 위에, 대화 중 등록한 "안건(Agenda)"이 전용 서브 채팅방과 AI 요약, 기술사례 자동 축적, 6개월 후 자동 추적으로 이어지는 프로토타입입니다.

`design_handoff_angeontalk/` 폴더의 와이어프레임/스펙을 기반으로 제작한 mid-fi 목업이며, 모바일 웹뷰에 최적화된 Next.js 앱입니다. 실제 채팅/AI/알림 백엔드는 없고, 모든 데이터는 브라우저 메모리(Zustand) 안에서만 동작합니다.

## 실행

```bash
npm install
npm run dev
```

`http://localhost:3000` 을 모바일 뷰포트(또는 브라우저 반응형 모드)로 열어 확인합니다.

## 주요 화면

- **채팅방 목록 / 마이페이지** — 하단 탭 2개
- **공종방** — 텍스트·사진·파일 전송 + `[+]` 메뉴에서 안건 등록
- **안건 올리기 / 도면 위치 지정** — 사진·AI 추론 칩·도면 핀
- **안건방** — AI 요약 카드, 도면 리비전 배너, 결정근거 태그, 상태/보고서/완료처리 액션
- **안건 리스트** — 진행중/완료 카운터, 필터, 방치 안건 경고
- **완료처리 → 기술사례 카드** — 3단계 완료 시트 → 기술사례 초안 승인/반려
- **사전검토 → 문제 적중** — 착공 전 사전검토 안건이 실제 이슈와 연결되는 카드
- **6개월 추적** — 마이페이지의 추적 알림 → 응답(이상없음/재발/확인어려움)

## 기술 스택

Next.js (App Router, static export) · TypeScript · Tailwind CSS v4 · Zustand · lucide-react · Capacitor (Android)

## 안드로이드 앱(.apk) 빌드

이 앱은 `output: "export"` 로 빌드되는 순수 정적 사이트라 [Capacitor](https://capacitorjs.com)로 감싸 네이티브 안드로이드 앱으로 만들 수 있습니다. (라우팅은 동적 세그먼트 대신 쿼리스트링(`/room?id=...`, `/agenda?no=...`)을 사용해 static export와 호환되도록 되어 있습니다.)

### 사전 준비

- Android Studio (또는 Android SDK cmdline-tools) + JDK 17+
- `ANDROID_HOME` / `ANDROID_SDK_ROOT` 환경변수가 SDK 경로를 가리켜야 함

### 빌드

```bash
npm install
npm run android:debug
```

위 명령은 `next build`(정적 export) → `cap sync android`(웹 산출물을 네이티브 프로젝트에 복사) → `gradlew assembleDebug` 순으로 실행되며, 결과물은 다음 경로에 생성됩니다.

```
android/app/build/outputs/apk/debug/app-debug.apk
```

이 apk를 안드로이드 기기에 옮겨 설치하면 됩니다(출처를 알 수 없는 앱 설치 허용 필요). Android Studio에서 `android/` 폴더를 직접 열어 실행/디버깅할 수도 있습니다.

앱 아이콘/스플래시는 Capacitor 기본값이며, `android/app/src/main/res/` 아이콘 리소스를 교체하면 커스터마이징할 수 있습니다.
