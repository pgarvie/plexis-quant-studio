# PLEXIS Quant Studio

Pine Script v5/v6 dans le navigateur : graphique **Vela** (gauche, 60 %) + éditeur **Monaco** (droite, 40 %),
moteur **PineTS** dans un Web Worker, données **Hyperliquid** (BTC, 1h). 100 % côté client.

- Exécuter : bouton **Run** ou **⌘/Ctrl + Entrée**
- Exemples : menu déroulant · **Reset** · **Share** (lien contenant le script)
- Séparateur redimensionnable (double-clic : retour à 60/40)
- `?offline` dans l'URL : barres synthétiques, sans réseau (utile pour tester)

## Développement

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # → dist/
npm run preview
```

## Déploiement sur Render (Static Site, gratuit)

| Champ | Valeur |
| --- | --- |
| Build Command | `npm install && npm run build` |
| Publish Directory | `dist` |

Node ≥ 20.19 requis (Vite 8). Sur Render, ajouter au besoin la variable d'environnement `NODE_VERSION=22`.

## Licence

`pinets` et `@luxalgo/vela-pinets` sont sous **AGPL-3.0** ; les distribuer dans un site public en entraîne les obligations
(code source disponible). Pine Script® est une marque de TradingView, Inc.
