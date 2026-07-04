/* ============================================================
 * Single source of truth for the app version (runtime/UI display).
 *
 * Edit the version in EXACTLY TWO places when releasing:
 *   1) package.json  "version"   (build / installer ??electron-builder)
 *   2) this file      APP_VERSION (runtime UI ??main app, Help, manual)
 *
 * Keep both identical. All UI code reads window.APP_VERSION and
 * prepends "v" for display, so do NOT include the leading "v" here.
 * ============================================================ */
window.APP_VERSION = "1.14.13";
