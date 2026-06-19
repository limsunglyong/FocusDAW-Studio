---
name: electron-install-gotcha
description: Electron binary postinstall fails silently in this dev environment; how to fix
metadata: 
  node_type: memory
  type: project
  originSessionId: 05f572c9-3b2b-4ee7-b429-a3aef72d7582
---

FocusDAW Studio is an Electron app (`npm start` = `electron .`, main = `electron/main.js`, electron ^33.4.11).

In this dev environment, `ELECTRON_RUN_AS_NODE=1` is present in the shell, which makes electron's postinstall (`node_modules/electron/install.js`) skip the binary download and exit 0 silently. Result: `node_modules/electron/dist/` ends up with only `LICENSES.chromium.html` and no `electron.exe`/`path.txt`, so `npm start` throws "Electron failed to install correctly".

**Why:** install.js bails early when certain env vars are set / a prior download was interrupted, leaving a partial `dist`. The Bash sandbox tool also silently kills the extract step — use the PowerShell tool (the user's real shell) for the fix.

**How to apply:** Never use `npx electron .` (pulls wrong version into npx cache). To recover the binary: download the matching zip (worked via `@electron/get` `downloadArtifact` with cache to `%LOCALAPPDATA%\electron\Cache`), then `Expand-Archive` it into `node_modules/electron/dist` and write `electron.exe` into `node_modules/electron/path.txt`. For a clean reinstall: `Remove-Item node_modules -Recurse -Force; $env:ELECTRON_RUN_AS_NODE=$null; npm install`.
