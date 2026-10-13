'use strict';

// Ethereum uses Keccak-256 (not the standardized SHA3-256 variant).
function keccak256Hex(hex) {
  if (!/^(?:[0-9a-fA-F]{2})*$/.test(hex)) throw Error('Keccak 输入必须是十六进制字节');
  const mask = (1n << 64n) - 1n;
  const rotations = [
    [0, 36, 3, 41, 18], [1, 44, 10, 45, 2], [62, 6, 43, 15, 61],
    [28, 55, 25, 21, 56], [27, 20, 39, 8, 14]
  ];
  const constants = [
    0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
    0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
    0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
    0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
    0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
    0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n
  ];
  const rotate = (value, count) => count === 0 ? value : ((value << BigInt(count)) | (value >> BigInt(64 - count))) & mask;
  const state = Array(25).fill(0n);
  const bytes = (hex.match(/../g) || []).map((part) => parseInt(part, 16));
  bytes.push(1);
  if (bytes.length % 136 === 0) bytes[bytes.length - 1] |= 128;
  else {
    while (bytes.length % 136 !== 135) bytes.push(0);
    bytes.push(128);
  }
  for (let offset = 0; offset < bytes.length; offset += 136) {
    for (let i = 0; i < 136; i++) state[Math.floor(i / 8)] ^= BigInt(bytes[offset + i]) << BigInt(8 * (i % 8));
    for (const constant of constants) {
      const columns = Array.from({ length: 5 }, (_, x) => state[x] ^ state[x + 5] ^ state[x + 10] ^ state[x + 15] ^ state[x + 20]);
      for (let x = 0; x < 5; x++) {
        const delta = columns[(x + 4) % 5] ^ rotate(columns[(x + 1) % 5], 1);
        for (let y = 0; y < 5; y++) state[x + 5 * y] ^= delta;
      }
      const moved = Array(25).fill(0n);
      for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) moved[y + 5 * ((2 * x + 3 * y) % 5)] = rotate(state[x + 5 * y], rotations[x][y]);
      for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) state[x + 5 * y] = moved[x + 5 * y] ^ ((~moved[(x + 1) % 5 + 5 * y] & mask) & moved[(x + 2) % 5 + 5 * y]);
      state[0] ^= constant;
    }
  }
  return Array.from({ length: 32 }, (_, i) => Number((state[Math.floor(i / 8)] >> BigInt(8 * (i % 8))) & 255n).toString(16).padStart(2, '0')).join('');
}
