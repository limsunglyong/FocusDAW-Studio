const fs = require('fs');

// Mock window and global objects if needed
global.window = global;
require('./meyda.min.js');

console.log('Meyda loaded:', typeof Meyda);
if (typeof Meyda !== 'undefined') {
  console.log('Available extractors:', Meyda.featureExtractors);
  
  // Try chroma extraction
  const frame = new Float32Array(4096);
  for (let i = 0; i < 4096; i++) {
    frame[i] = Math.sin(2 * Math.PI * 440 * i / 44100);
  }
  Meyda.bufferSize = 4096;
  Meyda.sampleRate = 44100;
  
  try {
    const chroma = Meyda.extract('chroma', frame);
    console.log('Extracted chroma successfully:', chroma);
  } catch (e) {
    console.error('Error during chroma extraction:', e);
  }
}
