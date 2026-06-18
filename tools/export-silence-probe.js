// One-off verification probe for the native offline-export silence fix.
// Uses a hand-rolled WebSocket client (net.Socket) to match the engine's
// hand-rolled server, loads a real WAV, runs an offline export, and measures
// the exported file's peak/RMS. Usage: node tools/export-silence-probe.js <port> <sampleWav>
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const port = parseInt(process.env.FOCUS_PORT || process.argv[2] || '8092', 10);
const sample = path.resolve(process.env.FOCUS_SAMPLE || process.argv[3] || 'wav samples/c_scale_synth_bpm120.wav');
const out = path.join(os.tmpdir(), 'focusdaw_export_probe_out.wav');

function measureWav(file) {
  const b = fs.readFileSync(file);
  let off = 12, dataOff = 44, dataLen = b.length - 44, bits = 16, ch = 2;
  while (off + 8 <= b.length) {
    const id = b.toString('ascii', off, off + 4);
    const sz = b.readUInt32LE(off + 4);
    if (id === 'fmt ') { ch = b.readUInt16LE(off + 10); bits = b.readUInt16LE(off + 22); }
    if (id === 'data') { dataOff = off + 8; dataLen = sz; break; }
    off += 8 + sz + (sz & 1);
  }
  let peak = 0, sumSq = 0, n = 0;
  const end = Math.min(dataOff + dataLen, b.length - 1);
  const mid = dataOff + Math.floor((end - dataOff) / 2);
  let sq1 = 0, n1 = 0, sq2 = 0, n2 = 0;
  for (let i = dataOff; i + 1 < end; i += 2) {
    const v = b.readInt16LE(i) / 32768;
    peak = Math.max(peak, Math.abs(v)); sumSq += v * v; n++;
    if (i < mid) { sq1 += v * v; n1++; } else { sq2 += v * v; n2++; }
  }
  const rms = Math.sqrt(sumSq / Math.max(1, n));
  const rms1 = Math.sqrt(sq1 / Math.max(1, n1));
  const rms2 = Math.sqrt(sq2 / Math.max(1, n2));
  const db = (x) => (x > 0 ? (20 * Math.log10(x)).toFixed(1) : '-inf');
  return { bytes: b.length, samples: n, bits, ch, peak: +peak.toFixed(6), rms: +rms.toFixed(6),
    peakDb: db(peak), rmsDb: db(rms), firstHalfRmsDb: db(rms1), secondHalfRmsDb: db(rms2) };
}

function maskFrame(text) {
  const payload = Buffer.from(text, 'utf8');
  const len = payload.length;
  const mask = crypto.randomBytes(4);
  let header;
  if (len <= 125) { header = Buffer.from([0x81, 0x80 | len]); }
  else if (len <= 65535) { header = Buffer.from([0x81, 0x80 | 126, (len >> 8) & 0xff, len & 0xff]); }
  else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 0x80 | 127; header.writeUInt32BE(0, 2); header.writeUInt32BE(len, 6); }
  const masked = Buffer.alloc(len);
  for (let i = 0; i < len; i++) masked[i] = payload[i] ^ mask[i % 4];
  return Buffer.concat([header, mask, masked]);
}

console.log('sample:', sample, fs.existsSync(sample) ? '(exists)' : '(MISSING)');
const sock = net.connect(port, '127.0.0.1');
let handshakeDone = false;
let buf = Buffer.alloc(0);
const wsKey = crypto.randomBytes(16).toString('base64');
const timer = setTimeout(() => { console.error('TIMEOUT'); sock.destroy(); process.exit(2); }, 25000);

sock.on('connect', () => {
  sock.write(
    'GET / HTTP/1.1\r\n' +
    'Host: 127.0.0.1:' + port + '\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Key: ' + wsKey + '\r\n' +
    'Sec-WebSocket-Version: 13\r\n\r\n'
  );
});

function send(obj) { sock.write(maskFrame(JSON.stringify(obj))); }

sock.on('data', (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  if (!handshakeDone) {
    const idx = buf.indexOf('\r\n\r\n');
    if (idx === -1) return;
    const head = buf.slice(0, idx).toString();
    if (!/101/.test(head)) { console.error('HANDSHAKE FAILED:', head.split('\r\n')[0]); process.exit(4); }
    handshakeDone = true;
    buf = buf.slice(idx + 4);
    // begin protocol
    send({ command: 'init', sampleRate: 44100 });
    send({ command: 'loadTrack', trackId: 'probe1', filePath: sample });
    const norm = process.env.FOCUS_NORMALIZE === '1';
    const lufs = parseFloat(process.env.FOCUS_LUFS || '-9');
    setTimeout(() => {
      // Send automation AFTER the track has loaded (avoids a load/command race).
      if (process.env.FOCUS_AUTO === '1' || process.env.FOCUS_AUTO === '2') {
        const curved = process.env.FOCUS_AUTO === '2';
        send({ command: 'setTrackAutomation', trackId: 'probe1', autoOn: true, curved, points: [0, 1, 0.5, 0.2, 1, 1] });
      }
      setTimeout(() => send({ command: 'export', exportId: 'probe_export', format: 'wav',
        sampleRate: 44100, bitrate: 320, normalize: norm, lufsTarget: lufs, preservePitch: false, duration: 4 }), 300);
    }, 1500);
  }
  // parse unmasked server frames
  while (buf.length >= 2) {
    const b1 = buf[1];
    let len = b1 & 0x7f, off = 2;
    if (len === 126) { if (buf.length < 4) break; len = buf.readUInt16BE(2); off = 4; }
    else if (len === 127) { if (buf.length < 10) break; len = Number(buf.readBigUInt64BE(2)); off = 10; }
    if (buf.length < off + len) break;
    const payload = buf.slice(off, off + len).toString('utf8');
    buf = buf.slice(off + len);
    let msg; try { msg = JSON.parse(payload); } catch (e) { continue; }
    if (msg.event === 'exportDone') {
      clearTimeout(timer);
      try { fs.copyFileSync(msg.tempFilePath, out); console.log('RESULT', JSON.stringify(measureWav(out))); }
      catch (e) { console.error('measure failed:', e.message); }
      sock.destroy(); process.exit(0);
    } else if (msg.event === 'exportError') {
      clearTimeout(timer); console.error('exportError:', payload); sock.destroy(); process.exit(1);
    }
  }
});
sock.on('error', (e) => { console.error('SOCKET ERROR', e.message); process.exit(3); });
