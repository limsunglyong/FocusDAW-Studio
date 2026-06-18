# Export 절차 — 곡 불러오기부터 MP3 저장까지

> 대상 버전: **v1.9.5** 기준
> 이 문서는 사용자가 스템을 불러오고, 효과를 적용하고, 최종 MP3(또는 WAV)로 내보내기까지
> **어느 단계에서 어떤 사용자 설정이 어떻게 신호에 반영되는지**를 단계별로 정리한 것입니다.

---

## 0. 한눈에 보는 전체 흐름

```
[1] 스템 불러오기            오디오 파일 → 디코드(PCM) → 트랙 생성
        │                    (app.jsx → audio-engine.js: addFileBuffer/addFile)
        ▼
[2] 사용자 효과 설정          트랙별 파라미터 + 마스터 파라미터를 "엔진 상태"에 저장
        │                    (믹서 / Advanced Effects 창 → DAW.master, track.params, clips)
        ▼
[3] Export 실행              Export 창 Render 클릭 → 렌더 경로 분기
        │                    (ui-dialogs.jsx: ExportDialog.render)
        ▼
[4] 믹스 렌더링              저장된 모든 설정으로 오프라인 믹스다운 생성
        │                    (audio-engine.js: renderMix  /  네이티브 JUCE 엔진)
        ▼
[5] 후처리                   템포(피치 보존)·라우드니스(LUFS) 보정 (선택)
        │                    (electron/main.js: process-audio / loudnorm·atempo)
        ▼
[6] 인코딩                   MP3(ffmpeg 또는 lamejs) / WAV
        │                    + 태그(ID3v2) + 커버 아트
        ▼
[7] 파일 저장                Save file → .mp3 / .wav 디스크 기록
                             (electron/main.js: save-native-audio / save-audio)
```

핵심 원칙: **모든 사용자 효과는 “재생 중”에 즉시 거는 것이 아니라, 엔진 상태(`DAW.master`, 각 `track.params`, `clips`)에 값으로 저장**됩니다. Export는 이 저장된 값으로 **동일한 신호 그래프를 오프라인으로 다시 구성**해 한 번에 렌더링합니다. 그래서 모니터링으로 듣던 소리와 내보낸 파일이 일치합니다.

---

## 1단계 — 스템(곡) 불러오기

진입점: 초기 화면의 **Import Folder / Import Files**, 메뉴 `Project ▸ Import…`, 또는 드래그 앤 드롭.

1. 파일을 읽어 `ArrayBuffer`로 가져옵니다.
   - 데스크톱(Electron): `electronAPI.readAudioFile(path)` 로 원본 바이트를 읽음.
   - 브라우저: `<input type=file>` 의 `File.arrayBuffer()`.
2. **디코드**: `ctx.decodeAudioData()` 로 압축 오디오(mp3/wav/flac…)를 PCM 샘플 버퍼로 변환
   ([audio-engine.js](audio-engine.js) `addFileBuffer` / `addFile`).
3. 파일 1개당 **트랙 1개**가 생성됩니다. 트랙 이름은 파일명에서 따오고, 기본 파라미터(`params`)와
   전체 길이를 덮는 클립 1개(`clips: [{ start:0, end:buffer.duration … }]`)가 함께 만들어집니다.
4. 프로젝트 전체 길이(`DAW.duration`)는 가장 긴 트랙 길이에 맞춰집니다.
5. (초기 빈 화면에서 폴더로 불러온 경우) 폴더 이름이 프로젝트 이름으로 자동 설정됩니다(v1.9.4).
6. 데스크톱에서 네이티브 JUCE 엔진이 연결돼 있으면, 같은 파일을 엔진에도 `loadTrack` 으로 전달해
   재생/렌더를 네이티브가 담당합니다([audio-bridge.js](audio-bridge.js)).

> 이 단계 산출물: **디코드된 오디오 버퍼를 가진 트랙 목록**. 아직 어떤 효과도 “구워지지” 않았습니다.

---

## 2단계 — 사용자 효과 설정 (어디에 저장되나)

사용자가 믹서·트랙 헤더·Advanced Effects 창에서 값을 바꾸면, 그 값은 **엔진 상태에 저장**되고
재생 그래프에 실시간 반영됩니다. Export는 이 저장 값을 그대로 사용합니다.

### 2-1. 트랙별 설정 — 각 `track.params` / `track.clips`

| 설정 | 저장 위치 | 의미 |
|---|---|---|
| 볼륨(Gain) | `params.volume` | 트랙 재생 레벨 |
| 팬(Pan) | `params.pan` | 좌우 스테레오 위치 (StereoPanner) |
| Mute / Solo | `params.mute` / `params.solo` | 음소거 / 솔로(다른 트랙 자동 무음) |
| 트랙 Reverb 전송 | `params.reverb` | 공용 리버브로 보내는 양 |
| 트랙 Echo 전송 | `params.echo` | 딜레이(에코)로 보내는 양 |
| 볼륨 오토메이션 | `params.automation` (+ `params.autoOn`) | 시간에 따른 볼륨 곡선(포인트/커브) |
| 클립별 오버라이드 | `clips[].params` / `clips[].automation` | 구간(클립) 단위 볼륨·오토메이션 |

### 2-2. 마스터(프로젝트 전체) 설정 — `DAW.master`

| 설정 | 키 | 적용 위치(렌더) |
|---|---|---|
| 9밴드 그래픽 EQ | `master.bands[0..8]` | 마스터 버스 직후 9개 peaking 필터 |
| EQ 프리셋 | `master.eqPreset` | 위 bands 값을 채우는 프리셋(Reset/Pop/Classic/Hip Hop) |
| 마스터 Reverb | `master.reverb` | 마스터 병렬 리버브 |
| 마스터 Echo/Delay | `master.echo` | 마스터 병렬 딜레이(피드백) |
| Ambience(공간) | `master.room`, `master.roomParams` | 룸 IR 컨볼루션 버스(별도) |
| Saturation | `master.saturation` | 마스터 배음 새추레이션 |
| Widener | `master.widener` | 스테레오 폭 확장 |
| Exciter/Enhancer | `master.exciter` | 고역 배음 강화 |
| Fade In / Out | `master.fadeIn` / `master.fadeOut` | 마스터 페이드 자동화 |
| 마스터 Volume | `master.volume` | **모니터링 전용 — Export에는 반영 안 함**(아래 주의) |

> Ambience 창의 SOUND ENVIRONMENT 프리셋·노브, Advanced Pan(트랙 팬), Advanced EQ(밴드/프리셋),
> 믹서 MASTER의 OUTPUT EFFECTS는 모두 위의 `master.*` / `track.params` 값을 쓰는 **같은 상태**를 편집합니다.
> (믹서·Advanced 창은 별도 창이지만 동일 엔진 상태를 공유)

---

## 3단계 — Export 실행 & 경로 분기

`Export` 버튼 또는 `Project ▸ Export…` → **Export mixdown** 창에서 형식/품질/태그를 정하고 **Render** 클릭
([ui-dialogs.jsx](ui-dialogs.jsx) `ExportDialog.render`).

설정 항목:

- **Format**: MP3 / WAV
- **Bitrate**: 192 / 256 / 320 kbps (MP3)
- **Sample rate**: 44.1 kHz / 48 kHz
- **Normalize (LUFS)**: 라우드니스 정규화 목표 (-9 / -12 / -14 / -16 / -23 LUFS)
- **Keep pitch**: Vari BPM으로 템포를 바꿔 내보낼 때 피치 보존 적용
- 태그: Title / Artist(작곡가) / Album / Year / Date + (MP3) 커버 아트

렌더는 두 경로 중 하나로 갈립니다:

- **A. 네이티브 경로** (`DAW.isNative` — 데스크톱에서 JUCE 엔진 연결됨)
  → `DAW.renderMix()` 가 엔진에 `export` 명령을 보내고, 엔진이 전체 믹스를 렌더해 **임시 파일 경로**를 돌려줍니다.
  (포맷·비트레이트·LUFS·keep pitch 옵션을 엔진이 직접 처리)
- **B. Web Audio 폴백 경로** (브라우저, 또는 네이티브 엔진 미연결)
  → `DAW.renderMix()` 가 `OfflineAudioContext`로 믹스 **AudioBuffer**를 만들고,
  이후 4~6단계(후처리/인코딩)를 렌더러가 수행합니다.

---

## 4단계 — 믹스 렌더링 (신호 체인)

Web Audio 폴백 기준, `renderMix`([audio-engine.js](audio-engine.js))는 **재생 그래프와 동일한 구조**를
`OfflineAudioContext`에 다시 만들어 한 번에 렌더링합니다. 신호 흐름:

```
각 트랙:
  BufferSource(재생속도=템포 rate)
    → Gain(볼륨 × mute/solo 게이트)
    → Gain(볼륨 오토메이션 커브: setValueCurveAtTime)
    → StereoPanner(팬)
        ├─→ 마스터 버스(mBus)                      (드라이)
        ├─→ 트랙 Reverb 전송 → 공용 리버브 → mBus   (트랙 리버브)
        └─→ 트랙 Echo 전송 → Delay(+피드백) → mBus  (트랙 에코)

마스터 버스(mBus):
  → 9밴드 EQ (peaking ×9, master.bands)
  → Fade Gain (master fadeIn/fadeOut 자동화)
  → Master Volume Gain ※ Export에서는 1로 고정(모니터 볼륨 제외)
      ├─→ mMix                                   (드라이)
      ├─→ 마스터 Reverb → Convolver → mMix
      ├─→ 마스터 Echo → Delay(+피드백) → mMix
      └─→ Ambience(룸 IR) 전송 → Convolver → mMix
  → mMix
  → (Normalize면) 소프트 클리퍼(WaveShaper)
  → destination(렌더 출력)
```

이때 반영되는 사용자 설정:
- 트랙 **볼륨·팬·mute/solo·리버브/에코·볼륨 오토메이션·클립 오버라이드** → 트랙 단계에서 적용
- 마스터 **9밴드 EQ → 페이드 → (리버브·에코·Ambience 병렬)** → 마스터 단계에서 적용
- **Vari BPM 템포**: `applyTempo`가 켜지면 `BufferSource.playbackRate`로 전체 속도 변경,
  `preservePitch`면 그래프는 1배로 렌더 후 마지막에 타임스트레치로 피치 보존 길이 보정.

> 렌더 결과는 캐시됩니다(`_renderCacheKey`). 같은 설정으로 다시 Render하면 즉시 재사용합니다.

### ⚠️ 경로별 차이 (정확한 사실)
- **Saturation / Widener / Exciter / Enhancer** 세 효과는 **실시간 모니터링 그래프**
  (`masterMix → Saturation → Widener → Exciter → Compressor`)와 **네이티브 엔진 렌더**에는 적용되지만,
  현재 **Web Audio 폴백의 오프라인 `renderMix`에는 포함되어 있지 않습니다.**
  따라서 데스크톱(네이티브 엔진)에서 내보내면 이 세 효과가 반영되고, 브라우저 폴백 내보내기에서는
  반영되지 않습니다. (정확한 결과를 원하면 데스크톱 네이티브 엔진 사용을 권장)
- **마스터 Volume**은 사용자의 스피커/헤드폰 모니터링 볼륨이므로 **의도적으로 Export에서 제외**됩니다
  (렌더 그래프에서 `mv.gain = 1` 고정). 내보낸 파일은 트랙 게인·오토메이션·팬·마스터 EQ/FX·페이드만 반영합니다.

---

## 5단계 — 후처리 (선택, 데스크톱 ffmpeg)

Web Audio 폴백 경로에서 다음이 켜져 있으면 렌더된 PCM을 ffmpeg로 한 번 더 처리합니다
([electron/main.js](electron/main.js) `process-audio` → `processAudioFfmpeg`).

- **Keep pitch (템포 보존)**: `atempo` 필터로 피치를 유지한 채 속도 변경
  (데스크톱 전용 안정 경로. 그래프 렌더는 1배로 두고 여기서 템포 적용).
- **Normalize (LUFS)**: `loudnorm` 2-pass(측정→선형 보정)로 목표 라우드니스/트루피크 정규화.
  - 이 ffmpeg loudnorm을 쓸 때는 4단계의 인-그래프 소프트 클리퍼를 끄고, ffmpeg가 라우드니스를 맞춥니다.
  - ffmpeg가 없거나 브라우저면, 4단계의 소프트 클리퍼(WaveShaper)만으로 피크를 부드럽게 눌러 줍니다.

네이티브 경로(A)에서는 이 보정들을 JUCE 엔진/저장 단계에서 처리합니다.

---

## 6단계 — 인코딩 (MP3 / WAV)

Web Audio 폴백 기준([ui-dialogs.jsx](ui-dialogs.jsx) `render`):

- **MP3 · 데스크톱**: 렌더 PCM을 임시 WAV로 만든 뒤
  `electronAPI.encodeMp3()` → ffmpeg가 MP3로 인코딩하며 **ID3v2 태그 + 커버 아트**를 함께 삽입
  ([electron/main.js](electron/main.js) `encode-mp3`).
- **MP3 · 브라우저**: `lamejs`로 MP3 인코딩 후, 직접 만든 ID3v2 태그(텍스트 + APIC 커버)를 앞에 붙임.
- **MP3 · lamejs 없음**: 폴백으로 WAV 저장.
- **WAV**: `audioBufferToWav()` 로 PCM WAV 생성(태그는 RIFF INFO 청크). keep pitch/loudnorm이면 ffmpeg 후처리 후 WAV.

태그 처리: Year(연도)와 Date(월/일)를 합쳐 ISO 날짜로 만들고, 제목/아티스트/앨범과 함께 메타데이터로 기록.
커버 아트는 MP3에서만(프리셋 커버 또는 사용자 이미지) 삽입.

---

## 7단계 — 파일 저장

**Save file** 클릭 시:

- **네이티브 경로(A)**: `electronAPI.saveNativeAudio(tempFilePath, format, {bitrate, sampleRate, meta, cover}, fileName)`
  → 저장 다이얼로그로 위치를 고르면, 엔진이 만든 임시 파일을 (필요 시 ffmpeg로 태그/포맷 마감해) 최종 위치에 기록
  ([electron/main.js](electron/main.js) `save-native-audio`).
- **Web Audio 폴백(B) · 데스크톱**: 인코딩된 Blob의 바이트를 `electronAPI.saveAudio(ab, fileName)` 로 저장.
- **브라우저**: `<a download>` 링크로 브라우저 다운로드.

기본 파일명은 프로젝트 이름 기반(`<프로젝트명>.mp3` / `.wav`).

---

## 부록 — 단계별 책임 파일

| 단계 | 주요 파일 / 함수 |
|---|---|
| 불러오기/디코드 | [app.jsx](app.jsx) (`addElectronFiles`/`addFiles`) · [audio-engine.js](audio-engine.js) (`addFileBuffer`/`addFile`) |
| 효과 상태 | [audio-engine.js](audio-engine.js) (`setMaster`/`setTrackParam`, `master`, `track.params`) · 믹서/Advanced 창 |
| Export UI/분기 | [ui-dialogs.jsx](ui-dialogs.jsx) (`ExportDialog.render`) |
| 믹스 렌더 | [audio-engine.js](audio-engine.js) (`renderMix`, OfflineAudioContext) · 네이티브 JUCE 엔진([audio-bridge.js](audio-bridge.js)) |
| 후처리(atempo/loudnorm) | [electron/main.js](electron/main.js) (`process-audio`) |
| 인코딩 | [electron/main.js](electron/main.js) (`encode-mp3`) · [ui-dialogs.jsx](ui-dialogs.jsx) (lamejs/WAV) |
| 저장 | [electron/main.js](electron/main.js) (`save-native-audio` / `save-audio`) |

---

## 요약

1. **불러오기**는 오디오를 PCM 버퍼로 디코드해 트랙을 만든다.
2. **효과 설정**은 “지금 굽는” 게 아니라 엔진 상태(트랙·마스터 값)로 저장된다.
3. **Render**는 저장된 값으로 재생과 동일한 신호 그래프를 오프라인으로 재구성해 믹스를 만든다.
4. 트랙(볼륨·팬·솔로/뮤트·리버브/에코·오토메이션) → 마스터(EQ → 페이드 → 리버브·에코·Ambience) 순으로 합쳐진다.
5. 선택 시 ffmpeg로 **피치 보존 템포**·**LUFS 정규화** 후처리.
6. **MP3(ffmpeg/lamejs) 또는 WAV**로 인코딩하며 태그·커버를 삽입.
7. 최종 파일을 디스크에 저장한다.
8. 주의: **마스터 Volume은 Export 제외**(모니터 전용), **Saturation/Widener/Exciter는 네이티브 엔진 렌더에 반영**(Web Audio 폴백 오프라인 렌더에는 미포함).
