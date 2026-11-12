// Scripts d'exemple (Pine Script v6). Clé = identifiant interne, `label` = texte du menu déroulant.

export const TEMPLATES = {
  'sma-cross': {
    label: 'SMA cross strategy',
    code: `//@version=6
strategy("SMA Cross Strategy", overlay=true, initial_capital=10000)

fast = ta.sma(close, 10)
slow = ta.sma(close, 30)

plot(fast, "Fast SMA", color=color.orange)
plot(slow, "Slow SMA", color=color.aqua)

if ta.crossover(fast, slow)
    strategy.entry("Long", strategy.long)
if ta.crossunder(fast, slow)
    strategy.close("Long")
`,
  },

  'mdi-base': {
    label: 'MDI base (McGinley Dynamic)',
    code: `//@version=6
indicator("McGinley Dynamic (MDI)", overlay=true)

length = input.int(14, "Length", minval=1)
k      = input.float(0.6, "Constante k", minval=0.1, step=0.05)

// McGinley Dynamic : une moyenne qui s'ajuste à la vitesse du marché
var float md = na
md := na(md) ? close : md + (close - md) / (k * length * math.pow(close / md, 4))

plot(md, "McGinley", color=color.orange, linewidth=2)
plot(ta.sma(close, length), "SMA", color=color.aqua)
`,
  },

  'rsi-bands': {
    label: 'RSI avec zones',
    code: `//@version=6
indicator("RSI", overlay=false)

len = input.int(14, "Length", minval=1)
r   = ta.rsi(close, len)

plot(r, "RSI", color=color.purple, linewidth=2)
plot(70, "Surachat", color=color.red)
plot(30, "Survente", color=color.green)
plot(50, "Neutre", color=color.gray)
`,
  },

  'ema-ribbon': {
    label: 'Ruban d’EMA',
    code: `//@version=6
indicator("EMA Ribbon", overlay=true)

e1 = ta.ema(close, 8)
e2 = ta.ema(close, 13)
e3 = ta.ema(close, 21)
e4 = ta.ema(close, 34)
e5 = ta.ema(close, 55)

bull = e1 > e5

plot(e1, "EMA 8",  color=bull ? color.new(color.teal, 0)  : color.new(color.red, 0))
plot(e2, "EMA 13", color=bull ? color.new(color.teal, 20) : color.new(color.red, 20))
plot(e3, "EMA 21", color=bull ? color.new(color.teal, 40) : color.new(color.red, 40))
plot(e4, "EMA 34", color=bull ? color.new(color.teal, 60) : color.new(color.red, 60))
plot(e5, "EMA 55", color=bull ? color.new(color.teal, 80) : color.new(color.red, 80))
`,
  },

  'blank-v6': {
    label: 'Blank v6',
    code: `//@version=6
indicator("My Script", overlay=true)

plot(close, "Close", color=color.white)
`,
  },
};

export const DEFAULT_TEMPLATE = 'sma-cross';
