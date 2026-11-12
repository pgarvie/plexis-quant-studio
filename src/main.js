import './style.css';

import { VelaWorkspace } from '@luxalgo/vela/workspace';
import { HyperliquidProvider } from '@luxalgo/vela/providers/hyperliquid';
import { PineWorkerEngine } from '@luxalgo/vela-pinets';

import * as monaco from 'monaco-editor/esm/vs/editor/edcore.main';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';

import { registerPineScript, PINE_LANGUAGE_ID, PINE_THEME_ID } from './pinescript-monaco.js';
import { TEMPLATES, DEFAULT_TEMPLATE } from './templates.js';

/* ------------------------------------------------------------------ */
/*  Paramètres                                                         */
/* ------------------------------------------------------------------ */

const SYMBOL = 'BTC'; // Hyperliquid : coins nus (BTC, ETH…)
const TIMEFRAME = '60'; // minutes → 1h
const DATA_TIMEOUT_MS = 20000;

const params = new URLSearchParams(location.search);
const OFFLINE = params.has('offline'); // ?offline : barres synthétiques, sans réseau (tests)

/* ------------------------------------------------------------------ */
/*  Éléments du DOM                                                    */
/* ------------------------------------------------------------------ */

const $ = (id) => document.getElementById(id);
const els = {
  select: $('template-select'),
  run: $('btn-run'),
  reset: $('btn-reset'),
  share: $('btn-share'),
  editor: $('editor'),
  status: $('status'),
  split: $('split'),
  gutter: $('gutter'),
  toast: $('toast'),
};

/* ------------------------------------------------------------------ */
/*  Monaco                                                             */
/* ------------------------------------------------------------------ */

self.MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

registerPineScript(monaco);

const initial = readSharedState() ?? { template: DEFAULT_TEMPLATE, code: TEMPLATES[DEFAULT_TEMPLATE].code };

const editor = monaco.editor.create(els.editor, {
  value: initial.code,
  language: PINE_LANGUAGE_ID,
  theme: PINE_THEME_ID,
  automaticLayout: true,
  fontFamily: "'JetBrains Mono', ui-monospace, 'SF Mono', 'Cascadia Code', Menlo, Consolas, monospace",
  fontSize: 14,
  lineHeight: 24,
  tabSize: 4,
  insertSpaces: true,
  detectIndentation: false,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  folding: false,
  glyphMargin: false,
  lineDecorationsWidth: 12,
  lineNumbersMinChars: 3,
  renderLineHighlight: 'none',
  overviewRulerLanes: 0,
  hideCursorInOverviewRuler: true,
  padding: { top: 16, bottom: 16 },
  scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8, useShadows: false },
  smoothScrolling: true,
  cursorSmoothCaretAnimation: 'on',
  autoIndent: 'full',
  formatOnType: false,
  quickSuggestions: false,
  suggestOnTriggerCharacters: false,
  wordBasedSuggestions: 'off',
  contextmenu: true,
  accessibilitySupport: 'auto',
});

const model = editor.getModel();

/* ------------------------------------------------------------------ */
/*  Liste des exemples                                                 */
/* ------------------------------------------------------------------ */

for (const [key, t] of Object.entries(TEMPLATES)) {
  const opt = document.createElement('option');
  opt.value = key;
  opt.textContent = t.label;
  els.select.appendChild(opt);
}
els.select.value = TEMPLATES[initial.template] ? initial.template : DEFAULT_TEMPLATE;

/* ------------------------------------------------------------------ */
/*  Graphique Vela + moteur Pine                                       */
/* ------------------------------------------------------------------ */

const workspaceOptions = {
  layout: false, // un seul graphique
  symbol: SYMBOL,
  timeframe: TIMEFRAME,
  theme: 'dark',
  live: !OFFLINE,
  engines: { pine: () => new PineWorkerEngine() }, // exécution dans un Web Worker
};

if (OFFLINE) {
  workspaceOptions.data = syntheticBars(1500, 60 * 60 * 1000);
} else {
  workspaceOptions.providers = { hyperliquid: () => new HyperliquidProvider() };
}

const workspace = new VelaWorkspace('#chart', workspaceOptions);

let handle = null; // indicateur / stratégie actuellement tracé(e)
let running = false;
let dataReady = false;

/* ------------------------------------------------------------------ */
/*  Barre de statut                                                    */
/* ------------------------------------------------------------------ */

const ICON_OK =
  '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="m3 8.5 3.2 3.2L13 4.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_ERR =
  '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

function setStatus(kind, text) {
  const cls = kind === 'ok' ? 'status-ok' : kind === 'err' ? 'status-err' : 'status-dim';
  const icon = kind === 'ok' ? ICON_OK : kind === 'err' ? ICON_ERR : '';
  els.status.innerHTML = '';
  const wrap = document.createElement('span');
  wrap.className = `${cls}`;
  wrap.style.display = 'flex';
  wrap.style.gap = '8px';
  wrap.style.alignItems = 'flex-start';
  if (icon) wrap.insertAdjacentHTML('beforeend', icon);
  const span = document.createElement('span');
  span.textContent = text;
  wrap.appendChild(span);
  els.status.appendChild(wrap);
}

/* ------------------------------------------------------------------ */
/*  Erreurs : message lisible + marqueur Monaco                        */
/* ------------------------------------------------------------------ */

function extractLocation(message) {
  // « line 5 », « line 5:3 », « (5:3) », « at 5:3 », « ligne 5 »
  const patterns = [
    /\bline\s+(\d+)(?:\s*[:,]\s*(?:col(?:umn)?\s*)?(\d+))?/i,
    /\bligne\s+(\d+)(?:\s*[:,]\s*(?:col(?:onne)?\s*)?(\d+))?/i,
    /\((\d+):(\d+)\)/,
    /\bat\s+(\d+):(\d+)\b/i,
  ];
  for (const re of patterns) {
    const m = re.exec(message);
    if (m) return { line: Number(m[1]), column: m[2] ? Number(m[2]) : 1 };
  }
  return null;
}

function showError(error) {
  const message = String(error?.message ?? error ?? 'Erreur inconnue').trim();
  const loc = extractLocation(message);
  const where = loc ? `Ligne ${loc.line}${loc.column > 1 ? `, col. ${loc.column}` : ''} — ` : '';
  setStatus('err', `${where}${message}`);

  if (loc && loc.line >= 1 && loc.line <= model.getLineCount()) {
    const maxCol = model.getLineMaxColumn(loc.line);
    monaco.editor.setModelMarkers(model, 'pine', [
      {
        severity: monaco.MarkerSeverity.Error,
        message,
        startLineNumber: loc.line,
        startColumn: Math.min(loc.column, maxCol),
        endLineNumber: loc.line,
        endColumn: maxCol,
      },
    ]);
  }
}

function clearMarkers() {
  monaco.editor.setModelMarkers(model, 'pine', []);
}

/* ------------------------------------------------------------------ */
/*  Exécution                                                          */
/* ------------------------------------------------------------------ */

function scriptNameFromSource(source) {
  const m = /\b(?:indicator|strategy|library)\s*\(\s*(?:title\s*=\s*)?(["'])(.*?)\1/.exec(source);
  return m ? m[2] : 'Script';
}

async function runScript() {
  if (running) return;
  running = true;
  els.run.disabled = true;
  clearMarkers();

  const source = editor.getValue();
  setStatus('dim', dataReady ? 'Exécution…' : 'Chargement des données de marché…');

  const t0 = performance.now();
  let outcome;

  try {
    const chart = workspace.chart;
    const alive = handle && chart.indicators().some((h) => h.id === handle.id);

    if (alive) {
      // Mise à jour en place : même ligne de légende ; en cas d'échec, l'ancienne version reste affichée.
      const r = await handle.updateCode(source);
      outcome = r.ok ? { ok: true, handle } : { ok: false, error: r.error };
    } else {
      handle = null;
      const r = await chart.runIndicator(source, { language: 'pine' });
      if (r.ok) handle = r.handle;
      outcome = r.ok ? { ok: true, handle: r.handle } : { ok: false, error: r.error };
    }
  } catch (e) {
    outcome = { ok: false, error: e };
  }

  const ms = Math.round(performance.now() - t0);

  if (outcome.ok) {
    // Le titre déclaré dans le script prime : `handle.title` vaut « Indicator » juste après le premier run.
    const declared = scriptNameFromSource(source);
    const name = declared !== 'Script' ? declared : outcome.handle?.title || declared;
    setStatus('ok', `${name} ran in ${ms} ms. Edit the script and press ⌘/Ctrl+Enter to run it again.`);
  } else {
    showError(outcome.error);
  }

  running = false;
  els.run.disabled = false;
}

/* ------------------------------------------------------------------ */
/*  Actions de l'interface                                             */
/* ------------------------------------------------------------------ */

els.run.addEventListener('click', runScript);

// ⌘/Ctrl + Entrée, où que soit le focus (éditeur ou graphique).
window.addEventListener(
  'keydown',
  (e) => {
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      runScript();
    }
  },
  true,
);

els.select.addEventListener('change', () => {
  const t = TEMPLATES[els.select.value];
  if (!t) return;
  editor.setValue(t.code);
  runScript();
});

els.reset.addEventListener('click', () => {
  const t = TEMPLATES[els.select.value] ?? TEMPLATES[DEFAULT_TEMPLATE];
  editor.setValue(t.code);
  runScript();
});

els.share.addEventListener('click', async () => {
  const url = buildShareUrl(els.select.value, editor.getValue());
  history.replaceState(null, '', url);
  try {
    await navigator.clipboard.writeText(url);
    toast('Lien copié dans le presse-papiers');
  } catch {
    toast('Lien placé dans la barre d’adresse');
  }
});

/* ------------------------------------------------------------------ */
/*  Lien de partage (#s=<base64url(JSON)>)                             */
/* ------------------------------------------------------------------ */

function toBase64Url(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + pad);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

function buildShareUrl(template, code) {
  const payload = toBase64Url(JSON.stringify({ t: template, c: code }));
  return `${location.origin}${location.pathname}${location.search}#s=${payload}`;
}

function readSharedState() {
  try {
    const m = /^#s=([A-Za-z0-9_-]+)$/.exec(location.hash);
    if (!m) return null;
    const data = JSON.parse(fromBase64Url(m[1]));
    if (typeof data.c !== 'string') return null;
    return { template: typeof data.t === 'string' ? data.t : DEFAULT_TEMPLATE, code: data.c };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Toast                                                              */
/* ------------------------------------------------------------------ */

let toastTimer = 0;
function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2200);
}

/* ------------------------------------------------------------------ */
/*  Séparateur redimensionnable                                        */
/* ------------------------------------------------------------------ */

// Le graphique est à gauche (60 % par défaut), l'éditeur à droite (40 %).
const DEFAULT_CHART_PCT = 60;
const MIN_PCT = 30;
const MAX_PCT = 78;

function setChartPct(pct) {
  const clamped = Math.min(MAX_PCT, Math.max(MIN_PCT, pct));
  document.documentElement.style.setProperty('--chart-w', `${clamped}%`);
  try {
    localStorage.setItem('plexis-chart-pct', String(clamped));
  } catch {
    /* stockage indisponible : sans conséquence */
  }
}

try {
  const saved = Number(localStorage.getItem('plexis-chart-pct'));
  if (saved >= MIN_PCT && saved <= MAX_PCT) {
    document.documentElement.style.setProperty('--chart-w', `${saved}%`);
  }
} catch {
  /* ignoré */
}

els.gutter.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  els.gutter.setPointerCapture(e.pointerId);
  els.gutter.classList.add('dragging');
  document.body.style.userSelect = 'none';

  const rect = els.split.getBoundingClientRect();
  const onMove = (ev) => setChartPct(((ev.clientX - rect.left) / rect.width) * 100);
  const onUp = () => {
    els.gutter.classList.remove('dragging');
    document.body.style.userSelect = '';
    els.gutter.removeEventListener('pointermove', onMove);
    els.gutter.removeEventListener('pointerup', onUp);
    els.gutter.removeEventListener('pointercancel', onUp);
  };
  els.gutter.addEventListener('pointermove', onMove);
  els.gutter.addEventListener('pointerup', onUp);
  els.gutter.addEventListener('pointercancel', onUp);
});

els.gutter.addEventListener('dblclick', () => setChartPct(DEFAULT_CHART_PCT));

els.gutter.addEventListener('keydown', (e) => {
  const current = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--chart-w')) || DEFAULT_CHART_PCT;
  if (e.key === 'ArrowLeft') setChartPct(current - 2);
  if (e.key === 'ArrowRight') setChartPct(current + 2);
});

/* ------------------------------------------------------------------ */
/*  Données synthétiques (mode ?offline, pour tests sans réseau)       */
/* ------------------------------------------------------------------ */

function syntheticBars(count, stepMs) {
  const bars = [];
  let seed = 42;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const end = Math.floor(Date.now() / stepMs) * stepMs;
  let price = 70000;
  for (let i = count - 1; i >= 0; i--) {
    const open = price;
    const drift = Math.sin(i / 60) * 25;
    const change = (rand() - 0.5) * 600 + drift;
    const close = Math.max(1000, open + change);
    const high = Math.max(open, close) + rand() * 180;
    const low = Math.min(open, close) - rand() * 180;
    bars.push({ time: end - i * stepMs, open, high, low, close, volume: 50 + rand() * 400 });
    price = close;
  }
  return bars;
}

/* ------------------------------------------------------------------ */
/*  Démarrage                                                          */
/* ------------------------------------------------------------------ */

async function boot() {
  setStatus('dim', OFFLINE ? 'Mode hors ligne (données synthétiques)…' : 'Connexion à Hyperliquid…');

  const timeout = new Promise((resolve) => setTimeout(() => resolve('timeout'), DATA_TIMEOUT_MS));
  const result = await Promise.race([workspace.chart.ready().then(() => 'ready'), timeout]);
  dataReady = result === 'ready';

  if (!dataReady) {
    setStatus(
      'err',
      'Les données Hyperliquid tardent à arriver (réseau bloqué ?). Le script sera tracé dès que les barres seront chargées.',
    );
  }

  await runScript();
}

boot();

// Exposé pour le débogage depuis la console du navigateur.
window.__studio = { workspace, editor, monaco, runScript };
