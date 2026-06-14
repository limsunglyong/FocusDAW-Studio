# Time Stretch Benchmark

Export-only comparison harness for FocusDAW time-stretch candidates.

The first baseline candidate is `ffmpeg atempo`, matching the current Electron Export Keep pitch direction. The harness generates three deterministic WAV samples, processes each at several tempo ratios, and writes objective smoke metrics plus output WAV files for listening.

## Run

```powershell
npm run benchmark:stretch
```

Output is written to:

```text
tools/time-stretch-benchmark/out/
```

The output directory is ignored by git except for its `.gitignore` placeholder.

## Real Input Samples

Place real audio files in:

```text
tools/time-stretch-benchmark/input/
```

Supported input formats are decoded through `ffmpeg-static`: `.wav`, `.mp3`, `.m4a`, `.aac`, `.ogg`, `.flac`, `.aif`, `.aiff`, and `.opus`.

Then run the benchmark again. The report will include both the built-in synthetic samples and any input files. Input audio files are ignored by git.

Recommended real samples:

- Drum or percussion-heavy loop
- Vocal, lead, or acoustic melodic line
- Dense full mix or mastered song excerpt

Use short excerpts, roughly 10-30 seconds, so repeated candidate comparisons stay quick. MP3 is fine for convenience, but WAV excerpts are better when you want to avoid judging artifacts that are already present in a lossy source.

## Current Metrics

- Result duration and duration error
- Peak
- RMS delta versus the source sample
- Processing time

These metrics do not replace listening tests. They are meant to catch obvious length, level, and performance regressions before comparing rendered WAVs by ear.

The built-in samples are intentionally deterministic and simple. They are useful for smoke checks, but they may not expose artifacts that appear in real drums, vocals, acoustic instruments, or dense mastered mixes.

## Candidate Order

1. Keep `ffmpeg-atempo` as the short-term baseline.
2. Add SoundTouch/Rubber Band/Phase Vocoder candidates as separate processors.
3. Promote only candidates that beat or match the baseline to real app integration.
