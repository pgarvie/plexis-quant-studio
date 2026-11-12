// Langage « pinescript » pour Monaco : tokenizer Monarch, configuration (indentation, commentaires)
// et thème sombre « plexis-dark ». Palette reprise du playground :
//   mots-clés / opérateurs #42bda8 · fonctions & espaces de noms #5b9cf6
//   constantes / prédéfinis #f77c80 · nombres #f57f17 · chaînes #388e3c · commentaires gris

export const PINE_LANGUAGE_ID = 'pinescript';
export const PINE_THEME_ID = 'plexis-dark';

const KEYWORDS = [
  'if', 'else', 'for', 'to', 'by', 'while', 'switch', 'in', 'var', 'varip', 'import', 'export',
  'method', 'type', 'enum', 'and', 'or', 'not', 'break', 'continue', 'return', 'as',
  // qualificateurs et types
  'int', 'float', 'bool', 'string', 'series', 'simple', 'const',
];

// Variables et constantes prédéfinies (sans espace de noms)
const CONSTANTS = [
  'true', 'false', 'na',
  'open', 'high', 'low', 'close', 'volume', 'hl2', 'hlc3', 'ohlc4', 'hlcc4',
  'time', 'time_close', 'time_tradingday', 'bar_index', 'last_bar_index', 'last_bar_time',
  'dayofmonth', 'dayofweek', 'hour', 'minute', 'month', 'second', 'year', 'weekofyear',
];

// Espaces de noms : `ns.membre`
const NAMESPACES = [
  'ta', 'strategy', 'math', 'str', 'array', 'matrix', 'map', 'request', 'color', 'input',
  'chart', 'syminfo', 'barstate', 'timeframe', 'session', 'ticker', 'log', 'runtime', 'alert',
  'plot', 'shape', 'location', 'size', 'display', 'position', 'extend', 'xloc', 'yloc',
  'format', 'currency', 'label', 'line', 'box', 'table', 'polyline', 'linefill', 'barmerge',
  'order', 'scale', 'font', 'text', 'hline', 'adjustment', 'backadjustment', 'settlement_as_close',
];

export function registerPineScript(monaco) {
  monaco.languages.register({ id: PINE_LANGUAGE_ID, aliases: ['Pine Script', 'pine'], extensions: ['.pine'] });

  monaco.languages.setLanguageConfiguration(PINE_LANGUAGE_ID, {
    comments: { lineComment: '//' },
    brackets: [['(', ')'], ['[', ']'], ['{', '}']],
    autoClosingPairs: [
      { open: '(', close: ')' },
      { open: '[', close: ']' },
      { open: '{', close: '}' },
      { open: '"', close: '"', notIn: ['string', 'comment'] },
      { open: "'", close: "'", notIn: ['string', 'comment'] },
    ],
    surroundingPairs: [
      { open: '(', close: ')' },
      { open: '[', close: ']' },
      { open: '{', close: '}' },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
    ],
    // Pine ouvre un bloc après if / else / for / while / switch et après `=>`.
    onEnterRules: [
      {
        beforeText: /^\s*(?:else\s+)?(?:if|for|while|switch)\b.*$/,
        action: { indentAction: monaco.languages.IndentAction.Indent },
      },
      {
        beforeText: /^\s*else\s*$/,
        action: { indentAction: monaco.languages.IndentAction.Indent },
      },
      {
        beforeText: /^.*=>\s*$/,
        action: { indentAction: monaco.languages.IndentAction.Indent },
      },
      {
        beforeText: /^[^/]*[:]?=\s*(?:if|for|while|switch)\b.*$/,
        action: { indentAction: monaco.languages.IndentAction.Indent },
      },
    ],
  });

  monaco.languages.setMonarchTokensProvider(PINE_LANGUAGE_ID, {
    defaultToken: 'identifier',
    keywords: KEYWORDS,
    constants: CONSTANTS,
    namespaces: NAMESPACES,

    tokenizer: {
      root: [
        // commentaires (y compris //@version=6)
        [/\/\/.*$/, 'comment'],

        // chaînes
        [/"/, { token: 'string.quote', next: '@dqstring' }],
        [/'/, { token: 'string.quote', next: '@sqstring' }],

        // couleurs hexadécimales : #RRGGBB / #RRGGBBAA
        [/#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?\b/, 'number'],

        // nombres
        [/\d+\.\d*(?:[eE][+-]?\d+)?/, 'number'],
        [/\.\d+(?:[eE][+-]?\d+)?/, 'number'],
        [/\d+(?:[eE][+-]?\d+)?/, 'number'],

        // espace de noms suivi d'un point : ta., strategy., color. …
        [
          /[a-zA-Z_]\w*(?=\s*\.)/,
          {
            cases: {
              '@namespaces': { token: 'namespace', next: '@member' },
              '@default': 'identifier',
            },
          },
        ],

        // appel de fonction : nom(
        [
          /[a-zA-Z_]\w*(?=\s*\()/,
          {
            cases: {
              '@keywords': 'keyword',
              '@default': 'function',
            },
          },
        ],

        // identifiants simples
        [
          /[a-zA-Z_]\w*/,
          {
            cases: {
              '@keywords': 'keyword',
              '@constants': 'constant',
              '@default': 'identifier',
            },
          },
        ],

        // opérateurs
        [/:=|=>|==|!=|<=|>=|\+=|-=|\*=|\/=|%=/, 'operator'],
        [/[=<>!?:+\-*/%]/, 'operator'],

        [/[()[\]{}]/, '@brackets'],
        [/[,.]/, 'delimiter'],
        [/\s+/, 'white'],
      ],

      // `ns.` puis le membre : fonction si suivi de `(`, sinon constante (color.orange, strategy.long …)
      member: [
        [/\./, 'delimiter'],
        [/[a-zA-Z_]\w*(?=\s*\()/, { token: 'function', next: '@pop' }],
        [/[a-zA-Z_]\w*(?=\s*\.)/, 'namespace'],
        [/[a-zA-Z_]\w*/, { token: 'constant', next: '@pop' }],
        [/./, { token: '@rematch', next: '@pop' }],
      ],

      dqstring: [
        [/[^\\"]+/, 'string'],
        [/\\./, 'string.escape'],
        [/"/, { token: 'string.quote', next: '@pop' }],
      ],
      sqstring: [
        [/[^\\']+/, 'string'],
        [/\\./, 'string.escape'],
        [/'/, { token: 'string.quote', next: '@pop' }],
      ],
    },
  });

  monaco.editor.defineTheme(PINE_THEME_ID, {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: '', foreground: 'd1d4dc' },
      { token: 'identifier', foreground: 'd1d4dc' },
      { token: 'delimiter', foreground: 'd1d4dc' },
      { token: 'keyword', foreground: '42bda8' },
      { token: 'operator', foreground: '42bda8' },
      { token: 'namespace', foreground: '5b9cf6' },
      { token: 'function', foreground: '5b9cf6' },
      { token: 'constant', foreground: 'f77c80' },
      { token: 'number', foreground: 'f57f17' },
      { token: 'string', foreground: '388e3c' },
      { token: 'string.quote', foreground: '388e3c' },
      { token: 'string.escape', foreground: '388e3c' },
      { token: 'comment', foreground: '808080', fontStyle: 'italic' },
    ],
    colors: {
      'editor.background': '#0a0b0d',
      'editor.foreground': '#d1d4dc',
      'editorLineNumber.foreground': '#8a8d96',
      'editorLineNumber.activeForeground': '#f0f3fa',
      'editorCursor.foreground': '#f0f3fa',
      'editor.lineHighlightBackground': '#ffffff08',
      'editor.lineHighlightBorder': '#00000000',
      'editor.selectionBackground': '#2962ff44',
      'editor.inactiveSelectionBackground': '#2962ff22',
      'editorIndentGuide.background1': '#2a2b30',
      'editorIndentGuide.activeBackground1': '#43454d',
      'editorWidget.background': '#151619',
      'editorWidget.border': '#2a2b30',
      'editorSuggestWidget.background': '#151619',
      'editorSuggestWidget.border': '#2a2b30',
      'scrollbarSlider.background': '#ffffff14',
      'scrollbarSlider.hoverBackground': '#ffffff24',
      'scrollbarSlider.activeBackground': '#ffffff30',
      'editorBracketMatch.background': '#42bda833',
      'editorBracketMatch.border': '#42bda866',
    },
  });
}
