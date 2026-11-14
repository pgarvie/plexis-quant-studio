// Yahoo Finance : actions, ETF, indices, contrats à terme (ES=F, GC=F…), forex (EURUSD=X), crypto (BTC-USD).
//
// Yahoo n'envoie pas d'en-têtes CORS : un navigateur ne peut pas l'appeler directement. Les requêtes
// passent donc par un relais de même origine (`/proxy/yahoo/*`) : serveur Vite en local, règle de
// réécriture Render en production (voir le README).

import {
  ProviderError,
  getJson,
  parseTimeframe,
  pickBase,
  aggregateBars,
  trimBars,
  isValidBar,
  pollSubscribe,
} from './common.js';

const NAME = 'Yahoo Finance';
const DAY = 86_400_000;
const INTRADAY = [1, 2, 5, 15, 30, 60, 90]; // minutes servies par Yahoo
const LOOKBACK_DAYS = { 1: 30, 2: 60, 5: 60, 15: 60, 30: 60, 60: 730, 90: 60 };
const WINDOW_DAYS = { 1: 7 }; // 1 m : 7 jours maximum par requête
const POLL_MS = 15_000;

const CURATED = [
  ['AAPL', 'Apple Inc.', 'stock'],
  ['MSFT', 'Microsoft Corporation', 'stock'],
  ['NVDA', 'NVIDIA Corporation', 'stock'],
  ['TSLA', 'Tesla, Inc.', 'stock'],
  ['AMZN', 'Amazon.com, Inc.', 'stock'],
  ['SPY', 'SPDR S&P 500 ETF Trust', 'etf'],
  ['QQQ', 'Invesco QQQ Trust', 'etf'],
  ['IWM', 'iShares Russell 2000 ETF', 'etf'],
  ['GLD', 'SPDR Gold Shares', 'etf'],
  ['TLT', 'iShares 20+ Year Treasury Bond ETF', 'etf'],
  ['ES=F', 'E-mini S&P 500 futures', 'futures'],
  ['NQ=F', 'E-mini Nasdaq-100 futures', 'futures'],
  ['YM=F', 'E-mini Dow futures', 'futures'],
  ['RTY=F', 'E-mini Russell 2000 futures', 'futures'],
  ['GC=F', 'Gold futures', 'futures'],
  ['SI=F', 'Silver futures', 'futures'],
  ['CL=F', 'Crude oil (WTI) futures', 'futures'],
  ['NG=F', 'Natural gas futures', 'futures'],
  ['ZN=F', '10-year T-Note futures', 'futures'],
  ['^GSPC', 'S&P 500 index', 'index'],
  ['^IXIC', 'Nasdaq Composite index', 'index'],
  ['^DJI', 'Dow Jones Industrial Average', 'index'],
  ['^VIX', 'CBOE Volatility Index', 'index'],
  ['EURUSD=X', 'EUR / USD', 'forex'],
  ['USDCAD=X', 'USD / CAD', 'forex'],
  ['BTC-USD', 'Bitcoin / USD', 'crypto'],
  ['ETH-USD', 'Ethereum / USD', 'crypto'],
].map(([ticker, description, type]) => ({ ticker, description, type }));

/** Traduit un timeframe Vela en plan de requête Yahoo (intervalle natif + regroupement éventuel). */
function plan(timeframe) {
  const p = parseTimeframe(timeframe);
  const bad = () => new ProviderError(`${NAME}: timeframe "${timeframe}" is not available`);
  if (!p) throw bad();
  if (p.unit === 'D') {
    if (p.n !== 1) throw bad();
    return { interval: '1d', baseMs: DAY };
  }
  if (p.unit === 'W') {
    if (p.n !== 1) throw bad();
    return { interval: '1wk', baseMs: 7 * DAY };
  }
  if (p.unit === 'M') {
    if (p.n === 1) return { interval: '1mo', baseMs: 30 * DAY };
    if (p.n === 3) return { interval: '3mo', baseMs: 91 * DAY };
    throw bad();
  }
  if (INTRADAY.includes(p.n)) return { interval: `${p.n}m`, baseMin: p.n, baseMs: p.n * 60_000 };
  const base = pickBase(p.n, INTRADAY);
  if (!base) throw bad();
  return { interval: `${base}m`, baseMin: base, baseMs: base * 60_000, bucketMs: p.n * 60_000 };
}

const pad = (n) => String(n).padStart(2, '0');
/** `sec` est déjà décalé à l'heure locale de la bourse : on lit ses composantes UTC. */
function hhmm(sec) {
  const d = new Date(sec * 1000);
  return `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;
}

function infoFromMeta(ticker, meta) {
  const info = { ticker, timezone: meta.exchangeTimezoneName || 'Etc/UTC' };
  const type = String(meta.instrumentType || '').toUpperCase();
  const t = meta.currentTradingPeriod;
  const off = meta.gmtoffset;
  if ((type === 'EQUITY' || type === 'ETF') && t?.regular && Number.isFinite(off)) {
    info.session = `${hhmm(t.regular.start + off)}-${hhmm(t.regular.end + off)}`;
    if (t.pre && t.post) info.session_extended = `${hhmm(t.pre.start + off)}-${hhmm(t.post.end + off)}`;
  }
  if (type === 'INDEX' || type === 'CURRENCY') info.volume = false;
  return info;
}

export class YahooProvider {
  constructor({ proxyBase = '/proxy/yahoo' } = {}) {
    this.proxyBase = proxyBase;
    this.meta = new Map();
  }

  configure(cfg) {
    if (cfg?.proxyBase) this.proxyBase = String(cfg.proxyBase).replace(/\/+$/, '');
  }

  info() {
    return {
      name: 'yahoo',
      displayName: NAME,
      supportedTimeframes: ['1', '2', '5', '15', '30', '60', '90', '1D', 'W', 'M'],
      capabilities: { enumerate: true, stream: true, symbolInfo: true },
    };
  }

  async listSymbols() {
    return CURATED;
  }

  async fetchChart(ticker, query) {
    const url = `${this.proxyBase}/v8/finance/chart/${encodeURIComponent(ticker)}?${query}`;
    const json = await getJson([url], {
      provider: NAME,
      hint404: `${NAME} needs a same-origin proxy: add the rewrite rule /proxy/yahoo/* → https://query1.finance.yahoo.com/* (see README).`,
    });
    const chart = json?.chart;
    if (chart?.error) {
      throw new ProviderError(`${NAME}: ${chart.error.description || chart.error.code || 'request failed'}`);
    }
    const result = chart?.result?.[0];
    if (!result) throw new ProviderError(`${NAME}: no data for ${ticker}`);
    if (result.meta) this.meta.set(ticker, result.meta);
    return result;
  }

  async getSymbolInfo(ticker) {
    let meta = this.meta.get(ticker);
    if (!meta) {
      try {
        meta = (await this.fetchChart(ticker, 'interval=1d&range=5d')).meta;
      } catch {
        return undefined;
      }
    }
    return meta ? infoFromMeta(ticker, meta) : undefined;
  }

  async getBars(ticker, timeframe, range = {}) {
    const pl = plan(timeframe);
    const now = Date.now();
    const to = Math.min(range.to ?? now, now);
    const limit = range.limit ?? 1500;
    const baseCount = pl.bucketMs ? Math.ceil((limit * pl.bucketMs) / pl.baseMs) + 2 : limit;

    let from;
    if (pl.baseMin) {
      const lookback = LOOKBACK_DAYS[pl.baseMin] * DAY;
      const window = (WINDOW_DAYS[pl.baseMin] ?? 3650) * DAY;
      // ×4 : une séance d'actions couvre ~27 % du temps calendaire (nuits, week-ends).
      const span = Math.min(window, Math.max(DAY, baseCount * pl.baseMs * 4));
      from = Math.max(to - span, now - lookback + 3_600_000);
    } else {
      from = Math.max(0, to - baseCount * pl.baseMs * 1.6);
    }
    if (range.from != null) from = Math.max(from, range.from);
    if (from >= to) return [];

    const query =
      `interval=${pl.interval}&period1=${Math.floor(from / 1000)}&period2=${Math.ceil((to + 60_000) / 1000)}` +
      `&includePrePost=${range.session === 'extended'}`;
    const result = await this.fetchChart(ticker, query);

    const ts = result.timestamp ?? [];
    const q = result.indicators?.quote?.[0] ?? {};
    let bars = [];
    for (let i = 0; i < ts.length; i++) {
      const bar = {
        time: ts[i] * 1000,
        open: q.open?.[i],
        high: q.high?.[i],
        low: q.low?.[i],
        close: q.close?.[i],
        volume: q.volume?.[i] ?? 0,
      };
      if (isValidBar(bar)) bars.push(bar);
    }
    if (pl.bucketMs) bars = aggregateBars(bars, pl.bucketMs);
    return trimBars(bars, range);
  }

  subscribe(ticker, timeframe, onBar, opts) {
    return pollSubscribe(this, ticker, timeframe, onBar, POLL_MS, opts);
  }
}
