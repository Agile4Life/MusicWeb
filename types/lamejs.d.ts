declare module 'lamejs' {
  export class Mp3Encoder {
    constructor(channels: number, samplerate: number, kbps: number)
    encodeBuffer(left: Int16Array, right?: Int16Array): Int8Array | Uint8Array
    flush(): Int8Array | Uint8Array
  }
}

declare module '@breezystack/lamejs' {
  export class Mp3Encoder {
    constructor(channels: number, samplerate: number, kbps: number)
    encodeBuffer(left: Int16Array, right?: Int16Array): Int8Array | Uint8Array
    flush(): Int8Array | Uint8Array
  }
}
