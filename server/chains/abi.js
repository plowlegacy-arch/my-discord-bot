// Tiny dependency-free keccak-256 (used only for ABI event/selector hashes).
const MASK = (1n << 64n) - 1n;

const RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
const ROT = [
  [0, 36, 3, 41, 18],
  [1, 44, 10, 45, 2],
  [62, 6, 43, 15, 61],
  [28, 55, 25, 21, 56],
  [27, 20, 39, 8, 14],
];
const rl = (x, n) => (n === 0 ? x : ((x << BigInt(n)) | (x >> BigInt(64 - n))) & MASK);

function keccakF(s) {
  for (let round = 0; round < 24; round++) {
    const C = [0n, 0n, 0n, 0n, 0n];
    for (let x = 0; x < 5; x++) C[x] = s[x][0] ^ s[x][1] ^ s[x][2] ^ s[x][3] ^ s[x][4];
    for (let x = 0; x < 5; x++) {
      const D = C[(x + 4) % 5] ^ rl(C[(x + 1) % 5], 1);
      for (let y = 0; y < 5; y++) s[x][y] ^= D;
    }
    const B = Array.from({ length: 5 }, () => [0n, 0n, 0n, 0n, 0n]);
    for (let x = 0; x < 5; x++)
      for (let y = 0; y < 5; y++) B[y][(2 * x + 3 * y) % 5] = rl(s[x][y], ROT[x][y]);
    for (let x = 0; x < 5; x++)
      for (let y = 0; y < 5; y++) s[x][y] = B[x][y] ^ (~B[(x + 1) % 5][y] & MASK & B[(x + 2) % 5][y]);
    s[0][0] ^= RC[round];
  }
}

export function keccak256(input) {
  const data = typeof input === 'string' ? Buffer.from(input, 'utf8') : Buffer.from(input);
  const rate = 136;
  const padLen = rate - (data.length % rate);
  const padded = Buffer.alloc(data.length + padLen);
  data.copy(padded);
  padded[data.length] ^= 0x01;
  padded[padded.length - 1] ^= 0x80;
  const s = Array.from({ length: 5 }, () => [0n, 0n, 0n, 0n, 0n]);
  for (let off = 0; off < padded.length; off += rate) {
    for (let i = 0; i < rate / 8; i++) {
      const lane = padded.readBigUInt64LE(off + i * 8);
      s[i % 5][Math.floor(i / 5)] ^= lane;
    }
    keccakF(s);
  }
  const out = Buffer.alloc(32);
  for (let i = 0; i < 4; i++) out.writeBigUInt64LE(s[i % 5][Math.floor(i / 5)], i * 8);
  return '0x' + out.toString('hex');
}

export const eventTopic = (sig) => keccak256(sig);
export const selector = (sig) => keccak256(sig).slice(0, 10);

export const TOPICS = {
  Transfer: eventTopic('Transfer(address,address,uint256)'),
  Sync: eventTopic('Sync(uint112,uint112)'),
  SwapV2: eventTopic('Swap(address,uint256,uint256,uint256,uint256,address)'),
  SwapV3: eventTopic('Swap(address,address,int256,int256,uint160,uint128,int24)'),
  PairCreated: eventTopic('PairCreated(address,address,address,uint256)'),
  PoolCreated: eventTopic('PoolCreated(address,address,uint24,int24,address)'),
  Approval: eventTopic('Approval(address,address,uint256)'),
  OwnershipTransferred: eventTopic('OwnershipTransferred(address,address)'),
  Mint: eventTopic('Mint(address,address,uint256)'),
  Burn: eventTopic('Burn(address,uint256)'),
  Initialize: eventTopic('Initialize(uint160,int24)'),
  TokenCreate: eventTopic('TokenCreated(address,address,uint256,string,string,uint256)'),
};

export const SEL = {
  name: selector('name()'),
  symbol: selector('symbol()'),
  decimals: selector('decimals()'),
  totalSupply: selector('totalSupply()'),
  token0: selector('token0()'),
  token1: selector('token1()'),
  getReserves: selector('getReserves()'),
  owner: selector('owner()'),
  paused: selector('paused()'),
  balanceOf: selector('balanceOf(address)'),
};

export function decodeUint(hex) {
  if (!hex || hex === '0x') return null;
  return BigInt(hex);
}

export function decodeString(hex) {
  if (!hex || hex === '0x') return null;
  const raw = Buffer.from(hex.slice(2), 'hex');
  if (raw.length < 64) return null;
  try {
    const len = Number(raw.readBigUInt64BE(32));
    if (!Number.isFinite(len) || len <= 0 || len > 512) {
      return raw.slice(0, 32).toString('utf8').replace(/\0/g, '').trim() || null;
    }
    return raw.slice(64, 64 + len).toString('utf8').replace(/\0/g, '').trim();
  } catch {
    return null;
  }
}

export function decodeAddress(word) {
  if (!word) return null;
  return '0x' + word.slice(-40);
}
