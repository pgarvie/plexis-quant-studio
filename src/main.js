import './style.css';

import { VelaWorkspace } from '@luxalgo/vela/workspace';
import { PineWorkerEngine } from '@luxalgo/vela-pinets';

import * as monaco from 'monaco-editor/esm/vs/editor/edcore.main';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';

import { registerPineScript, PINE_LANGUAGE_ID, PINE_THEME_ID } from './pinescript-monaco.js';
import { TEMPLATES, DEFAULT_TEMPLATE } from './templates.js';
import { SOURCES, SOURCE_BY_ID, createProviders, twelveData, normalizeSymbol, splitPrefixed } from './sources.js';
import { onProviderMessage } from './providers/common.js';

/* ------------------------------------------------------------------ */
/*  Paramètres                                                         */
/* ------------------------------------------------------------------ */

const TIMEFRAME = '60'; // minutes → 1h
const DATA_TIMEOUT_MS = 20000;
const MARKET_TIMEOUT_MS = 25000;

const params = new URLSearchParams(location.search);
const OFFLINE = params.has('offline'); // ?offline : barres synthétiques, sans réseau (tests)

// Petit stockage local (préférences) : jamais bloquant s'il est indisponible.
function lsGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function lsSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignoré */
  }
}

// Source et symbole de départ : ?src=…&sym=… (tests), sinon la dernière sélection, sinon Hyperliquid BTC.
let lastSymbols = {};
try {
  lastSymbols = JSON.parse(lsGet('plexis-symbols') ?? '{}') || {};
} catch {
  lastSymbols = {};
}
let currentSource = SOURCE_BY_ID[params.get('src')] ?? SOURCE_BY_ID[lsGet('plexis-source')] ?? SOURCE_BY_ID.hyperliquid;
let currentSymbol = params.get('sym') || lastSymbols[currentSource.id] || currentSource.defaultSymbol;

twelveData.configure({ apiKey: lsGet('plexis-td-key') ?? '' });

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
  // barre de données
  source: $('source-select'),
  symbol: $('symbol-input'),
  load: $('btn-load'),
  keyField: $('key-field'),
  keyInput: $('key-input'),
  keyLink: $('key-link'),
  dataMsg: $('data-msg'),
  suggestions: $('symbol-suggestions'),
  // barre de fichiers
  open: $('btn-open'),
  save: $('btn-save'),
  saveAs: $('btn-saveas'),
  fileInput: $('file-input'),
  fileName: $('file-name'),
  fileText: $('file-name-text'),
  fileDirty: $('file-dirty'),
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
  symbol: OFFLINE ? 'BTC' : `${currentSource.prefix}:${currentSymbol}`,
  timeframe: TIMEFRAME,
  theme: 'dark',
  live: !OFFLINE,
  engines: { pine: () => new PineWorkerEngine() }, // exécution dans un Web Worker
};

if (OFFLINE) {
  workspaceOptions.data = syntheticBars(1500, 60 * 60 * 1000);
} else {
  // Hyperliquid, Binance, Coinbase (fournis par Vela) + Kraken, Yahoo Finance, Twelve Data (src/providers).
  workspaceOptions.providers = createProviders();
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
  // « line 5 », « line 5:3 », « (5:3) », « at 5:3 »
  const patterns = [
    /\bline\s+(\d+)(?:\s*[:,]\s*(?:col(?:umn)?\s*)?(\d+))?/i,
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
  const message = String(error?.message ?? error ?? 'Unknown error').trim();
  const loc = extractLocation(message);
  const where = loc ? `Line ${loc.line}${loc.column > 1 ? `, col. ${loc.column}` : ''} — ` : '';
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
  setStatus('dim', dataReady ? 'Running…' : 'Loading market data…');

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

// Raccourcis globaux (éditeur ou graphique) : ⌘/Ctrl+Entrée = Run, +S = Save, +Shift+S = Save As, +O = Open.
window.addEventListener(
  'keydown',
  (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
    const key = e.key.toLowerCase();
    let action = null;
    if (key === 'enter' && !e.shiftKey) action = runScript;
    else if (key === 's') action = e.shiftKey ? saveFileAs : saveFile;
    else if (key === 'o' && !e.shiftKey) action = openFile;
    if (!action) return;
    e.preventDefault();
    e.stopPropagation();
    action();
  },
  true,
);

let lastTemplate = els.select.value;

els.select.addEventListener('change', () => {
  const t = TEMPLATES[els.select.value];
  if (!t) return;
  if (!confirmDiscard()) {
    els.select.value = lastTemplate; // l'utilisateur garde son travail
    return;
  }
  lastTemplate = els.select.value;
  editor.setValue(t.code);
  setBaseline(editor.getValue()); // un exemple n'est lié à aucun fichier
  runScript();
});

// Reset : revient au script tel qu'il a été chargé ou enregistré la dernière fois (exemple, fichier ouvert…).
els.reset.addEventListener('click', () => {
  editor.setValue(file.baseline);
  updateFileBadge();
  runScript();
});

els.share.addEventListener('click', async () => {
  const url = buildShareUrl(els.select.value, editor.getValue());
  history.replaceState(null, '', url);
  try {
    await navigator.clipboard.writeText(url);
    toast('Link copied to clipboard');
  } catch {
    toast('Link placed in the address bar');
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
/*  Barre de données : source + symbole                                */
/* ------------------------------------------------------------------ */

let loadToken = 0;
let loadTimer = 0;
let loadError = null; // dernière erreur d'un fournisseur pendant le chargement en cours

function setDataMsg(text, kind = '') {
  els.dataMsg.textContent = text;
  els.dataMsg.title = text;
  els.dataMsg.className = `data-msg ${kind}`.trim();
}

function applySourceUi(src) {
  els.source.value = src.id;
  els.source.title = src.hint;
  els.symbol.placeholder = src.defaultSymbol;
  els.suggestions.replaceChildren(
    ...src.examples.map((ex) => {
      const o = document.createElement('option');
      o.value = ex;
      return o;
    }),
  );
  els.keyField.hidden = !src.needsKey;
  els.keyLink.hidden = !src.needsKey;
}

for (const s of SOURCES) {
  const opt = document.createElement('option');
  opt.value = s.id;
  opt.textContent = s.label;
  els.source.appendChild(opt);
}
applySourceUi(currentSource);
els.symbol.value = currentSymbol;
els.keyInput.value = lsGet('plexis-td-key') ?? '';

function rememberMarket(src, symbol) {
  currentSource = src;
  currentSymbol = symbol;
  lastSymbols[src.id] = symbol;
  lsSet('plexis-source', src.id);
  lsSet('plexis-symbols', JSON.stringify(lastSymbols));
}

function marketLoaded() {
  clearTimeout(loadTimer);
  if (!loadError) setDataMsg(`${currentSource.label} · ${currentSymbol}`, 'ok');
}

/** Charge `symbol` depuis la source `src` : le graphique bascule en place et le script est recalculé. */
async function loadMarket(src, rawSymbol) {
  let source = src;
  let text = String(rawSymbol ?? '').trim();
  const prefixed = splitPrefixed(text); // « YAHOO:AAPL » tapé à la main
  if (prefixed) {
    source = prefixed.source;
    text = prefixed.symbol;
  }
  const symbol = normalizeSymbol(source.id, text);
  if (!symbol) {
    setDataMsg('Enter a symbol first.', 'err');
    return;
  }

  rememberMarket(source, symbol);
  applySourceUi(source);
  els.symbol.value = symbol;
  loadError = null;

  if (source.needsKey && !twelveData.apiKey) {
    setDataMsg('Paste your Twelve Data API key, then press Load.', 'err');
    els.keyInput.focus();
    return;
  }

  setDataMsg(`Loading ${source.label} · ${symbol}…`);
  const token = ++loadToken;
  clearTimeout(loadTimer);
  loadTimer = setTimeout(() => {
    if (token === loadToken && !loadError) {
      setDataMsg(`No data received for ${source.label} · ${symbol}. Check the symbol or the source.`, 'err');
    }
  }, MARKET_TIMEOUT_MS);

  try {
    await workspace.chart.setMarket({ symbol: `${source.prefix}:${symbol}` });
  } catch (e) {
    loadError = e?.message ?? String(e);
    setDataMsg(loadError, 'err');
  }
}

if (OFFLINE) {
  setDataMsg('Offline mode: synthetic data', '');
  els.source.disabled = els.symbol.disabled = els.load.disabled = true;
} else {
  // Erreurs signalées par les fournisseurs maison (clé manquante, relais absent, symbole inconnu…).
  onProviderMessage(({ message, level }) => {
    if (level !== 'error') return;
    loadError = message;
    setDataMsg(message, 'err');
  });

  // Le graphique a changé de marché (aussi via le sélecteur de symbole intégré à Vela) : on synchronise la barre.
  workspace.chart.on('market:changed', (ev) => {
    const p = splitPrefixed(String(ev?.symbol ?? ''));
    if (p) {
      rememberMarket(p.source, p.symbol);
      applySourceUi(p.source);
      els.symbol.value = p.symbol;
    } else if (ev?.symbol) {
      els.symbol.value = ev.symbol;
    }
    marketLoaded();
  });
}

els.source.addEventListener('change', () => {
  const src = SOURCE_BY_ID[els.source.value];
  if (src) loadMarket(src, lastSymbols[src.id] || src.defaultSymbol);
});
els.load.addEventListener('click', () => loadMarket(currentSource, els.symbol.value));
els.symbol.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    loadMarket(currentSource, els.symbol.value);
  }
});

function commitApiKey() {
  const key = els.keyInput.value.trim();
  if (key === twelveData.apiKey) return;
  twelveData.configure({ apiKey: key });
  lsSet('plexis-td-key', key);
  if (currentSource.id === 'twelvedata' && key) loadMarket(currentSource, currentSymbol);
}
els.keyInput.addEventListener('change', commitApiKey);
els.keyInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    commitApiKey();
  }
});

/* ------------------------------------------------------------------ */
/*  Fichiers .pine : Open / Save / Save As                             */
/* ------------------------------------------------------------------ */

// File System Access API (Chrome, Edge) : ouvre et réécrit un vrai fichier. Ailleurs (Firefox, Safari) :
// sélecteur de fichier classique pour ouvrir, téléchargement pour enregistrer.
const PINE_TYPES = [{ description: 'Pine Script', accept: { 'text/plain': ['.pine', '.txt'] } }];

// `baseline` = dernier texte chargé ou enregistré : sert au point « modifié » et au bouton Reset.
const file = { handle: null, name: null, baseline: initial.code };

function isDirty() {
  return editor.getValue() !== file.baseline;
}

function updateFileBadge() {
  const name = file.name ?? 'Untitled.pine';
  els.fileText.textContent = name;
  els.fileName.title = name;
  els.fileName.classList.toggle('named', Boolean(file.name));
  els.fileDirty.hidden = !isDirty();
}

function setBaseline(text, name = null, handle = null) {
  file.baseline = text;
  file.name = name;
  file.handle = handle;
  updateFileBadge();
}

function confirmDiscard() {
  return !isDirty() || window.confirm('You have unsaved changes. Discard them?');
}

editor.onDidChangeModelContent(updateFileBadge);
updateFileBadge();

window.addEventListener('beforeunload', (e) => {
  if (isDirty()) {
    e.preventDefault();
    e.returnValue = '';
  }
});

function pickWithInput() {
  return new Promise((resolve) => {
    const input = els.fileInput;
    input.value = '';
    input.onchange = async () => {
      const f = input.files?.[0];
      resolve(f ? { text: await f.text(), name: f.name, handle: null } : null);
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

async function openFile() {
  if (!confirmDiscard()) return;
  let picked;
  try {
    if (window.showOpenFilePicker) {
      const [h] = await window.showOpenFilePicker({ types: PINE_TYPES, multiple: false });
      const f = await h.getFile();
      picked = { text: await f.text(), name: f.name, handle: h };
    } else {
      picked = await pickWithInput();
    }
  } catch (e) {
    if (e?.name === 'AbortError') return; // fenêtre fermée sans choix
    toast(`Could not open the file: ${e?.message ?? e}`);
    return;
  }
  if (!picked) return;

  editor.setValue(picked.text.replace(/^﻿/, ''));
  editor.setScrollTop(0);
  editor.setPosition({ lineNumber: 1, column: 1 });
  setBaseline(editor.getValue(), picked.name, picked.handle);
  toast(`Opened ${picked.name}`);
  runScript();
}

function suggestFileName() {
  const declared = scriptNameFromSource(editor.getValue());
  const base = (file.name ?? (declared !== 'Script' ? declared : 'script'))
    .replace(/\.(pine|txt)$/i, '')
    .replace(/[\\/:*?"<>|]+/g, '_')
    .trim();
  return `${base || 'script'}.pine`;
}

async function writeToHandle(handle, text) {
  const w = await handle.createWritable();
  await w.write(text);
  await w.close();
}

function downloadText(text, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function saveFileAs() {
  const text = editor.getValue();
  const suggested = suggestFileName();
  try {
    if (window.showSaveFilePicker) {
      const h = await window.showSaveFilePicker({ suggestedName: suggested, types: PINE_TYPES });
      await writeToHandle(h, text);
      setBaseline(text, h.name, h);
      toast(`Saved ${h.name}`);
    } else {
      downloadText(text, suggested);
      setBaseline(text, suggested, null);
      toast(`Downloaded ${suggested}`);
    }
  } catch (e) {
    if (e?.name === 'AbortError') return;
    toast(`Could not save: ${e?.message ?? e}`);
  }
}

async function saveFile() {
  if (!file.handle) return saveFileAs();
  const text = editor.getValue();
  try {
    await writeToHandle(file.handle, text);
    setBaseline(text, file.name, file.handle);
    toast(`Saved ${file.name}`);
  } catch (e) {
    if (e?.name === 'NotAllowedError') return saveFileAs(); // permission retirée : on redemande l'emplacement
    toast(`Could not save: ${e?.message ?? e}`);
  }
}

els.open.addEventListener('click', openFile);
els.save.addEventListener('click', saveFile);
els.saveAs.addEventListener('click', saveFileAs);

/* ------------------------------------------------------------------ */
/*  Démarrage                                                          */
/* ------------------------------------------------------------------ */

async function boot() {
  setStatus('dim', OFFLINE ? 'Offline mode (synthetic data)…' : `Connecting to ${currentSource.label}…`);
  if (!OFFLINE) setDataMsg(`Loading ${currentSource.label} · ${currentSymbol}…`);

  const timeout = new Promise((resolve) => setTimeout(() => resolve('timeout'), DATA_TIMEOUT_MS));
  const result = await Promise.race([workspace.chart.ready().then(() => 'ready'), timeout]);
  dataReady = result === 'ready';

  if (dataReady) {
    if (!OFFLINE) marketLoaded();
  } else {
    setStatus('dim', 'Waiting for market data… (see the message above the chart)');
    if (!OFFLINE && !loadError) {
      setDataMsg(`Market data from ${currentSource.label} is slow to arrive (network blocked?).`, 'err');
    }
  }

  await runScript();
}

boot();

// Exposé pour le débogage depuis la console du navigateur.
window.__studio = { workspace, editor, monaco, runScript, loadMarket };
