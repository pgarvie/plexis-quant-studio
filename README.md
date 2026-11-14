# PLEXIS Quant Studio

Pine Script v5/v6 dans le navigateur : graphique **Vela** (gauche, 60 %) + éditeur **Monaco** (droite, 40 %),
moteur **PineTS** dans un Web Worker. 100 % côté client.

- Exécuter : bouton **Run** ou **⌘/Ctrl + Entrée**
- Exemples : menu déroulant · **Reset** · **Share** (lien contenant le script)
- Séparateur redimensionnable (double-clic : retour à 60/40)
- `?offline` dans l'URL : barres synthétiques, sans réseau (utile pour tester)
- `?src=kraken&sym=ETHUSD` : démarre sur une source/un symbole donnés

## Sources de données

Barre au-dessus du graphique : choisir la **source**, taper le **symbole**, **Load** (ou Entrée).
On peut aussi taper un préfixe : `yahoo:ES=F`, `kraken:ETHUSD`. La dernière source et le dernier symbole de chaque source sont mémorisés.

| Source | Couvre | Notes |
| --- | --- | --- |
| Hyperliquid | Perpétuels crypto | Par défaut (BTC) |
| Binance | Crypto spot | |
| Coinbase | Crypto spot | |
| Kraken | Crypto spot | 720 dernières bougies seulement (limite de l'API) ; `BTCUSD`, `XBTUSD`, `ETHUSD`… |
| Yahoo Finance | Actions, ETF, **futures** (`ES=F`, `NQ=F`, `GC=F`, `CL=F`), indices (`^GSPC`), devises (`EURUSD=X`) | Nécessite le relais ci-dessous. Historique intraday limité : 1 m = 30 j, 5–30 m = 60 j, 60 m = 730 j |
| Twelve Data | Actions, ETF, forex, crypto… | Clé API gratuite sur twelvedata.com, à coller dans le champ qui apparaît (stockée uniquement dans votre navigateur) |

Les unités de temps non fournies nativement par une source sont reconstruites à partir d'une unité plus fine.
Les mises à jour en direct se font par sondage (Kraken 10 s, Yahoo 15 s, Twelve Data 60 s) pour préserver les quotas.
Après avoir corrigé une clé Twelve Data, rechargez un autre symbole (le graphique ne recharge pas un marché identique).

## Fichiers .pine

Boutons **Open**, **Save**, **Save As…** au-dessus de l'éditeur (raccourcis ⌘/Ctrl+O, +S, +Shift+S).
Chrome/Edge : lecture/écriture directe du fichier choisi. Firefox/Safari : ouverture par sélecteur, enregistrement par téléchargement.
Un point indique les modifications non enregistrées ; une confirmation évite de les perdre. **Reset** revient à la dernière version ouverte/enregistrée.
(Section GitHub pull/push : prévue plus tard.)

## Développement

```bash
npm install
npm run dev        # http://localhost:5173 (relais Yahoo/Kraken inclus)
npm run build      # → dist/
npm run preview    # relais inclus aussi
```

## Déploiement sur Render (Static Site, gratuit)

| Champ | Valeur |
| --- | --- |
| Build Command | `npm install && npm run build` |
| Publish Directory | `dist` |

Node ≥ 20.19 requis (Vite 8). Sur Render, ajouter au besoin `NODE_VERSION=22`.

### Règles de réécriture (Dashboard → Redirects/Rewrites)

Yahoo Finance n'autorise pas les appels directs depuis un navigateur : ajouter une règle **Rewrite** (pas Redirect) :

| Source | Destination | Action |
| --- | --- | --- |
| `/proxy/yahoo/*` | `https://query1.finance.yahoo.com/*` | Rewrite |
| `/proxy/kraken/*` | `https://api.kraken.com/0/public/*` | Rewrite (facultatif, repli si Kraken refuse le CORS) |

Sans la première règle, Yahoo affiche un message explicite ; les autres sources fonctionnent normalement.
Yahoo peut limiter le débit des relais partagés : en cas d'erreurs répétées, patienter ou utiliser Twelve Data.

## Licence

`pinets`, `@luxalgo/vela` et `@luxalgo/vela-pinets` sont sous **AGPL-3.0** ; les distribuer dans un site public en entraîne les obligations
(code source disponible). Pine Script® est une marque de TradingView, Inc.
