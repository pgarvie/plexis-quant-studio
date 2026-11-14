// Helpers partagés par les fournisseurs de données maison (Kraken, Yahoo Finance, Twelve Data).

export class ProviderError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ProviderError';
    if (status != null) this.status = status;
  }
}

/* ------------------------------------------------------------------ */
/*  Messages remontés vers l'interface (barre de données)              */
/* ------------------------------------------------------------------ */

const listeners = new Set();

export function onProviderMessage(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notify(provider, message, level = 'error') {
  for (const fn of listeners) {
    try {
      fn({ provider, message, level });
    } catch {
      /* un écouteur défaillant ne doit jamais casser le chargement */
    }
  }
}

/** Fait remonter vers l'interface les erreurs de `getBars` (Vela les absorbe sinon), puis les relance. */
export function reportErrors(provider, name) {
  const original = provider.getBars.bind(provider);
  provider.getBars = async (...args) => {
    try {
      return await original(...args);
    } catch (e) {
      notify(name, e?.message ?? String(e));
      throw e;
    }
  };
  return provider;
}

/* ------------------------------------------------------------------ */
/*  Timeframes (chaînes canoniques de Vela : '5', '60', 'D', 'W', 'M') */
/* ------------------------------------------------------------------ */

export function parseTimeframe(tf) {
  const s = String(tf ?? '').trim().toUpperCase();
  if (/^\d+$/.test(s)) return { unit: 'm', n: Number(s) };
  let m = /^(\d*)([DWM])$/.exec(s);
  if (m) return { unit: m[2], n: m[1] ? Number(m[1]) : 1 };
  m = /^(\d+)H$/.exec(s);
  if (m) return { unit: 'm', n: Number(m[1]) * 60 };
  return null;
}

/** Durée en minutes d'un timeframe intraday/jour/semaine ; null pour les mois (durée variable). */
export function minutesOf({ unit, n }) {
  if (unit === 'm') return n;
  if (unit === 'D') return n * 1440;
  if (unit === 'W') return n * 10080;
  return null;
}

/** Plus grand intervalle natif (minutes, liste croissante) qui divise exactement `minutes`. */
export function pickBase(minutes, supported) {
  let best = null;
  for (const s of supported) if (s <= minutes && minutes % s === 0) best = s;
  return best;
}

/* ------------------------------------------------------------------ */
/*  Barres                                                             */
/* ------------------------------------------------------------------ */

/** Regroupe des barres triées (croissant) dans des seaux de `bucketMs`, alignés sur l'epoch (UTC). */
export function aggregateBars(bars, bucketMs) {
  const out = [];
  let cur = null;
  for (const b of bars) {
    const t = Math.floor(b.time / bucketMs) * bucketMs;
    if (!cur || cur.time !== t) {
      cur = { time: t, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume ?? 0 };
      out.push(cur);
    } else {
      cur.high = Math.max(cur.high, b.high);
      cur.low = Math.min(cur.low, b.low);
      cur.close = b.close;
      cur.volume += b.volume ?? 0;
    }
  }
  return out;
}

/** Applique la fenêtre demandée par Vela (`from`, `to`, `limit`) à des barres triées. */
export function trimBars(bars, range = {}) {
  let out = bars;
  if (range.from != null) out = out.filter((b) => b.time >= range.from);
  if (range.to != null) out = out.filter((b) => b.time <= range.to);
  if (range.limit != null && out.length > range.limit) out = out.slice(out.length - range.limit);
  return out;
}

export function isValidBar(b) {
  return (
    Number.isFinite(b.time) &&
    Number.isFinite(b.open) &&
    Number.isFinite(b.high) &&
    Number.isFinite(b.low) &&
    Number.isFinite(b.close)
  );
}

/* ------------------------------------------------------------------ */
/*  Réseau                                                             */
/* ------------------------------------------------------------------ */

function hostOf(url) {
  try {
    return new URL(url, location.href).host;
  } catch {
    return url;
  }
}

/**
 * Récupère du JSON. `urls` est une liste de candidats essayés dans l'ordre quand le réseau échoue
 * (CORS, hors ligne) ou que l'adresse répond 404 sans JSON (relais non configuré).
 * Un corps JSON est toujours rendu à l'appelant, même sur un statut d'erreur HTTP : c'est lui qui
 * connaît la forme de ses erreurs (Yahoo : `chart.error`, Kraken : `error[]`, Twelve Data : `status`).
 */
export async function getJson(urls, { provider, hint404 } = {}) {
  let lastErr = null;
  for (const url of urls) {
    let res;
    try {
      res = await fetch(url, { headers: { Accept: 'application/json' } });
    } catch {
      lastErr = new ProviderError(`${provider}: network or CORS error while contacting ${hostOf(url)}`);
      continue;
    }

    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* corps non JSON */
    }
    if (json !== null) return json;

    if (res.status === 404 && hint404) lastErr = new ProviderError(hint404, 404);
    else lastErr = new ProviderError(`${provider}: HTTP ${res.status} from ${hostOf(url)}`, res.status);
    if (res.status === 404 || res.status >= 500) continue;
    throw lastErr;
  }
  throw lastErr ?? new ProviderError(`${provider}: no URL to try`);
}

/* ------------------------------------------------------------------ */
/*  Flux « live » par interrogation périodique                         */
/* ------------------------------------------------------------------ */

/**
 * Sans `subscribe`, Vela interroge `getBars` lui-même, à son rythme. On fournit le nôtre pour
 * maîtriser la cadence (quota Twelve Data, limites Yahoo/Kraken) : une requête légère toutes
 * les `everyMs` ms, suspendue quand l'onglet est caché.
 */
export function pollSubscribe(provider, ticker, timeframe, onBar, everyMs, opts = {}) {
  let stopped = false;
  let timer = 0;

  const tick = async () => {
    if (stopped) return;
    if (!document.hidden) {
      try {
        const bars = await provider.getBars(ticker, timeframe, { limit: 3, session: opts.session });
        if (!stopped) for (const b of bars.slice(-2)) onBar(b);
      } catch {
        /* erreur transitoire : on réessaie au prochain tour */
      }
    }
    if (!stopped) timer = setTimeout(tick, everyMs);
  };

  timer = setTimeout(tick, everyMs);
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
