---
name: mp3-decode-via-ffmpeg
description: "Native engine must decode compressed audio via ffmpeg — JUCE's MP3 reader is unreliable"
metadata: 
  node_type: memory
  type: project
  originSessionId: fa37285d-4045-48c1-a5f3-51a7bc5c71c6
---

JUCE's MP3 reader is **untrustworthy for both length and seek** in this project. Symptoms seen (v1.9.20): streaming an MP3 + re-seeking on every play/stop drifted the audio (tracks desynced, song sounded "slower") while the transport's nominal read position still looked perfect — so it was invisible in position logs. Also `lengthInSamples` was wildly wrong and inconsistent: three stems of the SAME 139.3s song reported 189/150/133s, which skewed automation phase (= readPos / trackLength).

**Why:** WAV stems were always fine; only compressed (MP3) drifted. The web engine (LocalDAW) was unaffected because it fully decodes via decodeAudioData up front.

**How to apply:** Native `AudioEngine::loadTrack` now decodes the WHOLE file to PCM and plays from a `juce::MemoryAudioSource` (sample-exact seek). For compressed formats (mp3/m4a/ogg/flac) it shells out to the bundled ffmpeg (path passed from electron/main.js via the `FOCUSDAW_FFMPEG` env var) into a temp WAV first, then reads that — exact length + content. WAV/AIFF read directly. Don't reintroduce streaming `AudioFormatReaderSource` for playback. Fixed in v1.9.21. See [[native-engine-rebuild]].
