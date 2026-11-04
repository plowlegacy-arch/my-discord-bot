// Chain registry. A chain is only marked `live` when a discovery pipeline is
// actually implemented and wired to its own RPC endpoint.
//
// EVM chains share one generic pipeline (contract creation + DEX factory logs).
// Solana has a dedicated pipeline (SPL mint init + launchpad program + AMM pool init).
// Networks without an implemented pipeline are listed as `planned` and never scanned.

export const DEX_FACTORIES = {
  uniswapV2: { address: '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f', kind: 'v2', name: 'Uniswap V2' },
  uniswapV3: { address: '0x1F98431c8aD98523631AE4a59f267346ea31F984', kind: 'v3', name: 'Uniswap V3' },
  pancakeswapV2: { address: '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73', kind: 'v2', name: 'PancakeSwap V2' },
  pancakeswapV3: { address: '0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865', kind: 'v3', name: 'PancakeSwap V3' },
  aerodrome: { address: '0x420DD381b31aEf6683db6B902084cB0FFECe40Da', kind: 'v2', name: 'Aerodrome' },
  uniswapV3Base: { address: '0x33128a8fC17869897dcE68Ed026d694621f6FDfD', kind: 'v3', name: 'Uniswap V3' },
  sushiswap: { address: '0xC0AEe478e3658e2610c5F7A4A2E1777cE9D25BEB', kind: 'v2', name: 'SushiSwap' },
  camelot: { address: '0x6EcCab422D763aC031210895C81787E87B43A652', kind: 'v2', name: 'Camelot' },
  velodrome: { address: '0xF1046053aa5682b4F9a81b5481394DA16BE5FF5a', kind: 'v2', name: 'Velodrome' },
  quickswap: { address: '0x5757371414417b8C6CAad45bAeF941aBc7d3Ab32', kind: 'v2', name: 'QuickSwap' },
  traderjoe: { address: '0x9Ad6C38BE94206cA50bb0d90783181662f0Cfa10', kind: 'v2', name: 'Trader Joe' },
  spooky: { address: '0x152eE697f2E276fA89E96742e9bB9aB1F2E61bE3', kind: 'v2', name: 'SpookySwap' },
  shadow: { address: '0x96536f0cE7D4A5E2F3AF6d8FA0d0d6a6b2FA5bE6', kind: 'v2', name: 'Shadow Exchange' },
};

const evm = (id, name, opts) => ({
  id,
  name,
  family: 'evm',
  nativeSymbol: opts.nativeSymbol,
  rpcEnv: `RPC_URL_${id.toUpperCase()}`,
  defaultRpc: opts.defaultRpc,
  explorer: opts.explorer,
  wrappedNative: opts.wrappedNative,
  stableTokens: opts.stableTokens || [],
  factories: opts.factories || [],
  blockTimeMs: opts.blockTimeMs || 12000,
  startLookback: opts.startLookback || 60,
  maxBlocksPerTick: opts.maxBlocksPerTick || 3,
  quoteIsUsd: opts.quoteIsUsd || {},
  status: 'live',
});

export const CHAINS = [
  evm('ethereum', 'Ethereum', {
    nativeSymbol: 'ETH',
    defaultRpc: 'https://ethereum-rpc.publicnode.com',
    explorer: 'https://etherscan.io',
    wrappedNative: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    stableTokens: ['0xdAC17F958D2ee523a2206206994597C13D831ec7', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'],
    quoteIsUsd: { '0xdac17f958d2ee523a2206206994597c13d831ec7': 1, '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 1 },
    factories: [DEX_FACTORIES.uniswapV2, DEX_FACTORIES.uniswapV3, DEX_FACTORIES.sushiswap],
    maxBlocksPerTick: 2,
  }),
  evm('bsc', 'BNB Chain', {
    nativeSymbol: 'BNB',
    defaultRpc: 'https://bsc-rpc.publicnode.com',
    explorer: 'https://bscscan.com',
    wrappedNative: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
    stableTokens: ['0x55d398326f99059fF775485246999027B3197955'],
    quoteIsUsd: { '0x55d398326f99059ff775485246999027b3197955': 1 },
    factories: [DEX_FACTORIES.pancakeswapV2, DEX_FACTORIES.pancakeswapV3],
    blockTimeMs: 3000,
    maxBlocksPerTick: 5,
  }),
  evm('base', 'Base', {
    nativeSymbol: 'ETH',
    defaultRpc: 'https://base-rpc.publicnode.com',
    explorer: 'https://basescan.org',
    wrappedNative: '0x4200000000000000000000000000000000000006',
    stableTokens: ['0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'],
    quoteIsUsd: { '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': 1 },
    factories: [DEX_FACTORIES.uniswapV3Base, DEX_FACTORIES.aerodrome],
    blockTimeMs: 2000,
    maxBlocksPerTick: 8,
  }),
  evm('arbitrum', 'Arbitrum One', {
    nativeSymbol: 'ETH',
    defaultRpc: 'https://arbitrum-one-rpc.publicnode.com',
    explorer: 'https://arbiscan.io',
    wrappedNative: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    stableTokens: ['0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', '0xaf88d065e77c8cC2239327C5EDb3A432268e5831'],
    quoteIsUsd: { '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9': 1, '0xaf88d065e77c8cc2239327c5edb3a432268e5831': 1 },
    factories: [DEX_FACTORIES.uniswapV3, DEX_FACTORIES.camelot, DEX_FACTORIES.sushiswap],
    blockTimeMs: 250,
    maxBlocksPerTick: 40,
  }),
  evm('optimism', 'Optimism', {
    nativeSymbol: 'ETH',
    defaultRpc: 'https://optimism-rpc.publicnode.com',
    explorer: 'https://optimistic.etherscan.io',
    wrappedNative: '0x4200000000000000000000000000000000000006',
    stableTokens: ['0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85'],
    quoteIsUsd: { '0x0b2c639c533813f4aa9d7837caf62653d097ff85': 1 },
    factories: [DEX_FACTORIES.uniswapV3, DEX_FACTORIES.velodrome],
    blockTimeMs: 2000,
    maxBlocksPerTick: 8,
  }),
  evm('polygon', 'Polygon', {
    nativeSymbol: 'POL',
    defaultRpc: 'https://polygon-bor-rpc.publicnode.com',
    explorer: 'https://polygonscan.com',
    wrappedNative: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
    stableTokens: ['0xc2132D05D31c914a87C6611C10748AEb04B58e8F', '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359'],
    quoteIsUsd: { '0xc2132d05d31c914a87c6611c10748aeb04b58e8f': 1, '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359': 1 },
    factories: [DEX_FACTORIES.quickswap, DEX_FACTORIES.uniswapV3],
    blockTimeMs: 2100,
    maxBlocksPerTick: 8,
  }),
  evm('avalanche', 'Avalanche C-Chain', {
    nativeSymbol: 'AVAX',
    defaultRpc: 'https://avalanche-c-chain-rpc.publicnode.com',
    explorer: 'https://snowtrace.io',
    wrappedNative: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7',
    stableTokens: ['0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7'],
    quoteIsUsd: { '0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7': 1 },
    factories: [DEX_FACTORIES.traderjoe, DEX_FACTORIES.sushiswap],
    blockTimeMs: 2000,
    maxBlocksPerTick: 8,
  }),
  evm('sonic', 'Sonic', {
    nativeSymbol: 'S',
    defaultRpc: 'https://rpc.soniclabs.com',
    explorer: 'https://sonicscan.org',
    wrappedNative: '0x039e2fB66102314Ce7b64Ce5Ce3E5183bc94aD38',
    stableTokens: ['0x29219dd400f2Bf60E5a23d94E554AcF4289Dd77b'],
    quoteIsUsd: { '0x29219dd400f2bf60e5a23d94e554acf4289dd77b': 1 },
    factories: [DEX_FACTORIES.shadow, DEX_FACTORIES.spooky],
    blockTimeMs: 1000,
    maxBlocksPerTick: 15,
  }),
  evm('monad', 'Monad Testnet', {
    nativeSymbol: 'MON',
    defaultRpc: 'https://testnet-rpc.monad.xyz',
    explorer: 'https://testnet.monadexplorer.com',
    wrappedNative: null,
    factories: [],
    blockTimeMs: 500,
    maxBlocksPerTick: 20,
  }),
  evm('seievm', 'Sei EVM', {
    nativeSymbol: 'SEI',
    defaultRpc: 'https://evm-rpc.sei-apis.com',
    explorer: 'https://seitrace.com',
    wrappedNative: '0xE30feDd158A2e3b13e9badaeABaFc5516FEc77a0',
    factories: [],
    blockTimeMs: 400,
    maxBlocksPerTick: 20,
  }),
  evm('hyperevm', 'HyperEVM', {
    nativeSymbol: 'HYPE',
    defaultRpc: 'https://rpc.hyperliquid.xyz/evm',
    explorer: 'https://hyperevmscan.io',
    wrappedNative: '0x5555555555555555555555555555555555555555',
    stableTokens: ['0xb8ce59fc3717ada4c02eadf9682a9e934f625ebb'],
    quoteIsUsd: { '0xb8ce59fc3717ada4c02eadf9682a9e934f625ebb': 1 },
    factories: [],
    blockTimeMs: 1000,
    maxBlocksPerTick: 15,
  }),
  {
    id: 'solana',
    name: 'Solana',
    family: 'solana',
    nativeSymbol: 'SOL',
    rpcEnv: 'RPC_URL_SOLANA',
    defaultRpc: 'https://api.mainnet-beta.solana.com',
    explorer: 'https://solscan.io',
    blockTimeMs: 400,
    maxSlotsPerTick: 12,
    status: 'live',
  },
  {
    id: 'sui',
    name: 'Sui',
    family: 'sui',
    nativeSymbol: 'SUI',
    rpcEnv: 'RPC_URL_SUI',
    defaultRpc: 'https://fullnode.mainnet.sui.io',
    explorer: 'https://suiscan.xyz',
    status: 'planned',
    note: 'Move object model pipeline not implemented yet.',
  },
  {
    id: 'ton',
    name: 'TON',
    family: 'ton',
    nativeSymbol: 'TON',
    rpcEnv: 'RPC_URL_TON',
    defaultRpc: null,
    explorer: 'https://tonviewer.com',
    status: 'planned',
    note: 'Requires a TON indexer/adnl client; not implemented.',
  },
  {
    id: 'aptos',
    name: 'Aptos',
    family: 'aptos',
    nativeSymbol: 'APT',
    rpcEnv: 'RPC_URL_APTOS',
    defaultRpc: 'https://fullnode.mainnet.aptoslabs.com',
    explorer: 'https://explorer.aptoslabs.com',
    status: 'planned',
    note: 'Move resource-change pipeline not implemented yet.',
  },
];

export const chainById = (id) => CHAINS.find((c) => c.id === id);
export const liveChains = () => CHAINS.filter((c) => c.status === 'live');

export function rpcUrl(chain) {
  return process.env[chain.rpcEnv] || chain.defaultRpc || null;
}

export function explorerTx(chain, tx) {
  if (!chain.explorer || !tx) return null;
  if (chain.family === 'solana') return `${chain.explorer}/tx/${tx}`;
  return `${chain.explorer}/tx/${tx}`;
}

export function explorerToken(chain, address) {
  if (!chain.explorer) return null;
  return `${chain.explorer}/token/${address}`;
}

export function isEnabled(chain) {
  if (process.env.DISABLED_CHAINS) {
    const disabled = process.env.DISABLED_CHAINS.split(',').map((s) => s.trim().toLowerCase());
    if (disabled.includes(chain.id)) return false;
  }
  return Boolean(rpcUrl(chain));
}

// Solana program ids used by the native pipeline.
export const SOLANA_PROGRAMS = {
  token: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  token2022: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
  pumpFun: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
  pumpAmm: 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA',
  raydiumAmmV4: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
  raydiumCpmm: 'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C',
  raydiumLaunchpad: 'LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj',
  meteoraDlmm: 'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo',
  orcaWhirlpool: 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',
  meteoraDbc: 'dbcij3LWUUnEPpm9UZNdvfdZ4mGpTFa7f5t5d2gQwU2',
};

export const SOLANA_AMM_PROGRAMS = new Set([
  SOLANA_PROGRAMS.raydiumAmmV4,
  SOLANA_PROGRAMS.raydiumCpmm,
  SOLANA_PROGRAMS.meteoraDlmm,
  SOLANA_PROGRAMS.orcaWhirlpool,
  SOLANA_PROGRAMS.pumpAmm,
  SOLANA_PROGRAMS.meteoraDbc,
]);

export const SOLANA_LAUNCH_PROGRAMS = {
  [SOLANA_PROGRAMS.pumpFun]: { name: 'pump.fun', kind: 'bonding-curve' },
  [SOLANA_PROGRAMS.raydiumLaunchpad]: { name: 'Raydium LaunchLab', kind: 'launchpad' },
  [SOLANA_PROGRAMS.meteoraDbc]: { name: 'Meteora DBC', kind: 'bonding-curve' },
};
