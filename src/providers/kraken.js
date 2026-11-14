// Kraken (spot, API publique, sans clé). Historique limité par Kraken aux 720 dernières bougies par intervalle.

import {
  ProviderError,
  getJson,
  parseTimeframe,
  minutesOf,
  pickBase,
  aggregateBars,
  trimBars,
  pollSubscribe,
} from './common.js';

const NAME = 'Kraken';
const BASE = 'https://api.kraken.com/0/public';
// Repli si le navigateur bloque l'accès direct (CORS) : règle de réécriture Render, voir le README.
const PROXY = '/proxy/kraken';
const NATIVE = [1, 5, 15, 30, 60, 240, 1440, 10080]; // minutes
const POLL_MS = 10_000;

const norm = (s) => String(s).toUpperCase().replace(/[^A-Z0-9]/g, '');
const fixAsset = (a) => (a === 'XBT' ? 'BTC' : a === 'XDG' ? 'DOGE' : a);

export class KrakenProvider {
  constructor() {
    this.pairs = null;
  }

  info() {
    return {
      name: 'kraken',
      displayName: NAME,
      supportedTimeframes: ['1', '5', '15', '30', '60', '240', '1D', 'W'],
      capabilities: { enumerate: true, stream: true, symbolInfo: true },
    };
  }

  /** Table des paires (une seule requête) : alias → clé Kraken, plus la liste pour la recherche. */
  loadPairs() {
    if (!this.pairs) {
      this.pairs = (async () => {
        const json = await getJson([`${BASE}/AssetPairs`, `${PROXY}/AssetPairs`], { provider: NAME });
        if (json.error?.length) throw new ProviderError(`${NAME}: ${json.error.join(', ')}`);
        const aliases = new Map();
        const list = [];
        for (const [key, p] of Object.entries(json.result ?? {})) {
          if (key.endsWith('.d') || (p.status && p.status !== 'online')) continue;
          const display = p.wsname ? p.wsname.split('/').map(fixAsset).join('/') : (p.altname ?? key);
          const ticker = norm(display);
          list.push({ ticker, description: display, type: 'crypto' });
          for (const a of [key, p.altname, p.wsname, display]) if (a) aliases.set(norm(a), key);
        }
        return { aliases, list };
      })().catch((e) => {
        this.pairs = null; // permet de réessayer plus tard
        throw e;
      });
    }
    return this.pairs;
  }

  async resolve(ticker) {
    try {
      const { aliases } = await this.loadPairs();
      return aliases.get(norm(ticker)) ?? ticker;
    } catch {
      return ticker; // index indisponible : on tente le ticker tel quel (XBTUSD, ETHUSD…)
    }
  }

  async listSymbols() {
    return (await this.loadPairs()).list;
  }

  async getSymbolInfo(ticker) {
    return { ticker, timezone: 'Etc/UTC', session: '24x7' };
  }

  async getBars(ticker, timeframe, range = {}) {
    const p = parseTimeframe(timeframe);
    const minutes = p ? minutesOf(p) : null;
    const interval = minutes && (NATIVE.includes(minutes) ? minutes : pickBase(minutes, NATIVE));
    if (!interval) {
      throw new ProviderError(`${NAME}: timeframe "${timeframe}" is not available (no monthly bars)`);
    }

    const pair = encodeURIComponent(await this.resolve(ticker));
    const q = `/OHLC?pair=${pair}&interval=${interval}`;
    const json = await getJson([`${BASE}${q}`, `${PROXY}${q}`], { provider: NAME });
    if (json.error?.length) throw new ProviderError(`${NAME}: ${json.error.join(', ')}`);

    const key = Object.keys(json.result ?? {}).find((k) => k !== 'last');
    const rows = key ? json.result[key] : [];
    let bars = rows.map((r) => ({
      time: r[0] * 1000,
      open: Number(r[1]),
      high: Number(r[2]),
      low: Number(r[3]),
      close: Number(r[4]),
      volume: Number(r[6]),
    }));
    if (interval !== minutes) bars = aggregateBars(bars, minutes * 60_000);
    return trimBars(bars, range);
  }

  subscribe(ticker, timeframe, onBar, opts) {
    return pollSubscribe(this, ticker, timeframe, onBar, POLL_MS, opts);
  }
}
