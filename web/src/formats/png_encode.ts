import type { BinaryImage } from "./binary.ts";

/**
 * Encode a binary image as a 1-bit black and white PNG and return as data URL.
 * Pure TypeScript implementation using pako for compression.
 */
export function binaryToBase64PNG(binImage: BinaryImage): string {
  // Import pako dynamically to avoid Node-only issues in browser builds
  const { deflate } = require("pako");

  const { width, height, data } = binImage;

  // CRC32 implementation for PNG chunks
  function crc32(buf: Uint8Array): number {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      c ^= buf[i];
      for (let k = 0; k < 8; k++) {
        const mask = -(c & 1);
        c = (c >>> 1) ^ (0xedb88320 & mask);
      }
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  function writeUint32BE(v: number, out: Uint8Array, off: number) {
    out[off] = (v >>> 24) & 0xff;
    out[off + 1] = (v >>> 16) & 0xff;
    out[off + 2] = (v >>> 8) & 0xff;
    out[off + 3] = v & 0xff;
  }

  // Build uncompressed scanlines with filter byte 0 per row
  const bytesPerRow = Math.ceil(width / 8);
  const scanlineLen = 1 + bytesPerRow; // filter + data
  const raw = new Uint8Array(scanlineLen * height);
  for (let y = 0; y < height; y++) {
    const srcRow = y * bytesPerRow;
    const dst = y * scanlineLen;
    raw[dst] = 0; // filter type 0 (None)
    raw.set(data.subarray(srcRow, srcRow + bytesPerRow), dst + 1);
  }

  // Compress with DEFLATE (zlib wrapper) using pako
  const idatCompressed = deflate(raw);

  // PNG signature
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdrData = new Uint8Array(13);
  writeUint32BE(width, ihdrData, 0);
  writeUint32BE(height, ihdrData, 4);
  ihdrData[8] = 1; // bit depth: 1
  ihdrData[9] = 0; // color type: 0 (grayscale)
  ihdrData[10] = 0; // compression: deflate
  ihdrData[11] = 0; // filter: adaptive
  ihdrData[12] = 0; // interlace: none

  function makeChunk(type: string, chunkData: Uint8Array): Uint8Array {
    const typeBytes = new TextEncoder().encode(type);
    const len = chunkData.length;
    const chunk = new Uint8Array(12 + len);
    writeUint32BE(len, chunk, 0);
    chunk.set(typeBytes, 4);
    chunk.set(chunkData, 8);
    const crc = crc32(chunk.subarray(4, 8 + len));
    writeUint32BE(crc, chunk, 8 + len);
    return chunk;
  }

  const ihdr = makeChunk("IHDR", ihdrData);
  const idat = makeChunk("IDAT", idatCompressed);
  const iend = makeChunk("IEND", new Uint8Array());

  // Concatenate all parts
  const totalLen = signature.length + ihdr.length + idat.length + iend.length;
  const png = new Uint8Array(totalLen);
  let offset = 0;
  png.set(signature, offset);
  offset += signature.length;
  png.set(ihdr, offset);
  offset += ihdr.length;
  png.set(idat, offset);
  offset += idat.length;
  png.set(iend, offset);

  // Base64 encode
  let base64: string;
  if (typeof btoa !== "undefined") {
    // Browser path
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < png.length; i += chunkSize) {
      const sub = png.subarray(i, Math.min(i + chunkSize, png.length));
      binary += String.fromCharCode.apply(null, Array.from(sub) as never);
    }
    base64 = btoa(binary);
  } else {
    // Deno/Node path
    // deno-lint-ignore no-explicit-any
    const BufferAny: any = (globalThis as any).Buffer;
    base64 = BufferAny.from(png).toString("base64");
  }

  return `data:image/png;base64,${base64}`;
}
