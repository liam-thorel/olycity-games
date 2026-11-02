import { extractSteamAppId } from './coop-games-utils.mjs';

let endpointPromise = null;

export async function gameCatalogEndpoint() {
  if (window.OLYCITY_GAME_CATALOG_ENDPOINT) return String(window.OLYCITY_GAME_CATALOG_ENDPOINT).replace(/\/$/, '');
  if (!endpointPromise) {
    endpointPromise = import('../../config.js')
      .then(module => String(module.CONFIG?.GAME_CATALOG_ENDPOINT || '').replace(/\/$/, ''))
      .catch(() => '');
  }
  return endpointPromise;
}

export async function searchGameCatalog(value, { endpoint, fetchImpl = fetch, signal } = {}) {
  const query = String(value || '').trim();
  if (query.length < 2) return [];
  const base = String(endpoint ?? await gameCatalogEndpoint()).replace(/\/$/, '');
  if (!base) {
    const error = new Error('Le catalogue automatique n’est pas encore connecté.');
    error.code = 'CATALOG_NOT_CONFIGURED';
    throw error;
  }
  const steamAppId = extractSteamAppId(query);
  const url = new URL(`${base}/search`);
  if (steamAppId) url.searchParams.set('steamAppId', steamAppId);
  else url.searchParams.set('q', query);
  const response = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Catalogue HTTP ${response.status}`);
  return Array.isArray(payload.results) ? payload.results : [];
}

/**
 * Avis, résumé du store, sortie et démo de chaque jeu Steam (route /details du
 * Worker). Par paquets de 100 : la liste du groupe dépasse vite 20 jeux, et
 * l'ancienne limite laissait les suivants bloqués sur « Avis en cours… ».
 */
export async function fetchSteamDetails(appIds = [], { endpoint, fetchImpl = fetch, signal } = {}) {
  const ids = [...new Set(appIds.map(String).filter(id => /^\d{2,10}$/.test(id)))];
  if (!ids.length) return [];
  const base = String(endpoint ?? await gameCatalogEndpoint()).replace(/\/$/, '');
  if (!base) return [];
  const items = [];
  for (let start = 0; start < ids.length; start += 100) {
    const url = new URL(`${base}/details`);
    url.searchParams.set('ids', ids.slice(start, start + 100).join(','));
    const response = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Détails Steam HTTP ${response.status}`);
    if (Array.isArray(payload.items)) items.push(...payload.items);
  }
  return items;
}

export async function fetchSteamReviewSummaries(appIds = [], { endpoint, fetchImpl = fetch, signal } = {}) {
  const ids = [...new Set(appIds.map(String).filter(id => /^\d{2,10}$/.test(id)))].slice(0, 20);
  if (!ids.length) return [];
  const base = String(endpoint ?? await gameCatalogEndpoint()).replace(/\/$/, '');
  if (!base) return [];
  const url = new URL(`${base}/reviews`);
  url.searchParams.set('ids', ids.join(','));
  const response = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Avis Steam HTTP ${response.status}`);
  return Array.isArray(payload.reviews) ? payload.reviews : [];
}
