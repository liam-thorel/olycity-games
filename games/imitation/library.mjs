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

export function thumbnailOf(clip) {
  return clip.kind === 'youtube' ? `https://i.ytimg.com/vi/${clip.youtubeId}/mqdefault.jpg` : '';
}

/** Titre d'une vidéo YouTube, sans clé d'API (oEmbed). */
export async function youtubeTitle(id) {
  try {
    const response = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`);
    if (!response.ok) return '';
    return String((await response.json()).title || '');
  } catch {
    return '';
  }
}

export function savedUploadToken() {
  try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
}

/** Envoie un fichier au Worker vidéo et renvoie son adresse publique. */
export async function uploadVideo(file, token, onProgress) {
  const endpoint = await videoEndpoint();
  if (!endpoint) throw new Error('L’hébergement vidéo n’est pas encore branché.');
  const result = await new Promise((resolve, reject) => {
    // XMLHttpRequest plutôt que fetch : lui seul donne la progression d'un envoi.
    const request = new XMLHttpRequest();
    request.open('POST', `${endpoint}/upload`);
    request.setRequestHeader('Authorization', `Bearer ${token}`);
    request.setRequestHeader('Content-Type', file.type || 'video/mp4');
    request.upload.onprogress = event => { if (event.lengthComputable) onProgress?.(event.loaded / event.total); };
    request.onload = () => {
      let payload = {};
      try { payload = JSON.parse(request.responseText); } catch { /* réponse vide */ }
      if (request.status >= 200 && request.status < 300 && payload.url) resolve(payload);
      else reject(new Error(request.status === 401 ? 'Code d’envoi incorrect.' : payload.error || `Envoi refusé (HTTP ${request.status}).`));
    };
    request.onerror = () => reject(new Error('Envoi interrompu.'));
    request.send(file);
  });
  try { localStorage.setItem(TOKEN_KEY, token); } catch { /* stockage indisponible */ }
  return result;
}

/* ─── Prises audio ─── */

export function saveTake(code, round, playerId, take) {
  return db.set(`${AUDIO_PATH}/${code}/${round}/${playerId}`, take);
}

export function loadTake(code, round, playerId) {
  return db.get(`${AUDIO_PATH}/${code}/${round}/${playerId}`, { timeoutMs:15_000 });
}

export function deleteRoundAudio(code, round) {
  return db.remove(`${AUDIO_PATH}/${code}/${round}`).catch(() => {});
}

export function deleteLobbyAudio(code) {
  return db.remove(`${AUDIO_PATH}/${code}`).catch(() => {});
}

/** Supprime les prises de parties qui n'existent plus (onglet fermé, partie abandonnée). */
export async function sweepOrphanAudio(lobbyRoot = 'olygames/lobbies') {
  try {
    const [audio, lobbies] = await Promise.all([
      db.get(AUDIO_PATH, { query:'?shallow=true' }),
      db.get(lobbyRoot, { query:'?shallow=true' }),
    ]);
    const orphans = Object.keys(audio || {}).filter(code => !lobbies?.[code]);
    if (orphans.length) await db.update(AUDIO_PATH, Object.fromEntries(orphans.map(code => [code, null])));
  } catch { /* le ménage attendra */ }
}
