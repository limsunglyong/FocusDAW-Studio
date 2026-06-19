const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const outDir = path.join(root, "build");
const vendorDir = path.join(outDir, "vendor");

const jsxFiles = [
  "ui-kit.jsx",
  "ui-tracks.jsx",
  "ui-mixer.jsx",
  "ui-dialogs.jsx",
  "ui-help.jsx",
  "advanced-pan-app.jsx",
  "advanced-ambience-app.jsx",
  "advanced-eq-app.jsx",
  "app.jsx",
  "mixer-app.jsx",
];

const transformOptions = {
  loader: "jsx",
  jsxFactory: "React.createElement",
  jsxFragment: "React.Fragment",
  target: "chrome120",
  legalComments: "none",
};

fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(vendorDir, { recursive: true });

const vendorFiles = [
  ["node_modules/react/umd/react.production.min.js", "react.production.min.js"],
  ["node_modules/react-dom/umd/react-dom.production.min.js", "react-dom.production.min.js"],
  ["node_modules/lamejs/lame.min.js", "lame.min.js"],
];

for (const [source, target] of vendorFiles) {
  const sourcePath = path.join(root, source);
  const outPath = path.join(vendorDir, target);
  fs.copyFileSync(sourcePath, outPath);
  console.log(`copied ${path.relative(root, outPath)}`);
}

// soundtouchjs ships as an ES module; bundle it into an IIFE global so the
// non-module <script> pipeline (audio-engine.js) can use window.SoundTouchJS for
// the WebAudio fallback pitch-shift (Phase 2 "bake" path).
{
  const outPath = path.join(vendorDir, "soundtouch.global.js");
  esbuild.buildSync({
    entryPoints: [path.join(root, "node_modules/soundtouchjs/dist/soundtouch.js")],
    bundle: true,
    format: "iife",
    globalName: "SoundTouchJS",
    target: "chrome120",
    legalComments: "none",
    outfile: outPath,
  });
  console.log(`bundled ${path.relative(root, outPath)}`);
}

for (const file of jsxFiles) {
  const sourcePath = path.join(root, file);
  const outPath = path.join(outDir, file.replace(/\.jsx$/, ".js"));
  const source = fs.readFileSync(sourcePath, "utf8");
  const result = esbuild.transformSync(source, transformOptions);
  fs.writeFileSync(outPath, result.code + "\n");
  console.log(`built ${path.relative(root, outPath)}`);
}
