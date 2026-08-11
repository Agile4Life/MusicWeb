const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const baseDir = 'C:\\Users\\User\\Downloads\\reaConverter-2026-08-11-3c0388e3e200';
const items = fs.readdirSync(baseDir);

for (const item of items) {
  const fullPath = path.join(baseDir, item);
  if (fs.statSync(fullPath).isDirectory()) {
    const files = fs.readdirSync(fullPath).filter(f => f.endsWith('.png'));
    if (files.length > 0) {
      const firstPng = path.join(fullPath, files[0]);
      const buf = fs.readFileSync(firstPng);
      let offset = 8;
      const idatParts = [];
      let width = 0, height = 0, colorType = 0;

      while (offset < buf.length - 8) {
        const len = buf.readUInt32BE(offset);
        const type = buf.toString('ascii', offset + 4, offset + 8);
        if (type === 'IHDR') {
          width = buf.readUInt32BE(offset + 8);
          height = buf.readUInt32BE(offset + 12);
          colorType = buf[offset + 17];
        }
        if (type === 'IDAT') idatParts.push(buf.subarray(offset + 8, offset + 8 + len));
        offset += 12 + len;
      }

      let transparent = 0;
      let total = width * height;
      if (colorType === 6) {
        const decompressed = zlib.inflateSync(Buffer.concat(idatParts));
        for (let y = 0; y < height; y++) {
          const lineStart = y * (width * 4 + 1) + 1;
          for (let x = 0; x < width; x++) {
            if (decompressed[lineStart + x * 4 + 3] === 0) transparent++;
          }
        }
      }
      console.log(`${item.padEnd(25)} | PNG count: ${files.length} | First: ${width}x${height}, ColorType: ${colorType}, Transparent: ${transparent}/${total}`);
    }
  }
}
