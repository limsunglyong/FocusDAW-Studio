# Handoff: Vocal Pitch Editor (FocusDAW Studio)

## Overview
Standalone pitch-editing window for a DAW's vocal track. The user sees the vocal track's
waveform and its machine-detected pitch, and corrects intonation by dragging quantized note
bars onto piano-key positions. Includes a transport bar, BPM-based grid, and independent
zoom/pan on both axes.

Target environment for this handoff: **Electron desktop app (web technologies)**.

## About the Design Files
The file in this bundle (`Pitch Editor.dc.html`) is a **design reference created in HTML** —
a working prototype that shows the intended look, layout and interaction behavior. It runs on a
proprietary prototyping runtime (`support.js`, not included and not needed) and is **not
production code to copy**.

The task is to **recreate this design in the target codebase's own environment** — for an
Electron app that means the renderer's existing stack (React/Vue/Svelte + whatever styling
and state libraries the project already uses), following its established patterns. If the
renderer has no established stack yet, pick one appropriate for the app and implement there.
Open the HTML file in a browser to inspect behavior; read this README for the spec.

## Fidelity
**High fidelity.** Colors, typography, spacing and interaction behavior are final. Recreate the
UI to match, using the codebase's existing component and styling conventions.

---

## Window Structure

Root: full viewport (`100vw × 100vh`), `display:flex; flex-direction:column`, `overflow:hidden`,
`user-select:none`. Background `--bg2`. Base font 13px / line-height 1.35, antialiased.
Reset `html,body{margin:0;padding:0}` and `*{box-sizing:border-box}`.

Four stacked regions, top to bottom:

| Region | Height | Notes |
|---|---|---|
| Title bar | 38px fixed | app chrome |
| Transport bar | auto (~52px) | wraps on narrow widths |
| Editor area | flex 1, `min-height:0` | scrolls if window is short |
| Status bar | 30px fixed | |

---

## 1. Title bar

- Height 38px, `flex:0 0 38px`. Background `linear-gradient(180deg, var(--bg2), var(--bg))`,
  `border-bottom:1px solid var(--line)`. Padding `0 6px 0 14px`, `gap:14px`, items centered.
- **App mark**: 18×18 piano-roll glyph SVG, stroke `--amber`, `stroke-width:1.7`,
  `filter: drop-shadow(0 0 6px var(--amber-soft))`.
- **Wordmark**: "ADVANCED EFFECT FACTORY", 11px / 700 / `letter-spacing:.14em`, color `--muted`.
- **View chip**: label "Pitch Editor" + 12px chevron. 11px / 700 / `letter-spacing:.04em`,
  color `--cream-2`, background `--surface2`, `1px solid var(--line-strong)`,
  `border-radius:7px`, padding `6px 11px`. (Intended as a view-switcher dropdown.)
- **Center title**: `flex:1`, centered, 12.5px, color `--dim`: `FocusDAW Studio — <track name>`
  with the track name in `--cream-2` / 600.
- **Window buttons**: three 44px-wide full-height buttons (minimize / maximize / close).
  Icon color `--cream-2`; hover background `--surface2`; close hover `#b94a3a` with white glyph
  (close glyph is `×` at 17px). In Electron, wire these to the BrowserWindow controls and
  set `titleBarStyle`/frameless accordingly.

## 2. Transport bar

Container: `padding:10px 14px`, `gap:14px`, `flex-wrap:wrap`, items centered.
Background `linear-gradient(180deg, var(--surface2), var(--surface))`,
`border-bottom:1px solid var(--line-strong)`.
Groups are separated by 1px × 30px dividers in `--line-strong`.

### Button base style (all transport/tool buttons)
34×30px (icon-only), `border-radius:7px`, `1px solid var(--line-strong)`,
background `linear-gradient(180deg, var(--surface2), var(--surface))`,
color `--cream-2`, `box-shadow: inset 0 1px 0 rgba(255,255,255,.04)`, cursor pointer.
**Active state**: background `--amber`, border `--amber`, color `--mixer-bar-fg`,
`box-shadow: 0 0 10px var(--amber-soft)`.
Icons are 14×14 SVG, `stroke-width:1.9`, round caps/joins (filled where noted).

### Group A — transport (gap 6px, left to right)
1. **Return to start** — icon: left-pointing triangle + bar. Sets playhead 0, scrollX 0.
2. **Play / Pause** — toggles; *active* styling while playing. Icon: filled triangle
   (`M7 4l13 8-13 8z`) when stopped, two 2px bars when playing.
3. **Stop** — filled 14×14 rounded square (r=2). Sets playing false, playhead 0.
4. **Record (punch)** — filled circle r=6. When armed: icon color `--red` and the button
   pulses via `@keyframes rec {0%,100%{opacity:.45} 50%{opacity:1}}`, 1.1s ease-in-out infinite.
5. **Loop** — toggle, *active* styling when on. Icon: two arrows forming a cycle.

### Group B — clock / tempo (gap 16px)
Field pattern: 8.5px / 700 / `letter-spacing:.12em` label in `--muted` above a 13px / 700
value in `--cream` (monospace where noted).
- **POSITION** — value `bar.beat.tick` (e.g. `3.2.240`), monospace. Derived from playhead in
  beats: `bar = floor(beats/4)+1`, `beat = floor(beats%4)+1`, `tick = floor((beats%1)*480)`,
  tick zero-padded to 3 digits. Wrapped in an inset readout: padding `4px 12px`,
  `border-radius:7px`, background `--bg`, `1px solid var(--line-strong)`,
  `box-shadow: inset 0 2px 6px rgba(0,0,0,.4)`.
- **BPM** — monospace integer, default **96**. Vertical drag adjusts:
  `bpm = round(clamp(startBpm + (startY - currentY) * 0.4, 40, 220))`, cursor `ns-resize`.
- **SIG** — static `4/4`.

### Group C — quantize / waveform (gap 14px)
- **QUANTIZE** segmented control: `1/4` (1 beat), `1/8` (0.5), `1/16` (0.25, default), `OFF` (0).
  Segment shell: background `--bg`, `border-radius:8px`, `padding:2px`, `1px solid var(--line)`.
  Segment: padding `5px 10px`, 10.5px / 700, monospace, `border-radius:6px`, no border.
  Selected: background `--surface3`, color `--cream`; unselected color `--muted`.
- **WAVE** toggle: padding `5px 12px`, 10.5px / 700, `border-radius:7px`. On: background/border
  `--amber`, color `--mixer-bar-fg`, label "ON". Off: background `--surface2`,
  border `--line-strong`, color `--dim`, label "OFF". Default ON.

### Group D — tools + zoom (right-aligned, gap 14px)
- **Tool buttons** (gap 5px, single-select, default `select`):
  `select` (cursor arrow) · `draw` (pencil) · `erase` (eraser) · `pan` (hand).
  Tooltips: 선택 / 이동, 노트 그리기, 노트 삭제, 화면 이동.
- **Zoom block**: `padding-left:12px`, `border-left:1px solid var(--line-strong)`,
  two rows (gap 3px) labelled **TIME** and **KEY** (9px / 700 / `letter-spacing:.08em`,
  color `--muted`, width 22px), each followed by `−` and `+` buttons:
  24×22px, `border-radius:5px`, `1px solid var(--line-strong)`, background `--surface2`,
  color `--cream-2`, 12px / 700 monospace.

## 3. Editor area

Wrapper: `flex:1 1 auto`, `min-height:0`, `display:flex`,
`justify-content:center`, **`align-items:flex-start`**, `padding:14px 16px 10px`,
`overflow:auto`. (flex-start matters: without it the card is stretch-clamped and its bottom
rows/scrollbar get clipped.)

Card: `flex:0 0 auto`, `align-self:flex-start`, column flex, `1px solid var(--line-strong)`,
`border-radius:12px`, `overflow:hidden`, `box-shadow: 0 18px 50px -18px rgba(0,0,0,.7)`,
background `--surface`.

### Geometry constants
| Constant | Value | Meaning |
|---|---|---|
| `VIEW_W` | 700px | grid viewport width |
| `VIEW_H` | 252px | grid viewport height |
| `WAVE_H` | 54px | waveform lane height |
| ruler height | 24px | |
| keyboard width | 64px | |
| scrollbar thickness | 10px | both axes |
| `TOTAL` | 32 beats | clip length (8 bars @ 4/4) |
| `HI` / `LO` | MIDI 84 / 48 | top / bottom key (C6 → C3, 37 rows) |
| `zoomX` | 74 px/beat, range 22–320 | horizontal zoom |
| `rowH` | 15 px/semitone, range 7–40 | vertical zoom |
| initial `scrollY` | 130px | centers the vocal range in view |

Card row layout:
1. Row 1: `[64px corner: "BAR" + "LV"] [700px: ruler over waveform lane] [10px spacer]`
2. Row 2: `[64px keyboard] [700px note grid] [10px vertical scrollbar]`
3. Row 3: `[10px horizontal scrollbar, margin-left 64px] [10px spacer]`

Corner cells: "BAR" 8.5px / 700 / `letter-spacing:.1em` / `--muted`, centered, 24px tall,
`border-bottom:1px solid var(--line-strong)`; "LV" 8px / 700 / `--faint`, `WAVE_H` tall.
Both on `linear-gradient(180deg, var(--surface2), var(--surface))`.

### 3a. Time ruler (24px)
Background `linear-gradient(180deg, var(--surface2), var(--surface))`,
`border-bottom:1px solid var(--line-strong)`, `overflow:hidden`, cursor `text`.
- Bar lines (every 4 beats): 1px `--line-strong`; beat lines: 1px `--line`, drawn only when
  `zoomX >= 26`. Bar numbers at `x+4, y=4`, 9.5px / 700 monospace, `--dim`, 1-indexed.
- Bar/beat x = `beat * zoomX - scrollX`; cull items outside `[-40, VIEW_W+40]`.
- **Scrub**: mousedown + drag sets `playhead = clamp((clientX - rulerLeft + scrollX)/zoomX, 0, TOTAL)`.
- **Playhead marker**: 10×10 downward triangle (`clip-path: polygon(0 0,100% 0,50% 100%)`),
  `--red`, at `left = playheadPx - 5`, `top:2`.

### 3b. Waveform lane (54px, toggleable)
Background `linear-gradient(180deg, var(--bg), var(--surface))`,
`border-bottom:1px solid var(--line-strong)`.
- SVG 700×54. Center zero line: 1px `--line` at y = 27.
- Amplitude bars every 3px, width 2px, `rx:0.8`, fill `--blue`, `opacity:.62`,
  vertically centered, height `max(1.5, amp * (54-12))`.
- Sample time for column x: `t = (x + scrollX) / zoomX` (in beats) — so the lane stays aligned
  with the ruler and grid at every zoom/scroll. In production, read the real peak file /
  waveform cache instead of the prototype's synthetic `amp(t)`.
- Label "WAVEFORM" at `left:8, top:5`, 8.5px / 700 / `letter-spacing:.12em`, `--faint`.
- Playhead: 1.5px `--red` vertical line, `opacity:.8`.

### 3c. Piano keyboard (64px, left)
`position:relative`, height `VIEW_H`, `overflow:hidden`, background `--bg`,
`border-right:1px solid var(--line-strong)`. One absolutely-positioned key per semitone,
top = `(HI - midi) * rowH - scrollY`, height = `rowH`; cull rows outside the viewport.
- **White keys** (`midi % 12` not in {1,3,6,8,10}): full 64px width,
  background `linear-gradient(90deg, var(--key-white-2), var(--key-white))`,
  `box-shadow: inset -3px 0 5px rgba(0,0,0,.12)`, no right border, square corners.
- **Black keys**: width `64 * 0.62 ≈ 39.7px`, background `--key-black`,
  `border-right:1px solid rgba(0,0,0,.5)`, `border-radius:0 3px 3px 0`,
  `box-shadow: 2px 1px 3px rgba(0,0,0,.45)`, `z-index:2` (white keys `z-index:1`).
- All keys: `border-top:1px solid rgba(0,0,0,.35)`.
- **C labels**: on white keys where `midi % 12 === 0` and `rowH >= 11` — note name (e.g. `C4`),
  right-aligned with `padding-right:5px`, monospace, `font-size: min(9, rowH-4)`, 700, `#4a4033`.
- **Selected-note key lights up**: if the selected note's midi equals this row, background
  becomes `--amber` and the label color `--mixer-bar-fg`.
- Naming: `name = NAMES[midi % 12] + (floor(midi/12) - 1)`,
  `NAMES = [C, C#, D, D#, E, F, F#, G, G#, A, A#, B]`.

### 3d. Note grid (700×252)
`position:relative`, `overflow:hidden`, background `--bg`.
Cursor: `crosshair` (draw tool) / `grab` (pan tool) / `default` (otherwise).

**Row backgrounds** — per semitone, top = `(HI-midi)*rowH - scrollY`, height `rowH`:
black-key rows `rgba(0,0,0,.22)`, white-key rows transparent;
`border-bottom` 1px `--line-strong` on C rows (`midi%12===0`), else 1px `--line`.

**Column lines** — stepped by the current quantize value (or 0.25 when quantize is OFF),
x = `beat*zoomX - scrollX`:
bar lines (beat % 4 === 0) 1.5px `--line-strong`; beat lines 1px `--line`;
sub-beat lines 1px `rgba(232,212,170,.05)`, skipped when `zoomX * step < 9` (declutter on zoom-out).

**Note bars** (`z-index:5`) — one per note:
- `left = start*zoomX + 0.5`, `width = max(4, dur*zoomX - 1)`,
  `top = (HI-midi)*rowH - scrollY + 1.5`, `height = max(5, rowH - 3)`.
- `border-radius:3px`, background `linear-gradient(180deg, var(--amber), var(--amber-deep))`,
  `1px solid var(--amber-deep)`, `box-shadow: 0 2px 5px -2px #000`, `overflow:hidden`,
  `padding-left:4px`, contents vertically centered.
- **Selected**: border `--cream`, `box-shadow: 0 0 0 1px var(--cream), 0 3px 8px -2px #000`.
- **Note name** shown when `rowH >= 12 && width > 30`: monospace, `font-size: min(9, rowH-5)`,
  700, `--mixer-bar-fg`, `white-space:nowrap`.
- **Cent deviation** shown when `rowH >= 12 && width > 62`: right-aligned at `right:10px`,
  monospace 8px, `--mixer-bar-fg`, `opacity:.72`, format `+18¢` / `-24¢`.
- **Resize handle**: 6px-wide strip on the right edge, full height, cursor `ew-resize`.
- Cull notes fully outside the viewport.

**Detected-pitch curve** (red) — an SVG polyline over the grid (`z-index:4`,
`pointer-events:none`), `stroke: var(--red)`, `stroke-width:1.7`, `opacity:.92`,
`stroke-linejoin:round`, `filter: drop-shadow(0 0 3px var(--red))`. Per note it traces the
sung pitch `midi + cents/100`, sampled every ~6px, with a vibrato term and a short attack
scoop; between consecutive notes it interpolates with smoothstep so pitch changes read as a
continuous glide rather than a jump. In production, plot the real per-frame f0 track here
(one point per analysis hop, converted to MIDI-float) — the prototype's synthesis is only a
stand-in for that data.

**Target-note connectors** (amber) — for consecutive notes whose gap is `<= 1.2` beats, a cubic
Bézier from the end of one bar's vertical center to the start of the next:
`M x1,y1 C x1+0.45Δ,y1  x1+0.55Δ,y2  x2,y2`, `stroke: var(--amber)`, `stroke-width:1.6`,
`stroke-dasharray:3 3`, `opacity:.65`.

**Playhead** — 1.5px `--red` vertical line, `z-index:6`, `box-shadow: 0 0 6px var(--red)`.

### 3e. Scrollbars
Track: background `--bg2`, `border-top` (horizontal) / `border-left` (vertical) 1px `--line`.
Thumb: 6px thick, `border-radius:3px`, background `--surface3`, cursor `grab`, inset 2px.
Horizontal thumb width `max(40, VIEW_W * VIEW_W/contentW)`, vertical thumb height
`max(36, VIEW_H * VIEW_H/contentH)`; position proportional to scroll offset; dragging maps
pixel delta back through the same ratio.

---

## Interactions & Behavior

**Note editing** (grid, `select` tool)
- Drag a bar: horizontal delta → `start = clamp(snap(startStart + dxBeats), 0, TOTAL - dur)`;
  vertical delta → `midi = clamp(startMidi + round(-dy / rowH), LO, HI)` (always semitone-snapped
  to the piano key under the cursor). Selecting a note lights its key in the keyboard.
- Drag the right-edge handle: `dur = max(quantize || 0.125, snap(startDur + dxBeats))`.
- `snap(b) = quantize ? round(b/quantize)*quantize : b` — the minimum unit is the quantize
  setting, so bars always land on the BPM grid.
- `draw` tool: mousedown on empty grid creates a note at the snapped beat and the key under the
  cursor, `dur = max(0.25, quantize || 0.5)`, `cents = 0`, and selects it.
- `erase` tool: mousedown on a note deletes it (cursor `not-allowed` over notes).
- Clicking empty grid with `select` clears the selection.

**Navigation**
- `pan` tool: drag the grid to move both axes (`scrollX -= dx`, `scrollY -= dy`, both clamped).
- Wheel on grid: plain = vertical scroll; `Shift` = horizontal scroll;
  `Ctrl`/`Cmd` = zoom TIME; `Ctrl+Shift` = zoom KEY. Always `preventDefault()`.
- Zoom buttons and wheel-zoom both use a **focus-preserving** step of ×1.35 (time) / ×1.3 (key):
  the beat (or key) at the viewport center stays at the center. Clamp scroll to
  `[0, contentSize - viewportSize]` after every zoom.
- Ruler drag scrubs the playhead.

**Playback**
- Prototype advances the playhead on a 40ms interval by `(bpm/60) * 0.04` beats. In the real app,
  drive it from the audio clock (e.g. `requestAnimationFrame` reading the engine's transport
  position) — never a timer.
- At `playhead >= TOTAL`: wrap to 0 if loop is on, else clamp to TOTAL.
- **Auto-scroll**: if `playheadPx - scrollX > VIEW_W - 90`, set
  `scrollX = clamp(playheadPx - VIEW_W + 90, 0, maxScrollX)`; if `playheadPx < scrollX`,
  `scrollX = max(0, playheadPx - 40)`.

**Status bar (30px)**
Background `--bg`, `border-top:1px solid rgba(0,0,0,.4)`, padding `0 16px`,
10.5px, color `--faint`, left text and right text (monospace) space-between.
- Left, with a selection: `선택: C4 · 12.00박 · 길이 1.50 · 편차 +18¢`
- Left, no selection: `노트를 드래그해 건반 위치로 이동 · 오른쪽 끝을 끌어 길이 조절 · Ctrl+휠 = 확대/축소`
- Right: `25 notes · 96 BPM · 74px/beat · 15px/key`

---

## State Management

```
notes: Array<{ id: number; start: number; dur: number; midi: number; cents: number }>
        // start & dur in beats; midi 48–84; cents = detected deviation from the target note
sel:      number | null      // selected note id
tool:     'select' | 'draw' | 'erase' | 'pan'
playing:  boolean            // transport running
loop:     boolean            // default true
rec:      boolean            // punch-record armed
playhead: number             // beats
bpm:      number             // default 96, range 40–220
snap:     number             // quantize in beats: 1 | 0.5 | 0.25 | 0 (off)
zoomX:    number             // px per beat, 22–320, default 74
rowH:     number             // px per semitone, 7–40, default 15
scrollX:  number             // px, 0 … TOTAL*zoomX - VIEW_W
scrollY:  number             // px, 0 … rows*rowH - VIEW_H, default 130
showWave: boolean            // waveform lane visible, default true
```

Derived (never stored): `contentW = TOTAL*zoomX`, `contentH = rows*rowH`,
`maxScrollX/Y`, bar.beat.tick readout, note screen rects, curve point lists.

Data the real implementation must fetch instead of synthesizing:
- the track's waveform peaks (for the lane),
- the pitch-detection result: per-frame f0 → the red curve, and the segmented note list
  (start/dur/midi/cents) → the bars,
- transport position and BPM from the engine.

Note edits should be committed to the app's undo stack (drags coalesced into one undo entry
per gesture) and pushed to the pitch-correction engine as target-note changes.

## Design Tokens

CSS custom properties on `:root`; four themes ship in the prototype
(`default` amber-on-dark, `ivory`, `blue`, `slate`) selected via a `data-theme` attribute on
the root element. Default theme values:

| Token | Value | Use |
|---|---|---|
| `--bg` | `#1b1712` | editor/grid background |
| `--bg2` | `#221d17` | window background, scrollbar tracks |
| `--surface` | `#2a2520` | cards, bar gradients |
| `--surface2` | `#332e27` | raised controls |
| `--surface3` | `#3d362d` | selected segment, scrollbar thumbs |
| `--line` | `rgba(232,212,170,.10)` | hairlines, beat lines |
| `--line-strong` | `rgba(232,212,170,.18)` | borders, bar lines |
| `--cream` | `#efe6d4` | primary text |
| `--cream-2` | `#d8cdb6` | secondary text, icons |
| `--dim` | `#b0a690` | tertiary text |
| `--muted` | `#857c6b` | labels |
| `--faint` | `#5f574a` | least-emphasis text |
| `--amber` | `#e8b04b` | accent, note bars, active controls |
| `--amber-deep` | `#c8893a` | note gradient bottom, borders |
| `--amber-soft` | `rgba(232,176,75,.16)` | glows |
| `--green` | `#94c06a` | positive values |
| `--red` | `#d96a4e` | playhead, detected pitch curve, record |
| `--blue` | `#7fb0c4` | waveform |
| `--violet` | `#c98fb0` | (reserved) |
| `--mixer-bar-fg` | `#241a0a` | text on amber fills |
| `--key-white` | `#e6dcc6` | white key face |
| `--key-white-2` | `#cbc0a6` | white key shading |
| `--key-black` | `#221e18` | black key |
| `--shadow` | `0 18px 50px -18px rgba(0,0,0,.7)` | card elevation |

**Typography** — `--ui`: "Space Grotesk", system-ui, sans-serif;
`--mono`: "Space Mono", ui-monospace, monospace; display face "Michroma" (title only).
Loaded from Google Fonts in the prototype — **bundle these locally for an Electron app** so the
renderer works offline.
Sizes in use: 8 / 8.5 / 9 / 9.5 / 10.5 / 11 / 12 / 12.5 / 13px. Weights 400 / 600 / 700.
Label convention: 8.5–9px, weight 700, `letter-spacing` .08–.12em, uppercase, color `--muted`.

**Spacing** — 2 / 3 / 4 / 5 / 6 / 10 / 12 / 14 / 16px. **Radii** — 3 / 5 / 6 / 7 / 8 / 12px.

**Scrollbar styling** (WebKit, applies in Electron): 10px, thumb `--surface3`,
`border-radius:6px`, `border:2px solid transparent; background-clip:padding-box`,
transparent track.

## Assets
None. All iconography is inline SVG paths (transport, tools, window controls, app mark) and the
piano keys, waveform, grid and curves are drawn with DOM elements and SVG. No images, no icon
font. Only external dependency is the two Google fonts noted above.

## Files
- `Pitch Editor.dc.html` — the design reference (open in a browser to inspect behavior).
  Its `<x-dc>` body holds the window shell markup; the `class Component` script holds all
  geometry math, drawing and interaction logic. Method map:
  `transport()`, `clockBlock()`, `snapBlock()`, `toolBlock()` = the transport bar;
  `keyboard()`, `ruler()`, `waveLane()`, `grid()`, `hbar()`, `vbar()`, `editor()` = the editor;
  `zoomTo()`, `snapB()`, `yFor()`, `mFor()` = the zoom/scroll/snap math.

### Related designs in the same product (not included in this bundle)
The vocal channel strip window (HPF · Noise Gate · 9-band graphic EQ · Compressor · De-Esser,
with a before/after spectrum view) uses the same tokens and chrome. Ask for that handoff
separately if you're implementing it too.
