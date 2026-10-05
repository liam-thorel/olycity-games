# Ajouter un jeu

Chaque jeu vit dans `games/<slug>/` et est servi à `games.olycity.fr/games/<slug>/`.
Le stack est libre : HTML natif, Vite, Angular, React… Le portail ne connaît
que le registre.

## 1. L'inscrire dans `registry.json`

```json
{
  "slug": "mon-jeu",
  "name": "Mon jeu",
  "tagline": "Une phrase qui donne envie.",
  "players": [2, 8],
  "status": "dev",
  "accent": "#f5c842",
  "tags": ["Lobby", "Dessin"]
}
```

| Statut | Sur le portail |
|---|---|
| `dev` | caché, sauf en local ou avec `?dev` dans l'URL |
| `soon` | carte « Bientôt », non cliquable (le dossier peut ne pas exister) |
| `beta` | jouable, badge Bêta |
| `live` | jouable |

`node --test` vérifie que chaque jeu jouable a bien son dossier.

## 2a. Jeu en HTML natif (le plus simple)

Copier `games/reflexe/` (le plus court) ou `games/telepathe/` (phases, rôles
tournants, cadran interactif) comme point de départ. Aucun build : le dossier
est publié tel quel.

```html
<link rel="stylesheet" href="/sdk/olycity.css">
<script type="module" src="./game.mjs"></script>
```

L'accueil (créer / rejoindre par code), la salle d'attente, le lien à partager
et la fermeture du lobby sont fournis par `/sdk/lobby-ui.mjs` : le jeu ne
décrit que la partie.

```js
import { mountLobbyGame, playersMarkup } from '/sdk/lobby-ui.mjs';

mountLobbyGame({
  slug:'mon-jeu', title:'Mon jeu', intro:'Le principe en une phrase.', minPlayers:2,
  initialState:players => ({ manche:1 }),   // au lancement et à « Rejouer »
  render(data, lobby, ui) {                 // status 'playing' ou 'ended'
    // ui.restart() relance une partie, ui.leave() quitte le lobby
  },
});
```

Les règles pures (points, tirages, rotation des rôles) vont dans un
`rules.mjs` séparé, testé dans `tests/games.test.mjs`.

## 2b. Jeu compilé (Vite, Angular, React…)

Un `package.json` dans le dossier suffit : le déploiement lance `npm ci` puis
`npm run build`, avec `OLYCITY_BASE=/games/<slug>/` dans l'environnement, et
publie le dossier de sortie.

- **Vite** : `base: process.env.OLYCITY_BASE || '/'` dans `vite.config.ts`.
  Sortie `dist`, rien d'autre à faire.
- **Angular** : `"build": "ng build --base-href ${OLYCITY_BASE:-/}"` et
  `"olycity": { "output": "dist/<projet>/browser" }` dans le `package.json`.
- **Routage** : GitHub Pages ne sait pas renvoyer `index.html` pour une URL
  profonde. Utiliser un routage par hash (`withHashLocation()` en Angular,
  `createHashRouter` en React Router).

Pour profiter du SDK depuis un jeu compilé, le charger à l'exécution :

```ts
const olycity = await import(/* @vite-ignore */ '/sdk/olycity.mjs');
```

En développement avec le serveur du framework, `/sdk/olycity.mjs` n'existe
pas : faire tourner `npx serve -l 4174 .` à la racine et proxifier `/sdk` et
`/assets` vers `http://localhost:4174` (option `server.proxy` de Vite,
`proxy.conf.json` d'Angular).

## Le SDK (`/sdk/olycity.mjs`)

```js
import {
  requireProfile, pickProfile, currentProfile, onProfileChange, loadMembers,
  db, createLobby, joinLobby, activePlayers, escapeHTML,
} from '/sdk/olycity.mjs';

const me = await requireProfile();          // { id, name, avatar } ou null (invité)

// Firebase Realtime Database
await db.get('chemin');
await db.set('chemin', valeur);
await db.update('chemin', { champ:1, 'sous/chemin':2 });
const key = await db.push('liste', valeur);
await db.remove('chemin');
const stop = db.subscribe('chemin', valeur => { … });

// Lobbies
const lobby = await createLobby('mon-jeu', { settings:{ manches:5 } });
// ou : await joinLobby('ABCD', { gameSlug:'mon-jeu' });
lobby.code;                                   // 'ABCD', à partager
lobby.subscribe((data, lobby) => {            // à chaque changement
  lobby.isHost; lobby.players;                // joueurs présents, du plus ancien au plus récent
  data.status; data.state;                    // 'waiting' | 'playing' | 'ended', état du jeu
});
await lobby.start({ manche:1 });              // hôte : status 'playing' + state initial
await lobby.setState({ phase:'vote' });       // modifie state/
await lobby.update({ status:'ended' });
await lobby.leave();                          // supprime le lobby s'il est vide
```

La présence est entretenue toute seule (`lastSeen` toutes les 20 s). Si l'hôte
disparaît, le joueur présent depuis le plus longtemps reprend la main.

Bon modèle pour un jeu à plusieurs : **l'hôte fait avancer la partie**
(minuteurs, changement de phase, calcul des scores), les autres écrivent
seulement leurs propres actions. Voir `reflexe/game.mjs`.

Firebase supprime les champs `null` et les objets vides : relire un champ absent
comme `undefined` (par exemple `scores` tant que personne n'a marqué).

Tout l'état du lobby est lisible par les joueurs (il n'y a pas de serveur) :
une information secrète, comme la cible de Télépathe, n'est cachée que par
l'interface. Ça suffit entre amis ; pas pour un jeu avec enjeu.

Les lobbies sont supprimés quand le dernier joueur part (y compris en fermant
l'onglet), et ceux où personne n'a été vu depuis une heure sont nettoyés à la
création d'un nouveau lobby.

## Migrer une ébauche existante

Exemple déjà fait : **The Imitation Game** (`games/imitation/`) reprend
Doublage Party (dépôt `la-regie`, Angular + Supabase). Son projet Supabase
n'existant plus, le jeu a été réécrit sur le SDK : profils OLYCITY au lieu des
comptes, lobbies Firebase, prises audio dans Firebase, vidéos sur YouTube ou
sur R2 via `workers/videos`. Les règles (super like unique, votes publics,
trophées) sont dans `games/imitation/rules.mjs`.

Pour une ébauche compilée (React, Vite…), la section 2b suffit : base via
`OLYCITY_BASE`, routage par hash, SDK chargé à l'exécution.
