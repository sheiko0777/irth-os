/**
 * Lightweight, zero-dependency QR Code Generator (ISO/IEC 18004)
 * Generates standards-compliant QR codes as SVG or matrix for IRTH OS labels and products.
 */

// Error correction levels
export type QrEccLevel = 'L' | 'M' | 'Q' | 'H';

// Galois Field GF(256) tables for Reed-Solomon coding
const EXP_TABLE = new Uint8Array(512);
const LOG_TABLE = new Uint8Array(256);

(function initGfTables() {
  let val = 1;
  for (let i = 0; i < 255; i++) {
    EXP_TABLE[i] = val;
    EXP_TABLE[i + 255] = val;
    LOG_TABLE[val] = i;
    val <<= 1;
    if (val & 0x100) {
      val ^= 0x11d; // GF(256) reduction polynomial
    }
  }
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP_TABLE[LOG_TABLE[a] + LOG_TABLE[b]];
}

function gfPolyMul(p1: Uint8Array, p2: Uint8Array): Uint8Array {
  const result = new Uint8Array(p1.length + p2.length - 1);
  for (let i = 0; i < p1.length; i++) {
    for (let j = 0; j < p2.length; j++) {
      result[i + j] ^= gfMul(p1[i], p2[j]);
    }
  }
  return result;
}

function getRsGeneratorPoly(degree: number): Uint8Array {
  let poly: any = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    poly = gfPolyMul(poly, new Uint8Array([1, EXP_TABLE[i]]));
  }
  return poly as Uint8Array;
}

function rsComputeRemainder(data: Uint8Array, generator: Uint8Array): Uint8Array {
  const degree = generator.length - 1;
  const result = new Uint8Array(degree);
  for (const byte of data) {
    const factor = byte ^ result[0];
    result.copyWithin(0, 1);
    result[degree - 1] = 0;
    for (let j = 0; j < degree; j++) {
      result[j] ^= gfMul(generator[j + 1], factor);
    }
  }
  return result;
}

// QR Table: [TotalDataCodewords, EccCodewordsPerBlock, NumBlocks] for ECC Level 'M'
// Versions 1 to 10 cover up to ~270 bytes (far more than any SKU / barcode)
interface VersionSpec {
  version: number;
  size: number;
  totalCodewords: number;
  eccCodewords: number;
  blocks: { count: number; dataCount: number }[];
  alignmentCoords: number[];
}

const VERSION_SPECS: VersionSpec[] = [
  { version: 1, size: 21, totalCodewords: 26, eccCodewords: 10, blocks: [{ count: 1, dataCount: 16 }], alignmentCoords: [] },
  { version: 2, size: 25, totalCodewords: 44, eccCodewords: 16, blocks: [{ count: 1, dataCount: 28 }], alignmentCoords: [6, 18] },
  { version: 3, size: 29, totalCodewords: 70, eccCodewords: 26, blocks: [{ count: 1, dataCount: 44 }], alignmentCoords: [6, 22] },
  { version: 4, size: 33, totalCodewords: 100, eccCodewords: 18, blocks: [{ count: 2, dataCount: 32 }], alignmentCoords: [6, 26] },
  { version: 5, size: 37, totalCodewords: 134, eccCodewords: 24, blocks: [{ count: 2, dataCount: 43 }], alignmentCoords: [6, 30] },
  { version: 6, size: 41, totalCodewords: 172, eccCodewords: 16, blocks: [{ count: 4, dataCount: 27 }], alignmentCoords: [6, 34] },
  { version: 7, size: 45, totalCodewords: 196, eccCodewords: 18, blocks: [{ count: 4, dataCount: 31 }], alignmentCoords: [6, 22, 38] },
  { version: 8, size: 49, totalCodewords: 242, eccCodewords: 22, blocks: [{ count: 2, dataCount: 38 }, { count: 2, dataCount: 39 }], alignmentCoords: [6, 24, 42] },
  { version: 9, size: 53, totalCodewords: 292, eccCodewords: 22, blocks: [{ count: 3, dataCount: 36 }, { count: 2, dataCount: 37 }], alignmentCoords: [6, 26, 46] },
  { version: 10, size: 57, totalCodewords: 346, eccCodewords: 26, blocks: [{ count: 4, dataCount: 43 }, { count: 1, dataCount: 44 }], alignmentCoords: [6, 28, 50] },
];

function selectVersion(dataLength: number): VersionSpec {
  for (const spec of VERSION_SPECS) {
    const maxDataBytes = spec.blocks.reduce((acc, b) => acc + b.count * b.dataCount, 0);
    // 4 bits mode + 8 bits length (v1-9) + data bytes + 4 bits terminator
    const neededCodewords = dataLength + 2;
    if (neededCodewords <= maxDataBytes) {
      return spec;
    }
  }
  return VERSION_SPECS[VERSION_SPECS.length - 1];
}

class BitBuffer {
  private buffer: number[] = [];
  private length = 0;

  put(num: number, length: number) {
    for (let i = 0; i < length; i++) {
      this.putBit(((num >>> (length - i - 1)) & 1) === 1);
    }
  }

  putBit(bit: boolean) {
    const bufIndex = Math.floor(this.length / 8);
    if (this.buffer.length <= bufIndex) {
      this.buffer.push(0);
    }
    if (bit) {
      this.buffer[bufIndex] |= 0x80 >>> (this.length % 8);
    }
    this.length++;
  }

  getLength(): number {
    return this.length;
  }

  getBytes(): Uint8Array {
    return new Uint8Array(this.buffer);
  }
}

export function encodeQrMatrix(text: string): boolean[][] {
  const encoder = new TextEncoder();
  const utf8 = encoder.encode(text);
  const spec = selectVersion(utf8.length);
  const totalDataBytes = spec.blocks.reduce((acc, b) => acc + b.count * b.dataCount, 0);

  const bb = new BitBuffer();
  // Byte mode: 0100
  bb.put(0b0100, 4);
  // Character count (8 bits for v1-9, 16 bits for v10+)
  const countBits = spec.version < 10 ? 8 : 16;
  bb.put(utf8.length, countBits);
  for (const byte of utf8) {
    bb.put(byte, 8);
  }

  // Terminator (up to 4 zeroes)
  const maxBits = totalDataBytes * 8;
  const termBits = Math.min(4, maxBits - bb.getLength());
  bb.put(0, termBits);

  // Byte alignment
  while (bb.getLength() % 8 !== 0) {
    bb.putBit(false);
  }

  // Pad bytes: alternating 0xEC, 0x11
  const padBytes = [0xec, 0x11];
  let padIdx = 0;
  while (bb.getLength() < maxBits) {
    bb.put(padBytes[padIdx % 2], 8);
    padIdx++;
  }

  const dataBytes = bb.getBytes();

  // Split into blocks and compute Reed-Solomon ECC
  const genPoly = getRsGeneratorPoly(spec.eccCodewords);
  const dataBlocks: Uint8Array[] = [];
  const eccBlocks: Uint8Array[] = [];

  let byteOffset = 0;
  for (const block of spec.blocks) {
    for (let c = 0; c < block.count; c++) {
      const blockData = dataBytes.slice(byteOffset, byteOffset + block.dataCount);
      byteOffset += block.dataCount;
      dataBlocks.push(blockData);
      eccBlocks.push(rsComputeRemainder(blockData, genPoly));
    }
  }

  // Interleave data codewords
  const finalCodewords: number[] = [];
  const maxBlockLen = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < maxBlockLen; i++) {
    for (const b of dataBlocks) {
      if (i < b.length) finalCodewords.push(b[i]);
    }
  }
  // Interleave ECC codewords
  for (let i = 0; i < spec.eccCodewords; i++) {
    for (const b of eccBlocks) {
      finalCodewords.push(b[i]);
    }
  }

  // Matrix generation
  const size = spec.size;
  const matrix: (boolean | null)[][] = Array.from({ length: size }, () => Array(size).fill(null));
  const isFunction: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));

  function setFunction(r: number, c: number, val: boolean) {
    matrix[r][c] = val;
    isFunction[r][c] = true;
  }

  // 1. Finder patterns at 3 corners
  function placeFinder(row: number, col: number) {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const tr = row + r;
        const tc = col + c;
        if (tr < 0 || tr >= size || tc < 0 || tc >= size) continue;
        const inOuter = r >= 0 && r <= 6 && c >= 0 && c <= 6;
        const inInner = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        const inBorder = r === 0 || r === 6 || c === 0 || c === 6;
        setFunction(tr, tc, inOuter && (inBorder || inInner));
      }
    }
  }
  placeFinder(0, 0);
  placeFinder(0, size - 7);
  placeFinder(size - 7, 0);

  // 2. Alignment patterns
  if (spec.alignmentCoords.length > 0) {
    const coords = spec.alignmentCoords;
    for (const r of coords) {
      for (const c of coords) {
        if (isFunction[r][c]) continue;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const isBorder = Math.abs(dy) === 2 || Math.abs(dx) === 2;
            const isCenter = dy === 0 && dx === 0;
            setFunction(r + dy, c + dx, isBorder || isCenter);
          }
        }
      }
    }
  }

  // 3. Timing patterns
  for (let i = 8; i < size - 8; i++) {
    if (!isFunction[6][i]) setFunction(6, i, i % 2 === 0);
    if (!isFunction[i][6]) setFunction(i, 6, i % 2 === 0);
  }

  // 4. Dark module
  setFunction(4 * spec.version + 9, 8, true);

  // 5. Reserve Format Info areas
  for (let i = 0; i < 9; i++) {
    if (!isFunction[8][i]) setFunction(8, i, false);
    if (!isFunction[i][8]) setFunction(i, 8, false);
  }
  for (let i = 0; i < 8; i++) {
    if (!isFunction[8][size - 1 - i]) setFunction(8, size - 1 - i, false);
    if (!isFunction[size - 1 - i][8]) setFunction(size - 1 - i, 8, false);
  }

  // 6. Populate data with zig-zag pattern
  let dataIndex = 0;
  let bitIndex = 7;
  let upwards = true;

  for (let right = size - 1; right > 0; right -= 2) {
    if (right === 6) right--; // Skip vertical timing column
    const rows = upwards
      ? Array.from({ length: size }, (_, i) => size - 1 - i)
      : Array.from({ length: size }, (_, i) => i);

    for (const r of rows) {
      for (const c of [right, right - 1]) {
        if (isFunction[r][c]) continue;
        let bit = false;
        if (dataIndex < finalCodewords.length) {
          bit = ((finalCodewords[dataIndex] >>> bitIndex) & 1) === 1;
          bitIndex--;
          if (bitIndex < 0) {
            bitIndex = 7;
            dataIndex++;
          }
        }
        matrix[r][c] = bit;
      }
    }
    upwards = !upwards;
  }

  // 7. Apply Mask (Mask 0: (row + col) % 2 === 0 works universally and reliably)
  // Mask format for ECC 'M' (00) and Mask 0 (000) = Format data 0b00000
  // With BCH error correction: 0x4aa5
  const formatBits = 0x4aa5;

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!isFunction[r][c] && (r + c) % 2 === 0) {
        matrix[r][c] = !matrix[r][c];
      }
    }
  }

  // Write format info bits (15 bits)
  const fBits: boolean[] = [];
  for (let i = 0; i < 15; i++) {
    fBits.push(((formatBits >>> i) & 1) === 1);
  }

  // Top-left format info
  for (let i = 0; i < 6; i++) matrix[8][i] = fBits[i];
  matrix[8][7] = fBits[6];
  matrix[8][8] = fBits[7];
  matrix[7][8] = fBits[8];
  for (let i = 9; i < 15; i++) matrix[14 - i][8] = fBits[i];

  // Top-right and bottom-left format info
  for (let i = 0; i < 8; i++) matrix[size - 1 - i][8] = fBits[i];
  for (let i = 8; i < 15; i++) matrix[8][size - 15 + i] = fBits[i];

  return matrix.map((row) => row.map((cell) => cell ?? false));
}

/**
 * Generates an SVG path string for a QR matrix for crisp vector rendering.
 */
export function getQrSvgPath(matrix: boolean[][], cellSize = 4, margin = 4): { path: string; viewBox: string; size: number } {
  const count = matrix.length;
  const totalCells = count + margin * 2;
  const totalPx = totalCells * cellSize;

  let path = '';
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (matrix[r][c]) {
        const x = (c + margin) * cellSize;
        const y = (r + margin) * cellSize;
        path += `M${x},${y}h${cellSize}v${cellSize}h-${cellSize}z `;
      }
    }
  }

  return {
    path,
    viewBox: `0 0 ${totalPx} ${totalPx}`,
    size: totalPx,
  };
}

/**
 * Returns a complete, standalone SVG string for the QR code.
 */
export function generateQrSvg(text: string, cellSize = 6, margin = 4): string {
  const matrix = encodeQrMatrix(text);
  const { path, viewBox, size } = getQrSvgPath(matrix, cellSize, margin);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${size}" height="${size}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#ffffff"/><path d="${path.trim()}" fill="#000000"/></svg>`;
}

/**
 * Returns a data URL for SVG or Canvas image export.
 */
export function generateQrDataUrl(text: string): string {
  const svg = generateQrSvg(text);
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
