---
name: native-engine-rebuild
description: How to rebuild the JUCE native audio engine incrementally and deploy it to bin/
metadata: 
  node_type: memory
  type: reference
  originSessionId: fa37285d-4045-48c1-a5f3-51a7bc5c71c6
---

The native audio engine (`juce_skeleton/Source/*`) compiles to `bin/FocusDAW-AudioEngine.exe`, which is git-tracked and is what the app actually spawns (electron/main.js tries `bin/` first). After editing the C++ you MUST rebuild and copy the artefact to `bin/` or the running app uses the stale binary.

`juce_skeleton/build_native.bat` does a CLEAN rebuild (wipes `build/`, recompiles JUCE — slow, several min). For a fast **incremental** build use the already-configured `build_native/` dir with the VS18-bundled cmake:

```
cmake.exe = "C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe"
& $cmake --build ".\juce_skeleton\build_native" --config Release --target FocusDAW-AudioEngine
# then copy artefact -> bin\ (and dist\win-unpacked\...\bin if present):
#   juce_skeleton\build_native\FocusDAW-AudioEngine_artefacts\Release\FocusDAW-AudioEngine.exe
```

Only AudioEngine.cpp/.h/Main.cpp/WebSocketServer TUs recompile (~30s). Korean comments trigger harmless C4819 codepage warnings. Renderer changes (`*.jsx`) instead need `npm run build:renderers`; `main.js`/`version.js` need no build. See [[mp3-decode-via-ffmpeg]].
