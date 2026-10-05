import { db } from '/sdk/olycity.mjs';

/** Bibliothèque d'extraits partagée entre les parties. */
export const LIBRARY_PATH = 'olygames/imitation/library';
/** Prises audio, à part du lobby pour ne pas les renvoyer à chaque changement d'état. */
export const AUDIO_PATH = 'olygames/imitation/audio';
const TOKEN_KEY = 'olycity-imitation-upload-token';

let endpointPromise = null;

/** Adresse du Worker vidéo (config.js), vide tant qu'il n'est pas déployé. */
export function videoEndpoint() {
  if (!endpointPromise) {
    endpointPromise = import('/config.js')
      .then(module => String(module.CONFIG?.VIDEO_ENDPOINT || '').replace(/\/$/, ''))
      .catch(() => '');
  }
  return endpointPromise;
}

export async function listLibrary() {
  const raw = await db.get(LIBRARY_PATH).catch(() => null);
  return Object.entries(raw || {}).map(([id, clip]) => ({ id, ...clip }))
    .sort((left, right) => Number(right.addedAt || 0) - Number(left.addedAt || 0));
}

export async function addToLibrary(clip, profile) {
  const entry = { ...clip, addedBy:profile?.name || '', addedAt:Date.now() };
  const id = await db.push(LIBRARY_PATH, entry);
  return { id, ...entry };
}

export function removeFromLibrary(id) {
  return db.remove(`${LIBRARY_PATH}/${id}`);
}

export function renameInLibrary(id, title) {
  return db.update(`${LIBRARY_PATH}/${id}`, { title });
}

/** Vidéos présentes sur l'hébergement R2 (dont celles de l'ancienne version du jeu). */
export async function listHostedVideos() {
  const endpoint = await videoEndpoint();
  if (!endpoint) return [];
  const response = await fetch(`${endpoint}/list`, { cache:'no-store' });
  if (!response.ok) throw new Error(`Hébergement vidéo indisponible (HTTP ${response.status}).`);
  return (await response.json()).videos || [];
}
