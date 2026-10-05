# olycity-videos

Hébergement des vidéos de **The Imitation Game** sur Cloudflare R2 (10 Go
gratuits, bande passante sortante gratuite). Les extraits YouTube n'en ont pas
besoin : ce Worker ne sert qu'aux vidéos envoyées depuis le jeu.

## Mise en place (une fois)

Depuis ce dossier, avec le compte Cloudflare des autres Workers OLYCITY :

```bash
npx wrangler r2 bucket create olycity-videos
npx wrangler secret put UPLOAD_TOKEN
npx wrangler deploy
```

- `UPLOAD_TOKEN` : un code d'envoi long et aléatoire, à donner seulement aux
  personnes qui ajoutent des vidéos. Le jeu le demande une fois et le retient
  dans le navigateur.
- Reporter l'adresse affichée par `wrangler deploy` (ex.
  `https://olycity-videos.<compte>.workers.dev`) dans `VIDEO_ENDPOINT` de
  `config.js` à la racine du site.

## Fonctionnement

| Requête | Rôle |
|---|---|
| `POST /upload` | corps = le fichier, `Authorization: Bearer <UPLOAD_TOKEN>`, `Content-Type: video/…`. Renvoie `{ key, url }`. |
| `GET /v/<clé>` | lecture publique, avec plages (`Range`) pour pouvoir sauter dans la vidéo |
| `DELETE /v/<clé>` | suppression, même jeton |

Formats acceptés : MP4, WebM, MOV, OGV ; 100 Mo maximum par fichier (limite
d'une requête sur le plan gratuit des Workers).
