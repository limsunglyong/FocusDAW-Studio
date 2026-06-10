# FocusDAW Studio

**FocusDAW Studio** is a desktop stem-mixing DAW built with Electron. It lets you import separated audio stems, balance each track, draw volume automation, shape the master with EQ and output effects, and export a final MP3 or WAV mixdown.

## Features

- Import audio files or an entire stem folder
- Manage sessions with `.focus` project files
- View multi-track waveforms on a timeline
- Adjust track volume, pan, solo, mute, reverb, and echo
- Draw and edit volume automation points per track
- Smooth automation curves with the Curve option
- Control master fade in/out from the OUTPUT FX track
- Mix with a floating mixer window
- Shape the final sound with a 9-band master EQ and FFT view
- Export MP3 or WAV with metadata tags and optional MP3 album art
- Switch between built-in color themes

## Supported Formats

Input audio:

`mp3`, `wav`, `aif`, `aiff`, `m4a`, `ogg`, `flac`

Project files:

`.focus`

Export formats:

`mp3`, `wav`

## Getting Started

Install dependencies:

```bash
npm install
```

Run the app:

```bash
npm start
```

Build installers:

```bash
npm run dist:win
npm run dist:mac
npm run dist:linux
```

## Manual

The user manual is available in Korean:

[`manual/사용자 메뉴얼.html`](manual/사용자%20메뉴얼.html)

---

# FocusDAW Studio 한국어 소개

**FocusDAW Studio**는 Electron 기반의 데스크톱 스템 믹싱 DAW입니다. 분리된 오디오 스템을 불러와 트랙별 볼륨과 팬을 조정하고, 볼륨 오토메이션과 마스터 EQ, Fade in/out, 출력 효과를 적용한 뒤 MP3 또는 WAV로 최종 믹스다운을 저장할 수 있습니다.

## 주요 기능

- 오디오 파일 또는 스템 폴더 가져오기
- `.focus` 프로젝트 파일 저장 및 열기
- 멀티트랙 파형 타임라인 보기
- 트랙별 볼륨, 팬, 솔로, 뮤트, 리버브, 에코 조정
- 트랙별 볼륨 오토메이션 편집점 추가, 이동, 삭제
- Curve 옵션으로 부드러운 오토메이션 곡선 적용
- OUTPUT FX 트랙에서 Master Fade in/out 조정
- 별도 믹서 창에서 트랙별 PAN과 Gain 조정
- 9밴드 Master EQ와 FFT 화면으로 최종 사운드 보정
- MP3/WAV 내보내기 및 오디오 태그 입력
- MP3 앨범 아트 삽입
- 내장 색상 테마 변경

## 지원 형식

입력 오디오:

`mp3`, `wav`, `aif`, `aiff`, `m4a`, `ogg`, `flac`

프로젝트 파일:

`.focus`

내보내기:

`mp3`, `wav`

## 실행 방법

의존성 설치:

```bash
npm install
```

앱 실행:

```bash
npm start
```

설치 파일 빌드:

```bash
npm run dist:win
npm run dist:mac
npm run dist:linux
```

## 사용자 매뉴얼

한국어 사용자 매뉴얼:

[`manual/사용자 메뉴얼.html`](manual/사용자%20메뉴얼.html)
