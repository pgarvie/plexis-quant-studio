// Twelve Data : actions, ETF, forex, crypto (et, selon le forfait, contrats à terme). Clé d'API requise.
// La clé reste dans le navigateur (localStorage) et n'est envoyée qu'à api.twelvedata.com.
// Le forfait gratuit a des quotas stricts par minute et par jour : la mise à jour « live » n'interroge
// donc qu'une fois par minute, et seulement quand l'onglet est visible.

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

const NAME = 'Twelve Data';
const BASE = 'https://api.twelvedata.com';
const POLL_MS = 60_000;
const DAY = 86_400_000;

const NATIVE_MIN = { 1: '1min', 5: '5min', 15: '15min', 30: '30min', 45: '45min', 60: '1h', 120: '2h', 240: '4h', 480: '8h' };
const BASES = Object.keys(NATIVE_MIN).map(Number).sort((a, b) => a - b);

function plan(timeframe) {
  const p = parseTimeframe(timeframe);
  const bad = () => new ProviderError(`${NAME}: timeframe "${timeframe}" is not available`);
  if (!p) throw bad();
  if (p.unit === 'D') {
    if (p.n !== 1) throw bad();
    return { interval: '1day', baseMs: DAY };
  }
  if (p.unit === 'W') {
    if (p.n !== 1) throw bad();
    return { interval: '1week', baseMs: 7 * DAY };
  }
  if (p.unit === 'M') {
    if (p.n !== 1) throw bad();
    return { interval: '1month', baseMs: 30 * DAY };
  }
  if (NATIVE_MIN[p.n]) return { interval: NATIVE_MIN[p.n], baseMs: p.n * 60_000 };
  const base = pickBase(p.n, BASES);
  if (!base) throw bad();
  return { interval: NATIVE_MIN[base], baseMs: base * 60_000, bucketMs: p.n * 60_000 };
}

/** « 2026-11-12 15:00:00 » ou « 2026-11-12 » (demandés en UTC) → epoch ms. */
function parseDatetime(s) {
  if (typeof s !== 'string') return NaN;
  return Date.parse(s.length <= 10 ? `${s}T00:00:00Z` : `${s.replace(' ', 'T')}Z`);
}

const formatDatetime = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

export class TwelveDataProvider {
  constructor() {
    this.apiKey = '';
  }

  configure(cfg) {
    if (cfg && 'apiKey' in cfg) this.apiKey = String(cfg.apiKey ?? '').trim();
  }

  info() {
    return {
      name: 'twelvedata',
      displayName: NAME,
      requiresApiKey: true,
      supportedTimeframes: ['1', '5', '15', '30', '45', '60', '120', '240', '480', '1D', 'W', 'M'],
      capabilities: { enumerate: false, stream: true, symbolInfo: true },
    };
  }

  // Pas d'appel réseau ici : chaque requête consomme du quota.
  async getSymbolInfo(ticker) {
    return { ticker, timezone: 'Etc/UTC' };
  }

  async getBars(ticker, timeframe, range = {}) {
    if (!this.apiKey) throw new ProviderError(`${NAME}: API key required — paste it in the data bar.`);

    const pl = plan(timeframe);
    const limit = range.limit ?? 1500;
    const count = pl.bucketMs ? Math.ceil((limit * pl.bucketMs) / pl.baseMs) + 2 : limit;

    const params = new URLSearchParams({
      symbol: ticker,
      interval: pl.interval,
      outputsize: String(Math.min(5000, Math.max(2, count))),
      order: 'ASC',
      timezone: 'UTC',
      apikey: this.apiKey,
    });
    if (range.to != null && range.to < Date.now() - pl.baseMs) params.set('end_date', formatDatetime(range.to));

    const json = await getJson([`${BASE}/time_series?${params}`], { provider: NAME });
    if (json.status === 'error' || (!Array.isArray(json.values) && json.code)) {
      throw new ProviderError(`${NAME}: ${json.message || `error ${json.code ?? ''}`.trim()}`);
    }

    let bars = (json.values ?? [])
      .map((v) => ({
        time: parseDatetime(v.datetime),
        open: Number(v.open),
        high: Number(v.high),
        low: Number(v.low),
        close: Number(v.close),
        volume: v.volume != null ? Number(v.volume) : undefined,
      }))
      .filter(isValidBar)
      .sort((a, b) => a.time - b.time);

    if (pl.bucketMs) bars = aggregateBars(bars, pl.bucketMs);
    return trimBars(bars, range);
  }

  subscribe(ticker, timeframe, onBar, opts) {
    return pollSubscribe(this, ticker, timeframe, onBar, POLL_MS, opts);
  }
}
