// Sources de données disponibles dans la barre « Source / Symbol ».
// L'ordre d'enregistrement fixe la priorité pour un symbole sans préfixe (BTC → Hyperliquid, etc.).

import { HyperliquidProvider } from '@luxalgo/vela/providers/hyperliquid';
import { BinanceProvider } from '@luxalgo/vela/providers/binance';
import { CoinbaseProvider } from '@luxalgo/vela/providers/coinbase';
import { KrakenProvider } from './providers/kraken.js';
import { YahooProvider } from './providers/yahoo.js';
import { TwelveDataProvider } from './providers/twelvedata.js';
import { reportErrors } from './providers/common.js';

export const SOURCES = [
  {
    id: 'hyperliquid',
    label: 'Hyperliquid',
    prefix: 'HYPERLIQUID',
    defaultSymbol: 'BTC',
    examples: ['BTC', 'ETH', 'SOL', 'HYPE', 'xyz:TSLA', 'xyz:GOLD'],
    hint: 'Crypto perps, plus HIP-3 stocks/commodities (xyz:TSLA)',
  },
  {
    id: 'binance',
    label: 'Binance',
    prefix: 'BINANCE',
    defaultSymbol: 'BTCUSDT',
    examples: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BTCUSDT.P', 'ETHUSDT.P'],
    hint: 'Spot and USDT perpetuals (.P)',
  },
  {
    id: 'coinbase',
    label: 'Coinbase',
    prefix: 'COINBASE',
    defaultSymbol: 'BTC-USD',
    examples: ['BTC-USD', 'ETH-USD', 'SOL-USD', 'ETH-BTC'],
    hint: 'Spot products',
  },
  {
    id: 'kraken',
    label: 'Kraken',
    prefix: 'KRAKEN',
    defaultSymbol: 'BTCUSD',
    examples: ['BTCUSD', 'ETHUSD', 'SOLUSD', 'XRPUSD', 'ETHBTC'],
    hint: 'Spot. Kraken serves the latest 720 candles per timeframe',
  },
  {
    id: 'yahoo',
    label: 'Yahoo Finance',
    prefix: 'YAHOO',
    defaultSymbol: 'AAPL',
    examples: ['AAPL', 'MSFT', 'SPY', 'QQQ', 'ES=F', 'NQ=F', 'GC=F', 'CL=F', '^GSPC', 'EURUSD=X', 'BTC-USD'],
    hint: 'Stocks, ETFs, futures (ES=F), indices (^GSPC), forex (EURUSD=X)',
  },
  {
    id: 'twelvedata',
    label: 'Twelve Data',
    prefix: 'TWELVEDATA',
    defaultSymbol: 'AAPL',
    examples: ['AAPL', 'MSFT', 'SPY', 'EUR/USD', 'BTC/USD'],
    hint: 'Stocks, ETFs, forex, crypto. Needs an API key',
    needsKey: true,
  },
];

export const SOURCE_BY_ID = Object.fromEntries(SOURCES.map((s) => [s.id, s]));

// Instances partagées : l'interface les (re)configure (clé d'API, relais) sans les recréer.
export const yahoo = reportErrors(new YahooProvider(), 'yahoo');
export const twelveData = reportErrors(new TwelveDataProvider(), 'twelvedata');

/** Fabriques passées au workspace Vela (`providers`). */
export function createProviders() {
  return {
    hyperliquid: () => new HyperliquidProvider(),
    binance: () => new BinanceProvider(),
    coinbase: () => new CoinbaseProvider(),
    kraken: () => reportErrors(new KrakenProvider(), 'kraken'),
    yahoo: () => yahoo,
    twelvedata: () => twelveData,
  };
}

/** Normalise ce que l'utilisateur tape (casse) selon la source. */
export function normalizeSymbol(sourceId, raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  if (sourceId === 'hyperliquid') return s.includes(':') ? s : s.toUpperCase();
  return s.toUpperCase();
}

/** `YAHOO:AAPL` → { source, symbol } ; sans préfixe connu → null. */
export function splitPrefixed(text) {
  const i = String(text).indexOf(':');
  if (i < 1) return null;
  const prefix = text.slice(0, i).toLowerCase();
  const src = SOURCES.find((s) => s.id === prefix || s.prefix.toLowerCase() === prefix);
  return src ? { source: src, symbol: text.slice(i + 1) } : null;
}
