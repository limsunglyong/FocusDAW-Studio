/* ============================================================
 * Generates manual/사용자 메뉴얼.html from ui-help.jsx.
 *
 * The in-app manual (ui-help.jsx) is the SINGLE SOURCE OF TRUTH for
 * manual content. This script re-renders the same chapters as a
 * standalone HTML page so the two can never drift apart.
 *
 * It rewrites only <body>; the <head> (CSS/theme) of the existing HTML
 * file is preserved verbatim, so page styling stays hand-authored.
 *
 * Run:  node scripts/build-manual-html.js
 * ============================================================ */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "ui-help.jsx");
const OUT = path.join(ROOT, "manual", "사용자 메뉴얼.html");

// Both files are CRLF on disk; work in LF internally and write LF back out.
const src = fs.readFileSync(SRC, "utf8").replace(/\r\n/g, "\n");
const prev = fs.readFileSync(OUT, "utf8").replace(/\r\n/g, "\n");

/* ---------- 1. chapter list (for the nav) ---------- */
function parseSectionList(block) {
  const out = [];
  const re = /\{\s*id:\s*"([^"]+)",\s*label:\s*"([^"]+)"\s*\}/g;
  let m;
  while ((m = re.exec(block))) out.push({ id: m[1], label: m[2] });
  return out;
}
const listMatch = src.match(/const sections = lang === "ko" \? \[([\s\S]*?)\] : \[([\s\S]*?)\];/);
if (!listMatch) throw new Error("could not find the sections list in ui-help.jsx");
const navKo = parseSectionList(listMatch[1]);
const navEn = parseSectionList(listMatch[2]);

/* ---------- 2. pull each <section> out of the JSX ---------- */
const SEC_OPEN = /<section id="([a-z]+)" className="manual-section">/g;
const sections = [];
let m;
while ((m = SEC_OPEN.exec(src))) {
  const start = m.index + m[0].length;
  const end = src.indexOf("\n            </section>", start);
  if (end < 0) throw new Error("unterminated section: " + m[1]);
  sections.push({ id: m[1], body: src.slice(start, end) });
}
if (!sections.length) throw new Error("no manual sections found");

/* ---------- 3. split each section into its ko / en halves ---------- */
function splitLangs(body) {
  const head = body.indexOf('{lang === "ko" ? (');
  const mid = body.indexOf("\n              ) : (\n");
  if (head < 0 || mid < 0) throw new Error("unexpected lang-conditional shape");
  let ko = body.slice(head + '{lang === "ko" ? ('.length, mid);
  let en = body.slice(mid + "\n              ) : (\n".length);
  const tail = en.lastIndexOf("\n              )}");
  if (tail >= 0) en = en.slice(0, tail);
  const unwrap = (s) => s.replace(/^\s*<>\s*\n/, "").replace(/\n\s*<\/>\s*$/, "");
  return { ko: unwrap(ko), en: unwrap(en) };
}

/* ---------- 4. JSX -> HTML ---------- */
// className="manual-x" maps to the standalone page's own class names.
const CLASS_MAP = {
  "manual-h2": null, "manual-h3": null, "manual-p": null,
  "manual-ul": null, "manual-ol": null, "manual-li": null,
  "manual-code": null, "manual-kbd": null, "manual-img": null,
  "manual-table": null, "manual-th": null, "manual-td": null,
  "manual-figure": "figure", "manual-note": "note", "manual-warning": "warning",
  "manual-grid": "grid", "manual-card": "card", "appver-since": "appver-since",
};

function jsxToHtml(jsx) {
  let s = jsx;
  // JSX comments
  s = s.replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
  // card headings carry an inline accent colour
  s = s.replace(
    /<h3 className="manual-h3" style=\{\{ color: "var\(--amber\)" \}\}>/g,
    '<h3 style="color: var(--accent-dark);">'
  );
  // figure captions become real <figcaption>
  s = s.replace(/<div className="manual-figcaption">/g, "<figcaption>");
  s = s.replace(/(<figcaption>[\s\S]*?)<\/div>/g, "$1</figcaption>");
  // className -> class (or dropped entirely)
  s = s.replace(/ className="([^"]+)"/g, (full, cls) => {
    const mapped = cls.split(/\s+/).map((c) => {
      if (!(c in CLASS_MAP)) throw new Error("unmapped className: " + c);
      return CLASS_MAP[c];
    }).filter(Boolean);
    return mapped.length ? ` class="${mapped.join(" ")}"` : "";
  });
  // image paths are relative to manual/ in the standalone page
  s = s.replace(/src="manual\//g, 'src="');
  // JSX tolerates a bare "&" in text; HTML wants it escaped. Leave real entities alone.
  s = s.replace(/&(?!#?\w+;)/g, "&amp;");
  // self-closing <img ... /> is valid HTML5; leave as-is.
  // re-indent from JSX depth (16 spaces) to page depth (8)
  s = s.split("\n").map((line) => (line.startsWith("                ") ? line.slice(8) : line)).join("\n");
  return s.replace(/\n{3,}/g, "\n\n").trim();
}

/* ---------- 5. assemble the page ---------- */
const head = prev.slice(0, prev.indexOf("</head>") + "</head>".length);
if (!head) throw new Error("could not find </head> in the existing manual");

// Chapter labels are plain JS strings, so escape them for HTML.
const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const navList = (items, lang) =>
  `      <ol class="lang-${lang}">\n` +
  items.map((s) => `        <li><a href="#${s.id}">${esc(s.label.replace(/^\d+\.\s*/, ""))}</a></li>`).join("\n") +
  `\n      </ol>`;

const body = sections.map((sec) => {
  const { ko, en } = splitLangs(sec.body);
  return [
    `    <section id="${sec.id}">`,
    `      <div class="lang-ko">`,
    jsxToHtml(ko).split("\n").map((l) => (l.trim() ? "  " + l : l)).join("\n"),
    `      </div>`,
    ``,
    `      <div class="lang-en">`,
    jsxToHtml(en).split("\n").map((l) => (l.trim() ? "  " + l : l)).join("\n"),
    `      </div>`,
    `    </section>`,
  ].join("\n");
}).join("\n\n");

const page = `${head}
<body>
  <div class="page">
    <header>
      <div class="langswitch">
        <button type="button" data-l="ko" onclick="setManualLang('ko')">한글</button>
        <button type="button" data-l="en" onclick="setManualLang('en')">English</button>
      </div>

      <h1><span class="lang-ko">FocusDAW Studio 사용자 메뉴얼</span><span class="lang-en">FocusDAW Studio User Manual</span></h1>
      <div class="manual-version"><span class="lang-ko">앱 버전</span><span class="lang-en">App version</span>&nbsp;<span class="appver">v1.45.0</span></div>
      <p class="lang-ko">스템을 불러와 믹싱하고, 그 위에 보컬을 덧녹음해 편집·이펙트 처리한 뒤 MP3/WAV로 내보내는 데스크톱 DAW 앱입니다.</p>
      <p class="lang-en">A desktop DAW for mixing imported stems, overdubbing your own vocals, editing and processing them, and exporting an MP3/WAV mixdown.</p>
      <div class="meta">
        <span class="pill"><span class="lang-ko">버전</span><span class="lang-en">Version</span>&nbsp;<span class="appver">v1.45.0</span></span>
        <span class="pill">Windows / macOS / Linux</span>
        <span class="pill"><span class="lang-ko">Electron 기반</span><span class="lang-en">Built on Electron</span></span>
        <span class="pill"><span class="lang-ko">MP3 / WAV / AIFF / M4A / OGG / FLAC 입력</span><span class="lang-en">MP3 / WAV / AIFF / M4A / OGG / FLAC input</span></span>
      </div>
    </header>

    <nav>
      <strong class="lang-ko">목차</strong>
      <strong class="lang-en">Contents</strong>
${navList(navKo, "ko")}
${navList(navEn, "en")}
    </nav>

${body}

    <footer>
      <span class="lang-ko">FocusDAW Studio 사용자 메뉴얼 · 작성 기준 버전 <span class="appver">v1.45.0</span></span>
      <span class="lang-en">FocusDAW Studio User Manual · Written for version <span class="appver">v1.45.0</span></span>
    </footer>
  </div>

  <!-- 버전 단일 소스(version.js)에서 주입. JS 미실행 시 위 폴백 텍스트를 표시. -->
  <script src="../version.js"></script>
  <script>
    if (window.APP_VERSION) {
      document.querySelectorAll(".appver").forEach(function (el) {
        el.textContent = "v" + window.APP_VERSION;
      });
    }
    function setManualLang(l) {
      document.documentElement.setAttribute("data-lang", l);
      document.documentElement.setAttribute("lang", l);
      try { localStorage.setItem("focusdaw-manual-lang", l); } catch (e) {}
    }
  </script>
</body>
</html>
`;

fs.writeFileSync(OUT, page, "utf8");
console.log(`built ${path.relative(ROOT, OUT)} — ${sections.length} chapters, ${page.length} bytes`);
