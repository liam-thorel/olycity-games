# games.olycity.fr

Le coin jeux du Discord OLYCITY, troisième service de l'écosystème après le
[tracker](https://tracker.olycity.fr) et la [musique](https://musique.olycity.fr).

Deux parties :

| Partie | Contenu | Données |
|---|---|---|
| **Jeux existants** | catalogue coop (propositions IGDB/Steam, votes, statuts) et planification des soirées, repris du tracker | Firebase `coopGames`, `groupNight/current` (les mêmes que le tracker) |
| **Jeux OLYCITY** | jeux maison jouables dans le navigateur, avec lobbies à code | Firebase `olygames/lobbies/<CODE>` |

## Architecture

```text
olycity-games/
├── index.html            Portail : soirée, jeux maison, catalogue coop
├── css/                  Styles du portail (coop.css vient du tracker)
├── js/
│   ├── main.mjs          Démarrage du portail
│   ├── registry.mjs      Cartes des jeux maison
│   ├── coop/             Catalogue coop (repris d'OLYVALO)
│   └── night/            Planification des soirées (repris d'OLYVALO)
├── sdk/                  SDK partagé par le portail et tous les jeux
│   ├── olycity.mjs       Membres, profil, Firebase, temps réel, lobbies
│   └── olycity.css       Jetons et composants de base
├── games/
│   ├── registry.json     Liste des jeux affichés sur le portail
│   └── <slug>/           Un dossier par jeu, n'importe quel stack
├── scripts/build.mjs     Assemble _site/ et compile les jeux avec package.json
└── tests/                node --test, sans dépendance
```

Le portail et les jeux en HTML natif n'ont **pas de build**. Un jeu qui a un
`package.json` (Vite, Angular, React…) est compilé par `scripts/build.mjs`
pendant le déploiement. Voir [games/README.md](games/README.md) pour ajouter ou
migrer un jeu.

Les membres et leurs avatars sont lus depuis le tracker
(`tracker.olycity.fr/data/*.json` + `rosterOverlay` dans Firebase) : il n'y a
qu'une liste à tenir à jour. Le profil choisi est partagé par le portail et
tous les jeux (même origine, mêmes clés `localStorage` que le tracker).

## Modpack OLYCITY V1

La section `#modpacks` propose le pack Minecraft et un guide d’import CurseForge et serveur Crafty. Elle est statique et reste accessible même si Firebase ne répond pas. Les ZIP joueur et serveur est une pièce jointe de la release GitHub `olycity-v1-20261008`, jamais un fichier Git ou Pages. Les métadonnées et l’empreinte sont dans `assets/modpacks/olycity-v1.json` ; voir `docs/olycity-v1-release.md` pour la publication.

## Développement local

```bash
npx serve -l 4174 .
```

Puis ouvrir `http://localhost:4174/`. En local, les jeux au statut `dev` sont
visibles et Réflexe peut se lancer seul (en ligne, il faut 2 joueurs).

```bash
node --test
node scripts/build.mjs
```

## Mise en ligne

1. Créer le dépôt GitHub `olycity-games` et pousser `main`.
2. **Settings → Pages → Source : GitHub Actions.** Le workflow
   `.github/workflows/pages.yml` teste, assemble et publie.
3. Zone DNS OVH : `games` en `CNAME` vers `liam-thorel.github.io.`, puis
   renseigner `games.olycity.fr` comme domaine personnalisé dans Pages
   (le fichier `CNAME` est déjà là) et cocher *Enforce HTTPS*.
4. Worker `olycity-game-catalog` : ajouter `https://games.olycity.fr` à
   `SITE_ORIGIN` (`OLYVALO/workers/game-catalog/wrangler.toml`) puis
   `npx wrangler deploy`. Sans ça, la recherche IGDB/Steam et les avis Steam
   ne marchent qu'en local ; la saisie manuelle reste disponible.
5. Hub `olycity.fr` : activer la carte Games.
6. Tracker : l'onglet Jeux redirige vers games.olycity.fr.

## Données Firebase

| Chemin | Usage |
|---|---|
| `coopGames/<id>` | jeux proposés, votes (`interests`), statut |
| `groupNight/current` | soirée planifiée, créneaux, votes, choix final |
| `olygames/lobbies/<CODE>` | `game`, `hostId`, `status` (`waiting`/`playing`/`ended`), `players`, `settings`, `state` (propre au jeu) |
| `olygames/imitation/library/<id>` | extraits de The Imitation Game (YouTube ou vidéo hébergée), partagés entre les parties |
| `olygames/imitation/audio/<CODE>/<manche>/<joueur>` | prises audio (Opus en base64), supprimées à la manche suivante et en fin de partie |

## Hébergement des vidéos

Les vidéos envoyées depuis The Imitation Game sont stockées sur Cloudflare R2
par le Worker [`workers/videos`](workers/videos/README.md) (10 Go et bande
passante gratuits). Tant qu'il n'est pas déployé et renseigné dans
`VIDEO_ENDPOINT` (`config.js`), seuls les extraits YouTube sont proposés.

Le micro n'est autorisé par les navigateurs que sur une page **https** (ou en
local) : The Imitation Game a besoin du certificat de games.olycity.fr.
