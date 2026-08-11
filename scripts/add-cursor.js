/**
 * Automated Cursor Installer & Converter CLI Script
 * 
 * Usage:
 * node scripts/add-cursor.js <source-folder> <id> <name> <description> [themeColor]
 * 
 * Example:
 * node scripts/add-cursor.js "D:\downloads\character_folder" "raiden-shogun" "Raiden Shogun" "Genshin Impact Anime" "purple"
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let c = 0xffffffff;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let k = n;
    for (let i = 0; i < 8; i++) {
      k = (k & 1) ? (0xedb88320 ^ (k >>> 1)) : (k >>> 1);
    }
    table[n] = k;
  }
  for (let i = 0; i < buf.length; i++) {
    c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function parseDibHeader(dibBuf) {
  const headerSize = dibBuf.readUInt32LE(0);
  const width = dibBuf.readInt32LE(4);
  const rawHeight = dibBuf.readInt32LE(8);
  const height = Math.abs(rawHeight) / 2;
  const bpp = dibBuf.readUInt16LE(14);
  const numColors = dibBuf.readUInt32LE(32) || (bpp <= 8 ? (1 << bpp) : 0);

  const paletteOffset = headerSize;
  const paletteSize = numColors * 4;
  const pixelOffset = paletteOffset + paletteSize;

  return { width, height, isBottomUp: rawHeight > 0, bpp, numColors, pixelOffset, paletteOffset };
}

function dibToPng(dibBuf) {
  const { width, height, isBottomUp, bpp, numColors, pixelOffset, paletteOffset } = parseDibHeader(dibBuf);

  const palette = [];
  if (bpp <= 8) {
    for (let i = 0; i < numColors; i++) {
      const idx = paletteOffset + i * 4;
      palette.push({
        b: dibBuf[idx],
        g: dibBuf[idx + 1],
        r: dibBuf[idx + 2],
        a: dibBuf[idx + 3]
      });
    }
  }

  const rowBits = width * bpp;
  const rowPitch = Math.floor((rowBits + 31) / 32) * 4;
  const xorSize = rowPitch * height;

  const andPitch = Math.floor((width + 31) / 32) * 4;
  const andMaskOffset = pixelOffset + xorSize;

  const scanlines = [];
  for (let y = 0; y < height; y++) {
    const line = [0];
    const dibRow = isBottomUp ? (height - 1 - y) : y;
    const rowStart = pixelOffset + dibRow * rowPitch;
    const andRowStart = andMaskOffset + dibRow * andPitch;

    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, a = 255;

      if (bpp === 32) {
        const pIdx = rowStart + x * 4;
        b = dibBuf[pIdx];
        g = dibBuf[pIdx + 1];
        r = dibBuf[pIdx + 2];
        a = dibBuf[pIdx + 3];
      } else if (bpp === 24) {
        const pIdx = rowStart + x * 3;
        b = dibBuf[pIdx];
        g = dibBuf[pIdx + 1];
        r = dibBuf[pIdx + 2];
      } else if (bpp === 8) {
        const pIdx = rowStart + x;
        const colorIdx = dibBuf[pIdx];
        const color = palette[colorIdx] || { r: 0, g: 0, b: 0 };
        r = color.r; g = color.g; b = color.b;
      } else if (bpp === 4) {
        const byteIdx = rowStart + Math.floor(x / 2);
        const shift = (1 - (x % 2)) * 4;
        const colorIdx = (dibBuf[byteIdx] >> shift) & 0x0f;
        const color = palette[colorIdx] || { r: 0, g: 0, b: 0 };
        r = color.r; g = color.g; b = color.b;
      }

      if (andMaskOffset < dibBuf.length) {
        const andByte = dibBuf[andRowStart + Math.floor(x / 8)];
        const bit = (andByte >> (7 - (x % 8))) & 1;
        if (bit === 1) {
          a = 0;
        }
      }

      line.push(r, g, b, a);
    }
    scanlines.push(Buffer.from(line));
  }

  const rawData = Buffer.concat(scanlines);
  const compressed = zlib.deflateSync(rawData);

  function makePngChunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.alloc(4);
    const crc = crc32(Buffer.concat([typeBuf, data]));
    crcBuf.writeUInt32BE(crc, 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  return Buffer.concat([
    signature,
    makePngChunk('IHDR', ihdr),
    makePngChunk('IDAT', compressed),
    makePngChunk('IEND', Buffer.alloc(0))
  ]);
}

function getFrame0FromAni(aniPath) {
  const aniBuffer = fs.readFileSync(aniPath);
  let offset = 12;
  while (offset < aniBuffer.length - 8) {
    const fourcc = aniBuffer.toString('ascii', offset, offset + 4);
    const size = aniBuffer.readUInt32LE(offset + 4);
    if (fourcc === 'LIST') {
      const listType = aniBuffer.toString('ascii', offset + 8, offset + 12);
      if (listType === 'fram') {
        let subOffset = offset + 12;
        const endFram = offset + 8 + size;
        while (subOffset < endFram - 8) {
          const subCc = aniBuffer.toString('ascii', subOffset, subOffset + 4);
          const subSize = aniBuffer.readUInt32LE(subOffset + 4);
          if (subCc === 'icon') {
            const curBuf = aniBuffer.subarray(subOffset + 8, subOffset + 8 + subSize);
            const curOffset = curBuf.readUInt32LE(18);
            const dibBuf = curBuf.subarray(curOffset);
            return dibToPng(dibBuf);
          }
          subOffset += 8 + subSize + (subSize % 2);
        }
      }
    }
    offset += 8 + size + (size % 2);
  }
  return null;
}

const args = process.argv.slice(2);
if (args.length < 4) {
  console.log('Usage: node scripts/add-cursor.js <source-folder> <id> <name> <description> [themeColor]');
  process.exit(1);
}

const [sourceFolder, cursorId, cursorName, cursorDesc, themeColorInput] = args;
const themeColor = themeColorInput || 'purple';

const destDir = path.join(__dirname, '../public/cursors', cursorId, 'static');
if (!fs.existsSync(destDir)) {
  fs.mkdirSync(destDir, { recursive: true });
}

console.log(`Processing cursor set from: ${sourceFolder}`);

// Scan for .ani / .cur / .png files recursively
function getAllFiles(dirPath, arrayOfFiles = []) {
  const files = fs.readdirSync(dirPath);
  for (const file of files) {
    const fullPath = path.join(dirPath, file);
    if (fs.statSync(fullPath).isDirectory()) {
      getAllFiles(fullPath, arrayOfFiles);
    } else {
      arrayOfFiles.push(fullPath);
    }
  }
  return arrayOfFiles;
}

const allFiles = getAllFiles(sourceFolder);

const fileMap = {
  Normal: allFiles.find(f => /Normal/i.test(f) && /\.(ani|cur|png)$/i.test(f)),
  Link: allFiles.find(f => /Link/i.test(f) && /\.(ani|cur|png)$/i.test(f)),
  Working: allFiles.find(f => /(Working|Busy|Loading)/i.test(f) && /\.(ani|cur|png)$/i.test(f)),
  Busy: allFiles.find(f => /(Busy|Loading|Working)/i.test(f) && /\.(ani|cur|png)$/i.test(f)),
  Text: allFiles.find(f => /Text Select\.ani$/i.test(f)) || allFiles.find(f => /Text/i.test(f) && /\.(ani|cur|png)$/i.test(f)),
  Help: allFiles.find(f => /Help/i.test(f) && /\.(ani|cur|png)$/i.test(f)),
  Unavailable: allFiles.find(f => /Unavailable/i.test(f) && /\.(ani|cur|png)$/i.test(f)),
};

for (const [key, filePath] of Object.entries(fileMap)) {
  const targetPngPath = path.join(destDir, `${key}.png`);
  if (filePath) {
    if (/\.(ani|cur)$/i.test(filePath)) {
      const pngBuf = getFrame0FromAni(filePath);
      if (pngBuf) fs.writeFileSync(targetPngPath, pngBuf);
    } else if (/\.png$/i.test(filePath)) {
      fs.copyFileSync(filePath, targetPngPath);
    }
    console.log(`✓ Processed ${key}.png from ${path.basename(filePath)}`);
  }
}

// Fallbacks if missing
const normalPng = path.join(destDir, 'Normal.png');
if (fs.existsSync(normalPng)) {
  ['Link', 'Working', 'Busy', 'Text', 'Help', 'Unavailable'].forEach((k) => {
    const p = path.join(destDir, `${k}.png`);
    if (!fs.existsSync(p)) {
      fs.copyFileSync(normalPng, p);
      console.log(`✓ Created fallback for ${k}.png`);
    }
  });
}

// Update lib/cursors.ts registry
const registryPath = path.join(__dirname, '../lib/cursors.ts');
let registryContent = fs.readFileSync(registryPath, 'utf8');

if (!registryContent.includes(`id: '${cursorId}'`)) {
  const colorMap = {
    purple: { bg: 'bg-purple-500/15', border: 'border-purple-500/30', shadow: 'shadow-[0_0_12px_rgba(168,85,247,0.3)]' },
    cyan: { bg: 'bg-cyan-500/15', border: 'border-cyan-500/30', shadow: 'shadow-[0_0_12px_rgba(6,182,212,0.3)]' },
    amber: { bg: 'bg-amber-500/15', border: 'border-amber-500/30', shadow: 'shadow-[0_0_12px_rgba(245,158,11,0.3)]' },
    emerald: { bg: 'bg-emerald-500/15', border: 'border-emerald-500/30', shadow: 'shadow-[0_0_12px_rgba(16,185,129,0.3)]' },
  };

  const c = colorMap[themeColor] || colorMap.purple;

  const newEntry = `  {
    id: '${cursorId}',
    name: '${cursorName}',
    desc: '${cursorDesc}',
    themeColor: '${themeColor}',
    bgClass: '${c.bg}',
    borderClass: '${c.border}',
    shadowClass: '${c.shadow}',
  },`;

  registryContent = registryContent.replace(
    '  {\n    id: \'default\',',
    `${newEntry}\n  {\n    id: \'default\',`
  );

  fs.writeFileSync(registryPath, registryContent);
  console.log(`✓ Added ${cursorId} to lib/cursors.ts registry`);
}

console.log(`🎉 New Cursor Character "${cursorName}" (${cursorId}) added & registered successfully!`);
