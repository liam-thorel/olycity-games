/**
 * SDK OLYCITY Games.
 *
 * Tout ce dont un jeu a besoin pour exister dans l'écosystème, sans framework :
 *   - les membres du groupe (repris du tracker, source unique) ;
 *   - le profil choisi, partagé entre le portail et tous les jeux ;
 *   - un accès à Firebase Realtime Database (lecture, écriture, temps réel) ;
 *   - des lobbies à code d'invitation, avec hôte et présence.
 *
 * Un jeu en HTML natif l'importe directement :
 *   import { requireProfile, createLobby } from '/sdk/olycity.mjs';
 * Un jeu compilé (Vite, Angular…) le charge à l'exécution, pour toujours avoir
 * la version servie par le site :
 *   const olycity = await import(/* @vite-ignore *\/ '/sdk/olycity.mjs');
 */

export const FIREBASE_ROOT = 'https://realtime-database-5bb9f-default-rtdb.europe-west1.firebasedatabase.app';
export const TRACKER_ORIGIN = 'https://tracker.olycity.fr';
export const LOBBY_ROOT = 'olygames/lobbies';

const PROFILE_NAME_KEY = 'olycity-profile';
const PROFILE_ID_KEY = 'olycity-member-id';
const MEMBERS_CACHE_KEY = 'olycity-games-members-v1';
const MANAGER_IDS = new Set(['nico', 'liam']);
const PRESENCE_INTERVAL_MS = 20_000;
export const PRESENCE_TIMEOUT_MS = 60_000;

export const escapeHTML = value => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#39;');

export function safeHttpsUrl(value, allowedHosts = null) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:') return '';
    if (allowedHosts && !allowedHosts.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) return '';
    return url.href;
  } catch {
    return '';
  }
}

function storage() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

/* ─── Firebase ─────────────────────────────────────────────────────────── */

/** Applique un événement `put`/`patch` du flux Firebase à une copie locale. */
export function mergeRealtimeEvent(current = {}, message = {}) {
  const path = String(message.path || '/');
  if (message.eventType === 'patch' && message.data && typeof message.data === 'object' && !Array.isArray(message.data)) {
    return Object.entries(message.data).reduce((next, [key, value]) => mergeRealtimeEvent(next, {
      path:`${path === '/' ? '' : path}/${key}`, data:value, eventType:'put',
    }), current || {});
  }
  if (path === '/') return message.data ?? null;
  const next = { ...(current || {}) };
  const parts = path.split('/').filter(Boolean);
  let target = next;
  for (let index = 0; index < parts.length - 1; index += 1) {
    target[parts[index]] = { ...(target[parts[index]] || {}) };
    target = target[parts[index]];
  }
  const leaf = parts.at(-1);
  if (message.data === null) delete target[leaf];
  else target[leaf] = message.data;
  return next;
}

async function request(path, { method = 'GET', body, timeoutMs = 8_000, signal, query = '' } = {}) {
  const attempts = method === 'POST' || method === 'DELETE' ? 1 : 2;
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once:true });
    const timer = setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), timeoutMs);
    try {
      const response = await fetch(`${FIREBASE_ROOT}/${path}.json${query}`, {
        method,
        cache:'no-store',
        signal:controller.signal,
        headers:{ 'Content-Type':'application/json' },
        body:body === undefined ? undefined : JSON.stringify(body),
      });
      if (!response.ok) {
        const error = new Error(`Firebase HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }
      return response.status === 204 ? null : response.json();
    } catch (error) {
      lastError = error;
      const status = Number(error?.status || 0);
      if (signal?.aborted || (status && status < 500) || attempt >= attempts) break;
      await new Promise(resolve => setTimeout(resolve, 350));
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }
  if (lastError?.status === 401 || lastError?.status === 403) {
    throw new Error('Écriture refusée par Firebase : vérifie les règles de la base pour ce chemin.');
  }
  if (lastError?.name === 'AbortError' || lastError?.name === 'TimeoutError') {
    throw new Error('Connexion interrompue — réessaie dans un instant.');
  }
  throw lastError || new Error('Connexion Firebase indisponible.');
}

export const db = {
  get:(path, options) => request(path, options),
  set:(path, value) => request(path, { method:'PUT', body:value }),
  update:(path, patch) => request(path, { method:'PATCH', body:patch }),
  /** Ajoute un enfant à clé générée par Firebase et renvoie cette clé. */
  push:async (path, value) => (await request(path, { method:'POST', body:value }))?.name || '',
  remove:path => request(path, { method:'DELETE' }),
  /**
   * Suit un chemin en temps réel. `onValue` reçoit la valeur complète à chaque
   * changement (null si le chemin est vide). Renvoie la fonction d'arrêt.
   */
  subscribe(path, onValue, { onError } = {}) {
    if (typeof EventSource === 'undefined') {
      let stopped = false;
      const poll = async () => {
        if (stopped) return;
        try { onValue(await request(path)); } catch (error) { onError?.(error); }
        if (!stopped) setTimeout(poll, 3_000);
      };
      poll();
      return () => { stopped = true; };
    }
    let value = null;
    const source = new EventSource(`${FIREBASE_ROOT}/${path}.json`);
    const apply = event => {
      try {
        value = mergeRealtimeEvent(value, { ...JSON.parse(event.data), eventType:event.type });
        onValue(value);
      } catch (error) { onError?.(error); }
    };
    source.addEventListener('put', apply);
    source.addEventListener('patch', apply);
    source.addEventListener('error', event => onError?.(event));
    return () => source.close();
  },
};

/* ─── Membres ──────────────────────────────────────────────────────────── */

export function memberId(value = '') {
  return String(value || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, '');
}

/** Même fusion que le tracker : roster, puis members.json, puis l'admin Firebase. */
export function mergeMemberProfiles({ roster = [], members = [], overlay = {} } = {}) {
  const profiles = new Map();
  const order = [];
  const hidden = overlay?.hiddenMembers || {};
  const register = (entry = {}, forcedId = '') => {
    const id = memberId(forcedId || entry.id || entry.name);
    if (!id || hidden[id]) return;
    if (!profiles.has(id)) order.push(id);
    profiles.set(id, { ...(profiles.get(id) || {}), ...entry, id });
  };
  roster.forEach(entry => register(entry));
  members.forEach(entry => register(entry));
  Object.entries(overlay?.members || {}).forEach(([id, entry]) => register(entry, id));
  return order.map(id => profiles.get(id)).filter(profile => profile?.name)
    .map(({ id, name, avatar = '', role = '' }) => ({ id, name, avatar:safeHttpsUrl(avatar), role }));
}

let membersPromise = null;

export function loadMembers({ force = false } = {}) {
  if (membersPromise && !force) return membersPromise;
  membersPromise = (async () => {
    const getJson = url => fetch(url, { cache:'no-cache' }).then(response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    });
    const [roster, members, overlay] = await Promise.allSettled([
      getJson(`${TRACKER_ORIGIN}/data/roster.json`),
      getJson(`${TRACKER_ORIGIN}/data/members.json`),
      request('rosterOverlay', { timeoutMs:3_000 }),
    ]);
    const merged = mergeMemberProfiles({
      roster:roster.status === 'fulfilled' && Array.isArray(roster.value) ? roster.value : [],
      members:members.status === 'fulfilled' && Array.isArray(members.value) ? members.value : [],
      overlay:overlay.status === 'fulfilled' ? overlay.value || {} : {},
    });
    if (merged.length) {
      try { storage()?.setItem(MEMBERS_CACHE_KEY, JSON.stringify(merged)); } catch { /* stockage plein */ }
      return merged;
    }
    try { return JSON.parse(storage()?.getItem(MEMBERS_CACHE_KEY) || '[]'); } catch { return []; }
  })();
  return membersPromise;
}

/* ─── Profil ───────────────────────────────────────────────────────────── */

/** Profil courant, ou null tant que personne n'a été choisi (l'invité compte comme personne). */
export async function currentProfile() {
  const id = storage()?.getItem(PROFILE_ID_KEY) || '';
  const name = storage()?.getItem(PROFILE_NAME_KEY) || '';
  if (!id && !name) return null;
  const members = await loadMembers();
  return members.find(member => member.id === id) || members.find(member => member.name === name) || null;
}

export function isManager(profile) {
  return MANAGER_IDS.has(String(profile?.id || '').toLowerCase());
}

export function setProfile(profile) {
  const next = profile || { id:'guest', name:'Guest' };
  storage()?.setItem(PROFILE_ID_KEY, next.id);
  storage()?.setItem(PROFILE_NAME_KEY, next.name);
  globalThis.dispatchEvent?.(new CustomEvent('olycity:profile-change', { detail:profile || null }));
}

export function onProfileChange(callback) {
  const handler = event => callback(event.detail ?? null);
  const crossTab = event => { if (event.key === PROFILE_ID_KEY) currentProfile().then(callback); };
  globalThis.addEventListener?.('olycity:profile-change', handler);
  globalThis.addEventListener?.('storage', crossTab);
  return () => {
    globalThis.removeEventListener?.('olycity:profile-change', handler);
    globalThis.removeEventListener?.('storage', crossTab);
  };
}

const PICKER_CSS = `
.oly-picker{position:fixed;inset:0;z-index:9000;display:grid;place-items:center;padding:24px 16px;overflow:auto;
  background:radial-gradient(circle at 50% 10%,rgba(255,70,86,.1),transparent 40%),rgba(7,8,12,.96);backdrop-filter:blur(10px);
  color:#e2e5ee;font:15px/1.5 'DM Sans',system-ui,sans-serif}
.oly-picker-shell{position:relative;width:min(760px,100%)}
.oly-picker header{text-align:center;margin-bottom:26px}
.oly-picker header span{color:#ff4656;font:700 11px Tomorrow,sans-serif;letter-spacing:3px;text-transform:uppercase}
.oly-picker header h2{margin:6px 0 4px;font:700 clamp(28px,5vw,40px)/1.1 Tomorrow,sans-serif}
.oly-picker header p{color:#9298ab;font-size:14px}
.oly-picker-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(118px,1fr));gap:10px}
.oly-picker-card{display:flex;flex-direction:column;align-items:center;gap:8px;padding:14px 6px;border:1px solid transparent;border-radius:10px;
  background:transparent;color:inherit;font:inherit;cursor:pointer;transition:background .2s,transform .2s}
.oly-picker-card:hover,.oly-picker-card:focus-visible{background:rgba(255,255,255,.05);transform:translateY(-2px);outline:none}
.oly-picker-card.is-current{border-color:rgba(255,70,86,.45)}
.oly-picker-avatar{display:grid;place-items:center;width:84px;height:84px;overflow:hidden;border:1px solid rgba(255,255,255,.14);border-radius:10px;
  background:#1f2330;font:700 26px Tomorrow,sans-serif}
.oly-picker-avatar img{width:100%;height:100%;object-fit:cover}
.oly-picker-card strong{font:700 13px Tomorrow,sans-serif;letter-spacing:1px;text-transform:uppercase}
.oly-picker-foot{display:flex;justify-content:center;gap:10px;margin-top:22px}
.oly-picker-foot button{min-height:44px;padding:0 18px;border:1px solid rgba(255,255,255,.14);border-radius:8px;background:transparent;
  color:#9298ab;font:600 13px 'DM Sans',sans-serif;cursor:pointer}
.oly-picker-foot button:hover{color:#e2e5ee;border-color:#e2e5ee}
.oly-picker-empty{text-align:center;color:#9298ab}`;

/**
 * Affiche le choix du profil. Résout avec le profil choisi, ou null si la
 * personne continue en invité ou ferme la fenêtre.
 */
export async function pickProfile({ title = 'Qui es-tu ?', subtitle = 'Choisis ton profil pour voter et jouer.' } = {}) {
  if (typeof document === 'undefined') return null;
  if (!document.getElementById('oly-picker-css')) {
    const style = document.createElement('style');
    style.id = 'oly-picker-css';
    style.textContent = PICKER_CSS;
    document.head.append(style);
  }
  const [members, current] = await Promise.all([loadMembers(), currentProfile()]);
  return new Promise(resolve => {
    const root = document.createElement('div');
    root.className = 'oly-picker';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.innerHTML = `<div class="oly-picker-shell">
      <header><span>OLYCITY</span><h2>${escapeHTML(title)}</h2><p>${escapeHTML(subtitle)}</p></header>
      ${members.length ? `<div class="oly-picker-grid">${members.map(member => `
        <button type="button" class="oly-picker-card${current?.id === member.id ? ' is-current' : ''}" data-id="${escapeHTML(member.id)}">
          <span class="oly-picker-avatar">${member.avatar ? `<img src="${escapeHTML(member.avatar)}" alt="">` : escapeHTML(member.name.slice(0, 1))}</span>
          <strong>${escapeHTML(member.name)}</strong>
        </button>`).join('')}</div>` : '<p class="oly-picker-empty">Impossible de charger les membres pour le moment.</p>'}
      <div class="oly-picker-foot"><button type="button" data-guest>Continuer en invité</button></div>
    </div>`;
    const close = profile => {
      root.remove();
      document.removeEventListener('keydown', onKey);
      resolve(profile);
    };
    const onKey = event => { if (event.key === 'Escape') close(current); };
    root.addEventListener('click', event => {
      const card = event.target.closest('[data-id]');
      if (card) {
        const profile = members.find(member => member.id === card.dataset.id) || null;
        setProfile(profile);
        close(profile);
      } else if (event.target.closest('[data-guest]')) {
        setProfile(null);
        close(null);
      } else if (event.target === root) close(current);
    });
    document.addEventListener('keydown', onKey);
    document.body.append(root);
    root.querySelector('.is-current, .oly-picker-card, button')?.focus();
  });
}

/** Profil courant, ou ouvre le choix du profil s'il n'y en a pas. */
export async function requireProfile(options) {
  return (await currentProfile()) || pickProfile(options);
}

/* ─── Lobbies ──────────────────────────────────────────────────────────── */

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

export function generateLobbyCode(random = Math.random, length = 4) {
  return Array.from({ length }, () => CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)]).join('');
}

export function normalizeLobbyCode(value = '') {
  return String(value || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6);
}

/** Joueurs encore présents, du plus ancien au plus récent arrivé. */
export function activePlayers(lobby, now = Date.now()) {
  return Object.entries(lobby?.players || {})
    .map(([id, player]) => ({ id, ...(player || {}) }))
    .filter(player => now - Number(player.lastSeen || 0) <= PRESENCE_TIMEOUT_MS)
    .sort((left, right) => Number(left.joinedAt || 0) - Number(right.joinedAt || 0));
}

function playerRecord(profile) {
  const now = Date.now();
  return { name:profile.name, avatar:profile.avatar || '', joinedAt:now, lastSeen:now };
}

export class Lobby {
  constructor(code, profile) {
    this.code = code;
    this.me = profile;
    this.path = `${LOBBY_ROOT}/${code}`;
    this.data = null;
    this.stopStream = null;
    this.presenceTimer = null;
  }

  get isHost() {
    return this.data?.hostId === this.me.id;
  }

  get players() {
    return activePlayers(this.data);
  }

  /** Suit le lobby en temps réel. `callback(data, lobby)` ; data vaut null si le lobby a été supprimé. */
  subscribe(callback) {
    this.stopStream?.();
    this.stopStream = db.subscribe(this.path, data => {
      this.data = data;
      callback(data, this);
    });
    this.startPresence();
    return () => this.stopStream?.();
  }

  startPresence() {
    clearInterval(this.presenceTimer);
    this.presenceTimer = setInterval(() => {
      db.set(`${this.path}/players/${this.me.id}/lastSeen`, Date.now()).catch(() => {});
      // Un hôte parti sans quitter (onglet fermé) : le plus ancien présent prend la main.
      const players = this.players;
      if (this.data && !players.some(player => player.id === this.data.hostId) && players[0]?.id === this.me.id) {
        db.update(this.path, { hostId:this.me.id }).catch(() => {});
      }
    }, PRESENCE_INTERVAL_MS);
  }

  /** Modifie les champs du lobby (status, settings…). */
  update(patch) { return db.update(this.path, patch); }

  /** Modifie l'état propre au jeu, sous `state/`. */
  setState(patch) { return db.update(`${this.path}/state`, patch); }

  /** Lance la partie (hôte). */
  start(state = {}) {
    return db.update(this.path, { status:'playing', startedAt:Date.now(), state });
  }

  async leave() {
    clearInterval(this.presenceTimer);
    this.stopStream?.();
    const others = this.players.filter(player => player.id !== this.me.id);
    if (!others.length) return db.remove(this.path);
    await db.remove(`${this.path}/players/${this.me.id}`);
    if (this.isHost) await db.update(this.path, { hostId:others[0].id });
  }
}

export async function createLobby(gameSlug, { profile, settings = {} } = {}) {
  const me = profile || await requireProfile();
  if (!me) throw new Error('Choisis un profil pour créer un lobby.');
  let code = '';
  for (let attempt = 0; attempt < 6 && !code; attempt += 1) {
    const candidate = generateLobbyCode();
    if (!(await db.get(`${LOBBY_ROOT}/${candidate}`, { query:'?shallow=true' }))) code = candidate;
  }
  if (!code) throw new Error('Impossible de générer un code de lobby, réessaie.');
  await db.set(`${LOBBY_ROOT}/${code}`, {
    game:gameSlug, hostId:me.id, status:'waiting', createdAt:Date.now(), settings, state:{},
    players:{ [me.id]:playerRecord(me) },
  });
  return new Lobby(code, me);
}

export async function joinLobby(rawCode, { profile, gameSlug } = {}) {
  const code = normalizeLobbyCode(rawCode);
  const me = profile || await requireProfile();
  if (!me) throw new Error('Choisis un profil pour rejoindre un lobby.');
  const lobby = await db.get(`${LOBBY_ROOT}/${code}`);
  if (!lobby) throw new Error(`Aucun lobby ${code}.`);
  if (gameSlug && lobby.game !== gameSlug) throw new Error(`Le lobby ${code} est une partie d'un autre jeu.`);
  const existing = lobby.players?.[me.id];
  await db.set(`${LOBBY_ROOT}/${code}/players/${me.id}`, existing ? { ...existing, lastSeen:Date.now() } : playerRecord(me));
  return new Lobby(code, me);
}
