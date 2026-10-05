// Configuration publique du site (aucun secret : tout ce qui est ici est lisible
// par n'importe quel visiteur). Même Worker de recherche IGDB + Steam que le
// tracker ; son SITE_ORIGIN doit inclure https://games.olycity.fr.
export const CONFIG = {
  GAME_CATALOG_ENDPOINT: 'https://olycity-game-catalog.skybreaker04400.workers.dev',
  // Worker workers/videos (hébergement R2 des vidéos de The Imitation Game).
  // Vide = pas d'hébergement : seuls les extraits YouTube sont alors proposés.
  VIDEO_ENDPOINT: 'https://olycity-videos.olycity.workers.dev',
};
