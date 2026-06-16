- 2026-06-15, Gemini

# JUCE C++ 네이티브 오디오 엔진 마이그레이션 — 1단계: 아키텍처 및 IPC 설계

본 계획서는 **Phase 4: JUCE C++ 네이티브 오디오 엔진 마이그레이션**의 첫 번째 단계인 **JUCE 엔진 아키텍처 수립 및 Electron과의 IPC 프로토콜 설계**를 다룹니다.

## User Review Required

> [!IMPORTANT]
> **오디오 엔진 구동 방식 (서브프로세스 데몬 방식 채택)**
> - Electron의 Node Native Addon(`.node`)으로 연동하는 방식은 Electron/Node.js 버전 간 ABI 호환성 문제(재컴파일 지옥)가 잦고, 오디오 엔진 크래시가 UI 전체 크래시로 이어집니다.
> - 따라서, **JUCE C++ 엔진을 독립된 경량 콘솔 백그라운드 프로세스(Daemon)로 빌드**하고, Electron과 **로컬 웹소켓(WebSocket) 또는 TCP 소켓**을 통해 JSON 메시지로 IPC 통신을 수행하는 구조를 제안합니다. 이 방식이 디버깅, 빌드 자동화, 플랫폼 이식성 측면에서 가장 안정적입니다.

> [!WARNING]
> **Web Audio API Fallback 보장**
> - 데스크톱 앱 실행 시 네이티브 바이너리(`FocusDAW-AudioEngine.exe`) 로드 실패 또는 포트 충돌이 생길 경우를 대비해, UI 단에서는 기존 Web Audio API 기반 오디오 엔진(`audio-engine.js`)으로 즉시 Fallback할 수 있는 하이브리드 어댑터 구조를 UI 및 브릿지 레이어에 적용할 예정입니다.

## Open Questions

- **웹소켓(WebSocket) vs TCP Raw Socket**: Electron과 JUCE 간의 통신으로 WebSocket이 프론트엔드 React 브라우저 환경에서 직접 연결하기 가장 편리(브라우저 표준 API `new WebSocket()`)하지만, TCP Raw Socket도 가능합니다. WebSocket 방식을 기본 제안합니다. 사용하시는 개발 환경에 다른 선호 방식이 있으시다면 피드백 부탁드립니다.

---

## Proposed Changes

이번 1단계에서는 실제 믹싱 로직을 구현하기 전에 **통신 규격(IPC Protocol) 정의**와 **초기 JUCE C++ 콘솔 프로젝트 스켈레톤** 생성, 그리고 Electron 단에서의 **네이티브 프로세스 실행 및 통신 브릿지**를 구성합니다.

### 1. IPC 프로토콜 명세 (JSON 규격)

Electron과 JUCE 엔진 간에 전송될 메시지 타입과 구조를 정의합니다.

#### Electron ➔ JUCE (제어 명령)
- **초기화 및 디바이스 설정**:
  ```json
  { "command": "init", "sampleRate": 44100, "bufferSize": 512 }
  ```
- **트랙 로드**:
  ```json
  { "command": "loadTrack", "trackId": "track_1", "filePath": "D:/audio/stem_drums.wav" }
  ```
- **파라미터 변경 (볼륨, 팬, 뮤트, 솔로, 키 변경)**:
  ```json
  { "command": "setTrackParam", "trackId": "track_1", "param": "volume", "value": 0.8 }
  { "command": "setTrackParam", "trackId": "track_1", "param": "pan", "value": -0.2 }
  { "command": "setTrackParam", "trackId": "track_1", "param": "mute", "value": false }
  { "command": "setTrackParam", "trackId": "track_1", "param": "solo", "value": true }
  { "command": "setTrackParam", "trackId": "track_1", "param": "keyShift", "value": 1 }  // 반음(+1) 단위 Key 변경
  ```
- **전역 설정 (BPM, 재생 속도)**:
  ```json
  { "command": "setTempo", "bpm": 125.0, "variBpm": true }
  ```
- **트랜스포트 제어**:
  ```json
  { "command": "play" }
  { "command": "stop" }
  { "command": "seek", "positionSeconds": 15.5 }
  ```
- **오프라인 렌더링 (내보내기)**:
  ```json
  { "command": "export", "outputPath": "D:/export/output.mp3", "format": "mp3", "lufs": -14.0 }
  ```

#### JUCE ➔ Electron (상태 피드백)
- **재생 헤드 동기화 (상시 송신, 약 60fps)**:
  ```json
  { "event": "playbackPosition", "positionSeconds": 1.234 }
  ```
- **레벨 메터 정보**:
  ```json
  { "event": "levels", "master": { "left": 0.75, "right": 0.72 }, "tracks": { "track_1": 0.6 } }
  ```
- **트랙 로딩 완료 피드백**:
  ```json
  { "event": "trackLoaded", "trackId": "track_1", "duration": 240.2, "detectedBpm": 120.0 }
  ```
- **내보내기 진행 상태**:
  ```json
  { "event": "exportProgress", "progress": 0.45 }
  ```

---

### 2. 구성 파일 목록

#### [NEW] [juce_skeleton](file:///d:/roseWorks/programming/FocusDAW-Studio/juce_skeleton)
- JUCE 콘솔 기반의 독립 실행 바이너리를 빌드하기 위한 CMake 및 C++ 기본 프로젝트 구조를 생성합니다.
- `CMakeLists.txt`: JUCE 모듈 연동 및 빌드 설정 정의.
- `Main.cpp`: JUCE 앱 진입점 및 로컬 웹소켓 서버(예: `juce::StreamingSocket` 또는 C++ WebSocket 라이브러리 사용) 초기화.
- `AudioEngineCore.h / .cpp`: JUCE 오디오 그래프 관리 핵심 클래스 구조 설계.

#### [MODIFY] [main.js](file:///d:/roseWorks/programming/FocusDAW-Studio/electron/main.js)
- Electron 앱 기동 시 `FocusDAW-AudioEngine` 서브프로세스를 동적으로 생성(`child_process.spawn`) 및 생명주기 제어 로직 구현.
- 개발 환경 및 배포 패키지 환경에서의 바이너리 실행 경로 분기 처리.

#### [NEW] [audio-bridge.js](file:///d:/roseWorks/programming/FocusDAW-Studio/audio-bridge.js)
- 기존 `audio-engine.js`와 동일한 API 인터페이스(Duck-Typing)를 제공하여 UI 코드 수정을 최소화하는 통신 브릿지 어댑터 클래스.
- 네이티브 엔진 활성화 상태에 따라 명령을 WebSocket을 통해 C++ 엔진으로 전송하거나, Web Audio API 로컬 엔진(`audio-engine.js`)으로 분기.

---

## Verification Plan

### 수동 및 통합 검증
1. **서브프로세스 기동 검증**: Electron 앱 실행 시 C++ 스켈레톤 데몬 프로세스가 백그라운드에서 백그라운드로 성공적으로 실행되는지 프로세스 관리자 확인.
2. **IPC 통신 테스트**: Electron과 JUCE 간의 로컬 소켓 연결 성립 확인 및 최초 `init` 명령 송수신 시 콘솔 로그 출력 확인.
3. **Fallback 검증**: JUCE 데몬 바이너리가 없거나 실행에 실패할 때, 오류 다이얼로그 노출 없이 기존 Web Audio API 로컬 엔진으로 정상 폴백되어 오디오가 재생되는지 검증.
