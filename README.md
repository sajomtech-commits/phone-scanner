# 📱 Phone Scanner

Scanner d'annonces iPhone en temps réel sur **Vinted** et **Leboncoin**, avec dashboard web :
flux en direct, listes personnalisées (modèles + plafond de prix par modèle + états), filtres,
statistiques et notification sonore sur les nouvelles annonces.

![stack](https://img.shields.io/badge/node-%3E%3D22.5-green) ![deps](https://img.shields.io/badge/d%C3%A9pendances%20npm-0-blue)

## Fonctionnalités

- **Scan continu** des deux plateformes (intervalle configurable, 120 s par défaut)
- **Listes personnalisées** : choisis les modèles (iPhone 11 → 17), un prix max par modèle,
  les états acceptés et les plateformes — le moteur scanne exactement ça
- **Dashboard temps réel** : compteurs (total, nouvelles, prix moyen), badge « En direct »,
  rafraîchissement auto toutes les 15 s, bip sonore sur nouvelle annonce
- **Filtres** : recherche texte, plateforme, état, fourchette de prix, tri (récent / prix)
- **Dédoublonnage** : une annonce revue plusieurs fois n'est comptée qu'une (compteur `times_seen`)
- **Zéro dépendance npm** : `node:http` + `node:sqlite` (Node ≥ 22.5)

## Comment ça marche

| Plateforme | Méthode |
|---|---|
| **Vinted** | API catalogue du front web (`api.vinted.fr/svc-catalogue/items`) avec session anonyme (cookies obtenus sur la homepage). Tri `newest_first`, filtre `price_to` natif. |
| **Leboncoin** | Page de recherche SSR (`/recherche?...`) et parsing du JSON `__NEXT_DATA__`. L'API directe est derrière DataDome : on passe l'empreinte TLS Chrome avec [curl-impersonate](https://github.com/lexiforest/curl-impersonate). |

Aucun compte, aucun cookie d'authentification, aucun mot de passe : seul l'accès public
est utilisé. Les requêtes sont espacées et jitterées pour rester raisonnables.

## Lancer

### Local

```bash
# prérequis : Node ≥ 22.5 et curl-impersonate (binaire curl_chrome131 accessible dans le PATH)
node server.js
# → http://localhost:3210
```

Variables d'environnement :

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT` | `3210` | port du dashboard |
| `DATA_DIR` | `./data` | emplacement de la base SQLite |
| `LBC_CURL` | `curl_chrome131` | chemin du binaire curl-impersonate |
| `SCAN_INTERVAL_SECONDS` | `120` | intervalle entre deux cycles de scan |

### Docker

```bash
docker compose up -d --build
# → http://localhost:3210
```

### Coolify

Déployer le repo tel quel (build pack Dockerfile). Monte un volume sur `/data` pour
persister la base SQLite.

## API

| Route | Description |
|---|---|
| `GET /api/stats` | total, nouvelles, prix moyen, dernier scan |
| `GET /api/listings?list_id=&model=&platform=&condition=&min=&max=&q=&sort=&new_only=` | flux depuis la base |
| `GET /api/search?q=&platform=&min=&max=&conditions=` | recherche live sur les plateformes |
| `POST /api/scan` `{list_id?}` | déclenche un scan immédiat |
| `GET/POST/PUT/DELETE /api/lists` | gestion des listes personnalisées |
| `POST /api/listings/mark-seen` | marque tout comme vu |

## Avertissement

Projet à usage personnel. Respecte les conditions d'utilisation des plateformes :
pas de revente de données, cadence de scan raisonnable, pas d'usage massif.
Les interfaces utilisées peuvent évoluer sans préavis (le scraper Leboncoin dépend
de la structure `__NEXT_DATA__`, celui de Vinted de l'API interne du front).
