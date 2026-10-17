import { describe, expect, it } from 'vitest';
import {
  patchInitMp4Duration,
  stripFmp4SegmentIndexBoxes,
} from '../soundcloudClient';

function makeBox(type: string, payload: Uint8Array): Uint8Array {
  const total = 8 + payload.byteLength;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, total, false);
  for (let i = 0; i < 4; i++) {
    out[4 + i] = type.charCodeAt(i);
  }
  out.set(payload, 8);
  return out;
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((acc, a) => acc + a.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.byteLength;
  }
  return out;
}

function makeMvhdV0(timescale: number, duration: number): Uint8Array {
  const payload = new Uint8Array(100);
  const view = new DataView(payload.buffer);
  view.setUint8(0, 0); // version 0
  view.setUint32(12, timescale, false);
  view.setUint32(16, duration, false);
  return makeBox('mvhd', payload);
}

function makeTkhdV0(duration: number): Uint8Array {
  const payload = new Uint8Array(84);
  const view = new DataView(payload.buffer);
  view.setUint8(0, 0); // version 0
  view.setUint32(20, duration, false);
  return makeBox('tkhd', payload);
}

function makeMdhdV0(timescale: number, duration: number): Uint8Array {
  const payload = new Uint8Array(24);
  const view = new DataView(payload.buffer);
  view.setUint8(0, 0); // version 0
  view.setUint32(12, timescale, false);
  view.setUint32(16, duration, false);
  return makeBox('mdhd', payload);
}

describe('SoundCloud fMP4 HLS stitching helpers', () => {
  it('patches mvhd, tkhd, and mdhd duration in init.mp4 from 0 to full track duration', () => {
    const ftyp = makeBox('ftyp', new Uint8Array(20));
    const mvhd = makeMvhdV0(1000, 0);
    const tkhd = makeTkhdV0(0);
    const mdhd = makeMdhdV0(44100, 0);
    const mdia = makeBox('mdia', mdhd);
    const trak = makeBox('trak', concatBytes(tkhd, mdia));
    const moov = makeBox('moov', concatBytes(mvhd, trak));
    const initMp4 = concatBytes(ftyp, moov);

    const patched = patchInitMp4Duration(initMp4, 223.399);
    const view = new DataView(patched.buffer, patched.byteOffset, patched.byteLength);

    // ftyp is 28 bytes; moov starts at 28; mvhd starts at 36
    // In mvhd: version at +8 (36+8=44), timescale at +20 (56), duration at +24 (60)
    expect(view.getUint32(60, false)).toBe(223399);

    // trak starts at 36 + 108 = 144; tkhd starts at 152; tkhd duration at +28 (180)
    expect(view.getUint32(180, false)).toBe(223399);

    // mdia starts at 152 + 92 = 244; mdhd starts at 252; mdhd duration at +24 (276)
    expect(view.getUint32(276, false)).toBe(Math.round(223.399 * 44100));
  });

  it('strips styp and sidx boxes from .m4s segments so the first 10s sidx cannot cap duration at 10s', () => {
    const styp = makeBox('styp', new Uint8Array(16));
    const sidx = makeBox('sidx', new Uint8Array(44));
    const moof = makeBox('moof', new Uint8Array([1, 2, 3, 4]));
    const mdat = makeBox('mdat', new Uint8Array([5, 6, 7, 8]));
    const segment = concatBytes(styp, sidx, moof, mdat);

    const stripped = stripFmp4SegmentIndexBoxes(segment);
    expect(stripped.byteLength).toBe(moof.byteLength + mdat.byteLength);

    const firstBoxType = String.fromCharCode(
      stripped[4],
      stripped[5],
      stripped[6],
      stripped[7]
    );
    expect(firstBoxType).toBe('moof');
  });
});

