export const MIN_PLAYERS = 2;
/** Un extrait plus long fatigue tout le monde et alourdit les prises audio. */
export const MAX_CLIP_SECONDS = 45;
export const VOTE_VALUES = [-1, 0, 1, 2];
export const SUPER_LIKE = 2;

export const TROPHIES = {
  goat:{ label:'Le GOAT', detail:'le plus de super likes reçus' },
  liker:{ label:'Le Liker', detail:'le plus de +1 donnés' },
  hater:{ label:'Le Hater', detail:'le plus de -1 donnés' },
};

/** « 83 », « 1:23 », « 1m23s », « 1:02:03 » → secondes (null si illisible). */
export function parseTime(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return null;
  if (/^\d+(\.\d+)?$/.test(text)) return Number(text);
  if (/^\d+(:\d{1,2}){1,2}$/.test(text)) return text.split(':').reduce((total, part) => total * 60 + Number(part), 0);
  const match = text.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (match && match[0]) return (Number(match[1]) || 0) * 3600 + (Number(match[2]) || 0) * 60 + (Number(match[3]) || 0);
  return null;
}

export function formatTime(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** Identifiant et départ éventuel d'un lien YouTube (watch, youtu.be, shorts, embed). */
export function parseYouTube(value) {
  let url;
  try { url = new URL(String(value || '').trim()); } catch { return null; }
  const host = url.hostname.replace(/^(www|m|music)\./, '');
  let id = '';
  if (host === 'youtu.be') id = url.pathname.slice(1);
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    id = url.searchParams.get('v') || url.pathname.match(/^\/(?:shorts|embed|live)\/([^/?#]+)/)?.[1] || '';
  }
  if (!/^[\w-]{11}$/.test(id)) return null;
  const start = parseTime(url.searchParams.get('t') || url.searchParams.get('start') || '');
  return { id, start:start ?? 0 };
}

/**
 * Valide un extrait avant de l'ajouter à la bibliothèque.
 * Renvoie { clip } ou { error }.
 */
export function buildClip({ kind, title, youtube = '', url = '', start = 0, end = null, duration = null }) {
  const cleanTitle = String(title || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!cleanTitle) return { error:'Donne un titre à l’extrait.' };
  const from = Math.max(0, Number(start) || 0);
  let to = end === null || end === '' ? null : Number(end);
  if (to === null && Number.isFinite(duration)) to = Math.min(duration, from + MAX_CLIP_SECONDS);
  if (!Number.isFinite(to)) return { error:'Indique la fin de l’extrait.' };
  if (to <= from + 1) return { error:'La fin doit être après le début.' };
  if (to - from > MAX_CLIP_SECONDS) return { error:`Un extrait dure au plus ${MAX_CLIP_SECONDS} secondes.` };
  if (Number.isFinite(duration) && to > duration + 0.5) return { error:'La fin dépasse la durée de la vidéo.' };
  const clip = { kind, title:cleanTitle, start:Math.round(from * 10) / 10, end:Math.round(to * 10) / 10 };
  if (kind === 'youtube') {
    if (!/^[\w-]{11}$/.test(youtube)) return { error:'Lien YouTube invalide.' };
    clip.youtubeId = youtube;
  } else if (kind === 'file') {
    if (!/^https:\/\//.test(url)) return { error:'Adresse de vidéo invalide.' };
    clip.url = url;
  } else {
    return { error:'Type d’extrait inconnu.' };
  }
  return { clip };
}

/** Un seul super like par votant et par manche : le nouveau remplace l'ancien. */
export function applyVote(myVotes = {}, takerId, value) {
  if (!VOTE_VALUES.includes(value)) return myVotes;
  const next = { ...myVotes };
  if (value === SUPER_LIKE) {
    Object.keys(next).forEach(id => { if (next[id] === SUPER_LIKE) next[id] = 1; });
  }
  next[takerId] = value;
  return next;
}

/**
 * Points de la manche : chaque doubleur reçoit la somme des votes des autres.
 * Renvoie aussi les compteurs servant aux trophées.
 */
export function tallyRound(votes = {}, takerIds = []) {
  const points = Object.fromEntries(takerIds.map(id => [id, 0]));
  const stats = {};
  const bump = (id, key) => {
    stats[id] = stats[id] || { minusGiven:0, plusGiven:0, superReceived:0 };
    stats[id][key] += 1;
  };
  Object.entries(votes || {}).forEach(([voter, ballot]) => {
    Object.entries(ballot || {}).forEach(([taker, rawValue]) => {
      const value = Number(rawValue);
      if (voter === taker || !(taker in points) || !VOTE_VALUES.includes(value)) return;
      points[taker] += value;
      if (value === -1) bump(voter, 'minusGiven');
      if (value === 1) bump(voter, 'plusGiven');
      if (value === SUPER_LIKE) bump(taker, 'superReceived');
    });
  });
  return { points, stats };
}

export function mergeStats(total = {}, round = {}) {
  const next = { ...total };
  Object.entries(round).forEach(([id, values]) => {
    const current = next[id] || { minusGiven:0, plusGiven:0, superReceived:0 };
    next[id] = {
      minusGiven:current.minusGiven + values.minusGiven,
      plusGiven:current.plusGiven + values.plusGiven,
      superReceived:current.superReceived + values.superReceived,
    };
  });
  return next;
}

/** Détenteur de chaque trophée (null si personne n'a de compteur > 0, ou égalité). */
export function awardTrophies(stats = {}) {
  const best = key => {
    const ranked = Object.entries(stats).map(([id, values]) => [id, values?.[key] || 0]).sort((a, b) => b[1] - a[1]);
    if (!ranked.length || ranked[0][1] === 0 || ranked[1]?.[1] === ranked[0][1]) return null;
    return { id:ranked[0][0], count:ranked[0][1] };
  };
  return { goat:best('superReceived'), liker:best('plusGiven'), hater:best('minusGiven') };
}

export function everyoneDone(flags = {}, ids = []) {
  return ids.length > 0 && ids.every(id => Boolean(flags?.[id]));
}

/** Ordre de diffusion mélangé, pour que l'ordre de validation ne trahisse rien. */
export function shuffle(list, random = Math.random) {
  const copy = [...list];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy;
}

/**
 * Titre lisible tiré d'un nom de fichier. Les vidéos de la première version
 * sont nommées « <dossier>/<uuid>-<nom d'origine>.mp4 » : on garde le nom d'origine.
 */
export function titleFromKey(key = '', index = 1) {
  const file = key.split('/').pop().replace(/\.[^.]+$/, '');
  const name = file
    .replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-?/i, '')
    .replace(/[_]+/g, ' ').replace(/\s+-\s+/g, ' - ').replace(/\s{2,}/g, ' ').trim();
  // Un nom purement généré (identifiant, horodatage) n'apprend rien : titre neutre.
  if (!name || /^[0-9a-f-]{16,}$/i.test(name) || /^\d{10,}$/.test(name)) return `Vidéo importée ${index}`;
  return name.slice(0, 80);
}
