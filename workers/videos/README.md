# olycity-videos

Hébergement des vidéos de **The Imitation Game** sur Cloudflare R2 (10 Go
gratuits, bande passante sortante gratuite). Les extraits YouTube n'en ont pas
besoin : ce Worker ne sert qu'aux vidéos hébergées.

Il réutilise le bucket `la-regie-videos` de la première version du jeu
(Doublage Party) : ses vidéos restent disponibles et s'importent depuis le jeu
(bouton « Importer les vidéos hébergées », réservé à Nico et Liam).

## Mise en place (une fois)

Depuis ce dossier, connecté au compte Cloudflare qui possède le bucket :

```bash
npx wrangler login
npx wrangler deploy
npx wrangler secret put UPLOAD_TOKEN
```

- `UPLOAD_TOKEN` : un code d'envoi long et aléatoire, à donner seulement aux
  personnes qui ajoutent des vidéos. Le jeu le demande une fois et le retient
  dans le navigateur. Sans lui, tout envoi est refusé.
- Reporter l'adresse affichée par `wrangler deploy` dans `VIDEO_ENDPOINT` de
  `config.js` à la racine du site.

## Fonctionnement

| Requête | Rôle |
|---|---|
| `GET /list` | liste publique des vidéos du bucket (miniatures et autres fichiers ignorés) |
| `GET /v/<clé>` | lecture publique, avec plages (`Range`) pour pouvoir sauter dans la vidéo |
| `POST /upload` | corps = le fichier, `Authorization: Bearer <UPLOAD_TOKEN>`, `Content-Type: video/…`. Renvoie `{ key, url }`. |
| `DELETE /v/<clé>` | suppression, même jeton |

Formats acceptés à l'envoi : MP4, WebM, MOV, OGV ; 100 Mo maximum par fichier
(limite d'une requête sur le plan gratuit des Workers).
