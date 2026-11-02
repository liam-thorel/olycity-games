import { genreLabel, visibleGenre } from './genre-labels.mjs';
import { tonightParticipantCount } from '../night/night-panel.mjs';
import {
  canDeleteCoopGame,
  catalogFields,
  extractSteamAppId,
  filterCoopGames,
  normalizeCoopGame,
  profileKey,
  rankCatalogResults,
  steamCover,
} from './coop-games-utils.mjs';
import { fetchSteamDetails, searchGameCatalog } from './coop-game-catalog.mjs';
import { FIREBASE_ROOT, db, escapeHTML, mergeRealtimeEvent, pickProfile, safeHttpsUrl } from '../../sdk/olycity.mjs';

const COOP_GAMES_CACHE_KEY = 'olycity-coop-games-cache-v1';
const SESSION_LABELS = { short: 'Soirée', medium: 'Quelques sessions', long: 'Longue aventure' };
const STATUS_META = {
  open: { label:'À découvrir', section:'À découvrir', description:'Les idées proposées par le groupe.' },
  planned: { label:'Planifié', section:'Planifiés', description:'Les jeux retenus pour une prochaine session.' },
  replay: { label:'À rejouer', section:'À rejouer', description:'Une mise à jour ou une bonne raison d’y retourner.' },
  played: { label:'Terminé', section:'Terminés', description:'Les jeux que le groupe a déjà faits.' },
};
const STATUS_LABELS = Object.fromEntries(Object.entries(STATUS_META).map(([key, value]) => [key, value.label]));
const STATUS_ORDER = ['open', 'planned', 'replay', 'played'];

let games = [];
let rawGames = {};
let roster = [];
let profile = null;
let initialized = false;
let stream = null;
let reloadTimer = null;
let loadSequence = 0;
let realtimeRevision = 0;
let catalogSearchTimer = null;
let catalogSearchSequence = 0;
let catalogAbortController = null;
let selectedCatalogGame = null;
let steamDetails = new Map();
let steamDetailIds = '';
let steamDetailsState = 'idle';
let syncNotice = null;
let recoveryAttempts = 0;
let recoveryTimer = null;
const DEFAULT_FILTERS = Object.freeze({ search: '', players: 0, genre:'all', status: 'all', sort: 'popular', demo:false });
const filters = { ...DEFAULT_FILTERS };
let compatibleTonight = false;
function effectiveFilters() {
  const count = tonightParticipantCount();
  const base = { ...filters, details:steamDetails };
  return compatibleTonight && count ? { ...base, players:count } : base;
}

function detailOf(game) {
  return steamDetails.get(String(game.steamAppId || '')) || null;
}

const shortDate = new Intl.DateTimeFormat('fr-FR', { day:'numeric', month:'short', year:'numeric' });
const monthDate = new Intl.DateTimeFormat('fr-FR', { month:'long', year:'numeric' });

function timeAgo(timestamp) {
  if (!timestamp) return '';
  const days = Math.floor((Date.now() - timestamp) / 86_400_000);
  if (days < 1) return 'aujourd’hui';
  if (days === 1) return 'hier';
  if (days < 30) return `il y a ${days} j`;
  const months = Math.floor(days / 30);
  return months < 12 ? `il y a ${months} mois` : `il y a ${Math.floor(months / 12)} an${months >= 24 ? 's' : ''}`;
}

/** « Sort le 4 nov. 2026 », « Prévu en février 2027 », « Accès anticipé »… */
function releaseFact(detail) {
  const release = detail?.release;
  if (!release) return '';
  const time = release.date ? Date.parse(`${release.date}T12:00:00Z`) : NaN;
  if (release.comingSoon) {
    if (!Number.isFinite(time)) return `<span class="coop-fact is-upcoming">${escapeHTML(release.message || 'Bientôt disponible')}</span>`;
    const label = release.precision === 'date_month' ? `Prévu en ${monthDate.format(time)}`
      : /quarter|year/.test(release.precision) ? `Prévu en ${new Date(time).getUTCFullYear()}`
        : `Sort le ${shortDate.format(time)}`;
    return `<span class="coop-fact is-upcoming">${escapeHTML(label)}</span>`;
  }
  if (release.earlyAccess) return '<span class="coop-fact">Accès anticipé</span>';
  if (Number.isFinite(time) && Date.now() - time < 30 * 86_400_000) return `<span class="coop-fact is-new">Sorti ${escapeHTML(timeAgo(time))}</span>`;
  return '';
}

function demoFact(detail, compact = false) {
  const url = safeHttpsUrl(detail?.demo?.url || '', ['steampowered.com']);
  if (!url) return '';
  return `<a class="coop-fact is-demo" href="${escapeHTML(url)}" target="_blank" rel="noopener">${compact ? 'Démo' : 'Démo jouable'}<span aria-hidden="true">↗</span></a>`;
}

function readGamesCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(COOP_GAMES_CACHE_KEY) || 'null');
    if (!cached || typeof cached.savedAt !== 'number' || !Array.isArray(cached.games)) return null;
    return {
      savedAt:cached.savedAt,
      games:cached.games.map(game => normalizeCoopGame(String(game?.id || ''), game)).filter(game => game.id),
    };
  } catch { return null; }
}

function writeGamesCache() {
  try {
    localStorage.setItem(COOP_GAMES_CACHE_KEY, JSON.stringify({ savedAt:Date.now(), games }));
  } catch { /* Le stockage peut être désactivé ou plein sur mobile. */ }
}

function syncNoticeMarkup() {
  if (!syncNotice) return '';
  const offline = syncNotice.state === 'offline';
  return `<div class="coop-cache-note is-${offline ? 'offline' : 'syncing'}" role="status"><span></span><strong>${offline ? 'Copie enregistrée' : 'Jeux déjà disponibles'}</strong><small>${offline ? 'Synchronisation indisponible pour le moment' : 'Synchronisation en arrière-plan…'}</small></div>`;
}

function selectedProfile() {
  return profile;
}

function askProfile() {
  return pickProfile({ subtitle:'Choisis ton profil pour proposer des jeux et voter.' });
}

function playerRange(game) {
  return game.minPlayers === game.maxPlayers
    ? `${game.minPlayers} joueur${game.minPlayers > 1 ? 's' : ''}`
    : `${game.minPlayers}–${game.maxPlayers} joueurs`;
}

function interestAvatars(game) {
  const people = Object.values(game.interests || {}).sort((a, b) => String(a.name).localeCompare(String(b.name), 'fr'));
  if (!people.length) return '<span class="coop-no-interest">Personne pour l’instant</span>';
  return people.map(person => {
    const member = roster.find(player => player.name === person.name);
    const avatar = safeHttpsUrl(person.avatar || member?.avatar || '');
    const initial = escapeHTML(String(person.name || '?').slice(0, 1).toUpperCase());
    return `<span class="coop-interest-avatar" title="${escapeHTML(person.name)}">
      ${avatar ? `<img src="${escapeHTML(avatar)}" alt="">` : initial}
    </span>`;
  }).join('');
}

function formatReviewCount(value) {
  return new Intl.NumberFormat('fr-FR', { notation:'compact', maximumFractionDigits:1 }).format(Number(value) || 0);
}

function steamReviewMarkup(game) {
  if (!game.steamAppId) return '';
  const review = detailOf(game)?.reviews;
  if (!review) {
    return steamDetailsState === 'error'
      ? '<span class="coop-review is-empty">Avis Steam indisponibles</span>'
      : '<span class="coop-review is-loading">Avis Steam…</span>';
  }
  if (!review.available || !review.totalReviews) return '<span class="coop-review is-empty">Pas encore d’avis</span>';
  const percent = Math.max(0, Math.min(100, Number(review.positivePercent) || 0));
  const tone = percent >= 80 ? 'positive' : percent >= 60 ? 'mixed' : 'negative';
  const label = review.label ? review.label.charAt(0).toUpperCase() + review.label.slice(1) : `${percent} % positifs`;
  return `<span class="coop-review is-${tone}" title="${escapeHTML(`${percent} % d’avis positifs sur ${review.totalReviews}`)}">
    <strong>${percent} %</strong><span>${escapeHTML(label)}</span><small>${formatReviewCount(review.totalReviews)} avis</small>
  </span>`;
}

/** Le texte du membre d'abord ; sinon le résumé du store, signalé comme tel. */
function descriptionMarkup(game) {
  const summary = detailOf(game)?.description;
  const store = summary ? `<p class="coop-note is-store"><span>Résumé Steam</span>${escapeHTML(summary)}</p>` : '';
  if (game.note) {
    // « Nouveau jeu », « Nouvelle maj » : trop court pour se faire une idée,
    // le résumé du store reste affiché en dessous.
    const own = `<p class="coop-note">${escapeHTML(game.note)}</p>`;
    return game.note.length < 30 ? own + store : own;
  }
  return store;
}

function statusControl(game, canDelete) {
  const statusOptions = STATUS_ORDER.map(status => `<button type="button" data-action="set-status" data-status="${status}" role="menuitemradio" aria-checked="${game.status === status}">
    <span class="coop-status-option-dot coop-status-${status}"></span><span><strong>${STATUS_META[status].label}</strong><small>${STATUS_META[status].description}</small></span>${game.status === status ? '<b>✓</b>' : ''}
  </button>`).join('');
  return `<div class="coop-status-control">
    <button class="coop-status coop-status-${game.status}" type="button" data-action="status-menu" aria-expanded="false" aria-haspopup="menu">${STATUS_LABELS[game.status]}<span aria-hidden="true">⌄</span></button>
    <div class="coop-status-menu" role="menu" hidden>
      <div>Changer de catégorie</div>${statusOptions}
      ${canDelete ? `<button class="coop-delete-option" type="button" data-action="delete" role="menuitem">
        <span aria-hidden="true">×</span><span><strong>Supprimer le jeu</strong><small>Retire aussi ses votes</small></span>
      </button>` : ''}
    </div>
  </div>`;
}

function gameCard(game) {
  const profile = selectedProfile();
  const canDelete = canDeleteCoopGame(profile);
  const interested = Boolean(profile && game.interests?.[profileKey(profile.name)]);
  const detail = detailOf(game);
  const cover = safeHttpsUrl(game.coverUrl || steamCover(game.steamAppId));
  const steamUrl = safeHttpsUrl(game.steamUrl, ['steampowered.com']);
  const sourceUrl = steamUrl || safeHttpsUrl(game.sourceUrl, ['igdb.com']);
  const sourceLabel = steamUrl ? 'Steam' : sourceUrl ? 'IGDB' : '';
  const genres = game.tags.filter(visibleGenre).slice(0, 2).map(genreLabel).join(', ');
  const facts = [demoFact(detail), releaseFact(detail), steamReviewMarkup(game)].filter(Boolean).join('');
  const coverMarkup = cover
    ? `<img src="${escapeHTML(cover)}" alt="" loading="lazy" onerror="this.hidden=true">`
    : `<span class="coop-cover-fallback" aria-hidden="true">${escapeHTML(game.title.slice(0, 1))}</span>`;
  const when = timeAgo(game.submittedAt);
  return `<article class="coop-game-card${game.status === 'played' ? ' is-played' : ''}" data-game-id="${escapeHTML(game.id)}">
    <button type="button" class="coop-vote-btn${interested ? ' active' : ''}" data-action="vote" aria-pressed="${interested}"
      aria-label="${interested ? 'Retirer mon vote pour' : 'Je suis chaud pour'} ${escapeHTML(game.title)}" title="${interested ? 'Tu es chaud · cliquer pour retirer' : 'Je suis chaud'}">
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 10 8 5.5l4.5 4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <strong>${game.interestCount}</strong><span>${game.interestCount > 1 ? 'chauds' : 'chaud'}</span>
    </button>
    ${sourceUrl
      ? `<a class="coop-cover" href="${escapeHTML(sourceUrl)}" target="_blank" rel="noopener" tabindex="-1" aria-hidden="true">${coverMarkup}</a>`
      : `<div class="coop-cover">${coverMarkup}</div>`}
    <div class="coop-card-body">
      <div class="coop-card-head">
        <h3>${sourceUrl ? `<a href="${escapeHTML(sourceUrl)}" target="_blank" rel="noopener">${escapeHTML(game.title)}</a>` : escapeHTML(game.title)}</h3>
        ${statusControl(game, canDelete)}
      </div>
      <div class="coop-card-meta">
        <span>${playerRange(game)}</span><span>${SESSION_LABELS[game.session]}</span>${genres ? `<span>${escapeHTML(genres)}</span>` : ''}${sourceUrl ? `<a href="${escapeHTML(sourceUrl)}" target="_blank" rel="noopener">${sourceLabel}<span aria-hidden="true"> ↗</span></a>` : ''}
      </div>
      ${facts ? `<div class="coop-facts">${facts}</div>` : ''}
      ${game.replayNote ? `<div class="coop-replay-note"><strong>Ce qui a changé${game.statusBy ? ` · ${escapeHTML(game.statusBy)}` : ''}</strong>${escapeHTML(game.replayNote)}</div>` : ''}
      ${descriptionMarkup(game)}
      <div class="coop-card-foot">
        <div class="coop-interest-list" aria-label="Partants">${interestAvatars(game)}</div>
        <span class="coop-submitter">${escapeHTML(game.submittedBy)}${when ? ` · ${when}` : ''}</span>
        ${game.status === 'played' ? '<button type="button" class="coop-replay-btn" data-action="replay">Signaler du nouveau</button>' : ''}
      </div>
    </div>
  </article>`;
}

/** Bandeau « Démos à essayer », comme les sorties récentes de Suggo. */
function demoStripMarkup() {
  if (filters.search || filters.demo || !['all', 'open'].includes(filters.status)) return '';
  const withDemo = filterCoopGames(games, { ...effectiveFilters(), status:'all', sort:'popular' })
    .filter(game => game.status !== 'played' && detailOf(game)?.demo);
  if (!withDemo.length) return '';
  const items = withDemo.slice(0, 8).map(game => {
    const detail = detailOf(game);
    const cover = safeHttpsUrl(game.coverUrl || steamCover(game.steamAppId));
    const url = safeHttpsUrl(detail.demo.url, ['steampowered.com']);
    const release = detail.release?.comingSoon ? 'Pas encore sorti' : detail.release?.earlyAccess ? 'Accès anticipé' : 'Disponible';
    return `<li><a href="${escapeHTML(url)}" target="_blank" rel="noopener">
      <span class="coop-demo-cover">${cover ? `<img src="${escapeHTML(cover)}" alt="" loading="lazy" onerror="this.hidden=true">` : ''}</span>
      <strong>${escapeHTML(game.title)}</strong>
      <small>${game.interestCount} ${game.interestCount > 1 ? 'chauds' : 'chaud'} · ${release}</small>
    </a></li>`;
  }).join('');
  return `<section class="coop-demo-strip" aria-labelledby="coop-demo-title">
    <header><div><h3 id="coop-demo-title">Démos à essayer</h3><p>Jouables gratuitement sur Steam avant de se décider.</p></div>
      ${withDemo.length > 1 ? `<button type="button" data-coop-demo-only>Voir les ${withDemo.length}</button>` : ''}</header>
    <ul>${items}</ul>
  </section>`;
}

function statusCounts(filteredGames) {
  const counts = { all:filteredGames.length, open:0, planned:0, replay:0, played:0 };
  filteredGames.forEach(game => { if (counts[game.status] !== undefined) counts[game.status] += 1; });
  return counts;
}

function renderStatusTabs() {
  const base = filterCoopGames(games, { ...effectiveFilters(), status:'all' });
  const counts = statusCounts(base);
  document.querySelectorAll('[data-coop-status]').forEach(button => {
    const active = button.dataset.coopStatus === filters.status;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
    const count = button.querySelector('[data-status-count]');
    if (count) count.textContent = counts[button.dataset.coopStatus] || 0;
  });
}

function syncGenreOptions() {
  const select = document.getElementById('coop-genre');
  if (!select) return;
  const current = filters.genre;
  const genres = [...new Set(games.flatMap(game => game.tags || []).map(tag => String(tag).trim()).filter(tag => tag && visibleGenre(tag)))]
    .sort((left, right) => left.localeCompare(right, 'fr', { sensitivity:'base' }));
  select.innerHTML = `<option value="all">Tous les genres</option>${genres.map(genre => `<option value="${escapeHTML(genre)}">${escapeHTML(genreLabel(genre))}</option>`).join('')}`;
  select.value = [...select.options].some(option => option.value === current) ? current : 'all';
  filters.genre = select.value;
}

function gameSection(status, sectionGames) {
  if (!sectionGames.length) return '';
  const meta = STATUS_META[status];
  return `<section class="coop-game-section" data-game-section="${status}">
    <header><div><h3>${meta.section}</h3><p>${meta.description}</p></div><strong>${sectionGames.length}</strong></header>
    <div class="coop-games-grid">${sectionGames.map(gameCard).join('')}</div>
  </section>`;
}

function coopStateMarkup(state, title, detail, action = '') {
  return `<div class="data-state-card is-${state} coop-data-state">
    <span class="data-state-pulse" aria-hidden="true"></span>
    <div><strong>${escapeHTML(title)}</strong><small>${escapeHTML(detail)}</small></div>
    ${state === 'loading'
      ? '<span class="data-state-lines" aria-hidden="true"><i></i><i></i></span>'
      : action}
  </div>`;
}

function render() {
  const root = document.getElementById('coop-games-grid');
  const identity = document.getElementById('coop-current-profile');
  const count = document.getElementById('coop-result-count');
  if (!root) return;
  const profile = selectedProfile();
  if (identity) identity.textContent = profile ? `Tu votes en tant que ${profile.name}` : 'Choisis d’abord ton profil';
  const confirmed = tonightParticipantCount();
  const tonightLabel = document.getElementById('coop-tonight-label');
  if (tonightLabel) tonightLabel.textContent = confirmed ? `Pour les ${confirmed} présents ce soir` : 'Ce soir : aucune présence confirmée';
  const tonightToggle = document.getElementById('coop-tonight');
  if (tonightToggle) tonightToggle.disabled = !confirmed;
  const visible = filterCoopGames(games, effectiveFilters());
  renderStatusTabs();
  if (count) count.textContent = `${visible.length} jeu${visible.length > 1 ? 'x' : ''}`;
  const grouped = filters.status === 'all' && !filters.search;
  const content = visible.length
    ? grouped
      ? STATUS_ORDER.map(status => gameSection(status, visible.filter(game => game.status === status))).join('')
      : `<div class="coop-games-grid">${visible.map(gameCard).join('')}</div>`
    : coopStateMarkup(
      'empty',
      'Aucun jeu ne correspond',
      'Retire un filtre pour retrouver toute la liste.',
      '<button type="button" class="btn btn-primary" data-coop-reset>Réinitialiser</button>',
    );
  root.innerHTML = syncNoticeMarkup() + (visible.length ? demoStripMarkup() : '') + content;
  const demoToggle = document.getElementById('coop-demo');
  if (demoToggle) demoToggle.checked = filters.demo;
}

async function loadGames({ quiet = false } = {}) {
  const sequence = ++loadSequence;
  const revision = realtimeRevision;
  const root = document.getElementById('coop-games-grid');
  if (!quiet && root && !games.length) root.innerHTML = coopStateMarkup(
    'loading',
    'Chargement des jeux',
    'Synchronisation des propositions et des votes du groupe.',
  );
  try {
    const data = await db.get('coopGames');
    if (sequence !== loadSequence || revision !== realtimeRevision) return;
    rawGames = data || {};
    games = Object.entries(rawGames).map(([id, value]) => normalizeCoopGame(id, value));
    syncNotice = null;
    recoveryAttempts = 0;
    clearTimeout(recoveryTimer);
    writeGamesCache();
    syncGenreOptions();
    render();
    void loadSteamDetails();
  } catch (error) {
    if (sequence !== loadSequence || revision !== realtimeRevision) return;
    if (games.length) {
      syncNotice = { state:'offline' };
      render();
      return;
    }
    if (recoveryAttempts < 2) {
      recoveryAttempts += 1;
      if (root) root.innerHTML = coopStateMarkup(
        'loading',
        'Reconnexion à la liste',
        `Nouvelle tentative automatique ${recoveryAttempts}/2…`,
      );
      clearTimeout(recoveryTimer);
      recoveryTimer = setTimeout(() => loadGames(), 700 * recoveryAttempts);
      return;
    }
    if (root) root.innerHTML = coopStateMarkup(
      'error',
      'Liste indisponible',
      'La connexion a été interrompue. Les jeux existants ne sont pas modifiés.',
      '<button type="button" class="btn btn-primary" data-coop-retry>Réessayer</button>',
    );
  }
}

async function loadSteamDetails() {
  const ids = [...new Set(games.map(game => game.steamAppId).filter(Boolean))].sort();
  const key = ids.join(',');
  if (!key) { steamDetails = new Map(); steamDetailIds = ''; steamDetailsState = 'idle'; return; }
  if (key === steamDetailIds) return;
  steamDetailIds = key;
  if (steamDetailsState !== 'ready') steamDetailsState = 'loading';
  try {
    const items = await fetchSteamDetails(ids);
    if (steamDetailIds !== key) return;
    steamDetails = new Map(items.filter(item => item?.found !== false).map(item => [String(item.steamAppId), item]));
    steamDetailsState = 'ready';
    render();
  } catch (detailError) {
    if (steamDetailIds !== key) return;
    steamDetailIds = '';
    steamDetailsState = 'error';
    render();
    console.warn('[OLYCITY] Détails Steam indisponibles', detailError);
  }
}

function scheduleReload() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => loadGames({ quiet: true }), 120);
}

function applyRealtimeGames(event) {
  try {
    const update = JSON.parse(event.data);
    realtimeRevision += 1;
    loadSequence += 1;
    rawGames = mergeRealtimeEvent(rawGames, { ...update, eventType:event.type }) || {};
    games = Object.entries(rawGames || {}).map(([id, value]) => normalizeCoopGame(id, value));
    syncNotice = null;
    writeGamesCache();
    syncGenreOptions();
    render();
    void loadSteamDetails();
  } catch (error) {
    console.warn('[OLYCITY] Mise à jour Jeux illisible', error);
    scheduleReload();
  }
}

function startRealtime() {
  if (stream || typeof EventSource === 'undefined') return;
  stream = new EventSource(`${FIREBASE_ROOT}/coopGames.json`);
  stream.addEventListener('put', applyRealtimeGames);
  stream.addEventListener('patch', applyRealtimeGames);
  stream.addEventListener('open', () => {
    if (!syncNotice) return;
    syncNotice = null;
    render();
  });
  stream.addEventListener('error', () => {
    // EventSource se reconnecte seul. Un événement `error` transitoire ne
    // signifie donc pas que les données REST ni les votes sont indisponibles.
    // Une lecture bornée décide de l'état réellement hors connexion.
    scheduleReload();
  });
}

function stopRealtime() {
  stream?.close();
  stream = null;
  clearTimeout(reloadTimer);
  reloadTimer = null;
  clearTimeout(recoveryTimer);
  recoveryTimer = null;
}

function restartRealtime() {
  stream?.close();
  stream = null;
  startRealtime();
}

function openForm() {
  if (!selectedProfile()) {
    void askProfile();
    return;
  }
  document.getElementById('coop-game-modal')?.classList.add('open');
  document.getElementById('coop-catalog-query')?.focus();
}

function closeForm() {
  document.getElementById('coop-game-modal')?.classList.remove('open');
}

function setSelectValue(id, value) {
  const select = document.getElementById(id);
  if (!select) return;
  const text = String(value);
  if (![...select.options].some(option => option.value === text)) {
    select.add(new Option(text, text));
  }
  select.value = text;
}

function catalogMeta(game) {
  const players = game.minPlayers === game.maxPlayers
    ? `${game.minPlayers} joueur${game.minPlayers > 1 ? 's' : ''}`
    : `${game.minPlayers}–${game.maxPlayers} joueurs`;
  const parts = [players, ...(game.tags || []).slice(0, 2)];
  if (game.releaseDate) parts.push(new Date(`${game.releaseDate}T12:00:00Z`).toLocaleDateString('fr-FR', { year: 'numeric' }));
  return parts.join(' · ');
}

function renderCatalogResults(results = []) {
  const root = document.getElementById('coop-catalog-results');
  if (!root) return;
  root.innerHTML = results.map((result, index) => {
    const game = catalogFields(result);
    const cover = safeHttpsUrl(game.coverUrl);
    return `<button class="coop-catalog-result" type="button" role="option" data-catalog-index="${index}">
      ${cover ? `<img src="${escapeHTML(cover)}" alt="" loading="lazy">` : '<span class="coop-catalog-result-cover"></span>'}
      <span class="coop-catalog-result-copy"><strong>${escapeHTML(game.title)}</strong><span>${escapeHTML(catalogMeta(game))}</span></span>
      <span class="coop-catalog-result-source">${escapeHTML(result.source === 'igdb' ? 'IGDB' : result.source === 'steam' ? 'Steam' : 'Steam · IGDB')}</span>
    </button>`;
  }).join('');
  root.querySelectorAll('[data-catalog-index]').forEach(button => {
    button.addEventListener('click', () => selectCatalogGame(results[Number(button.dataset.catalogIndex)]));
  });
}

function selectCatalogGame(result) {
  selectedCatalogGame = catalogFields(result);
  document.getElementById('coop-title').value = selectedCatalogGame.title;
  document.getElementById('coop-steam').value = selectedCatalogGame.steamUrl;
  document.getElementById('coop-tags').value = selectedCatalogGame.tags.join(', ');
  setSelectValue('coop-min-players', selectedCatalogGame.minPlayers);
  setSelectValue('coop-max-players', selectedCatalogGame.maxPlayers);
  setSelectValue('coop-session', selectedCatalogGame.session);
  const selected = document.getElementById('coop-catalog-selected');
  const cover = safeHttpsUrl(selectedCatalogGame.coverUrl);
  if (selected) {
    selected.hidden = false;
    selected.innerHTML = `${cover ? `<img src="${escapeHTML(cover)}" alt="">` : '<span class="coop-catalog-selected-cover"></span>'}
      <span><strong>${escapeHTML(selectedCatalogGame.title)}</strong><span>${escapeHTML(catalogMeta(selectedCatalogGame))}</span></span>
      <button type="button" id="coop-catalog-change">Changer</button>`;
    selected.querySelector('#coop-catalog-change')?.addEventListener('click', clearCatalogSelection);
  }
  document.getElementById('coop-catalog-results')?.replaceChildren();
  const status = document.getElementById('coop-catalog-status');
  if (status) status.textContent = 'Fiche sélectionnée — tu peux corriger les joueurs ou les genres si besoin.';
}

function clearCatalogSelection() {
  selectedCatalogGame = null;
  const selected = document.getElementById('coop-catalog-selected');
  if (selected) { selected.hidden = true; selected.replaceChildren(); }
  const query = document.getElementById('coop-catalog-query');
  if (query) { query.value = ''; query.focus(); }
  document.getElementById('coop-title').value = '';
  document.getElementById('coop-steam').value = '';
  document.getElementById('coop-tags').value = '';
}

async function runCatalogSearch() {
  const input = document.getElementById('coop-catalog-query');
  const status = document.getElementById('coop-catalog-status');
  const button = document.getElementById('coop-catalog-search-btn');
  const query = input?.value.trim() || '';
  if (query.length < 2) {
    renderCatalogResults([]);
    if (status) status.textContent = query ? 'Encore un caractère…' : '';
    return;
  }
  const requestId = ++catalogSearchSequence;
  catalogAbortController?.abort();
  catalogAbortController = new AbortController();
  if (status) { status.classList.remove('error'); status.textContent = 'Recherche…'; }
  if (button) button.disabled = true;
  try {
    const results = rankCatalogResults(await searchGameCatalog(query, { signal: catalogAbortController.signal }), query);
    if (requestId !== catalogSearchSequence) return;
    renderCatalogResults(results);
    if (status) status.textContent = results.length ? `${results.length} résultat${results.length > 1 ? 's' : ''}` : 'Aucun jeu trouvé — utilise la saisie manuelle.';
  } catch (error) {
    if (error.name === 'AbortError' || requestId !== catalogSearchSequence) return;
    renderCatalogResults([]);
    if (status) {
      status.classList.add('error');
      status.textContent = `${error.message} La saisie manuelle reste disponible.`;
    }
  } finally {
    if (requestId === catalogSearchSequence && button) button.disabled = false;
  }
}

function resetGameForm(form) {
  form.reset();
  selectedCatalogGame = null;
  document.getElementById('coop-catalog-results')?.replaceChildren();
  const selected = document.getElementById('coop-catalog-selected');
  if (selected) { selected.hidden = true; selected.replaceChildren(); }
  const status = document.getElementById('coop-catalog-status');
  if (status) { status.classList.remove('error'); status.textContent = ''; }
  const manual = document.getElementById('coop-manual-fields');
  if (manual) manual.open = false;
}

async function submitGame(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const profile = selectedProfile();
  if (!profile) return void askProfile();
  const title = document.getElementById('coop-title').value.trim();
  const steamValue = document.getElementById('coop-steam').value.trim();
  const steamAppId = extractSteamAppId(steamValue);
  const minPlayers = Number(document.getElementById('coop-min-players').value);
  const maxPlayers = Number(document.getElementById('coop-max-players').value);
  const submit = document.getElementById('coop-submit');
  const error = document.getElementById('coop-form-error');
  error.textContent = '';
  if (!title) {
    error.textContent = 'Sélectionne un jeu ou saisis son titre.';
    return;
  }
  if (steamValue && !steamAppId) {
    error.textContent = 'Le lien Steam saisi n’est pas valide.';
    return;
  }
  if (maxPlayers < minPlayers) {
    error.textContent = 'Le maximum de joueurs doit être supérieur au minimum.';
    return;
  }
  const duplicate = games.find(game => game.status !== 'played' && (
    (steamAppId && game.steamAppId === steamAppId)
    || (selectedCatalogGame?.igdbId && game.igdbId === selectedCatalogGame.igdbId)
  ));
  if (duplicate) {
    filters.status = duplicate.status;
    render();
    error.textContent = `Ce jeu est déjà dans « ${STATUS_LABELS[duplicate.status]} ». Ferme cette fenêtre pour le voir.`;
    return;
  }
  const tags = document.getElementById('coop-tags').value.split(',').map(tag => tag.trim()).filter(Boolean).slice(0, 4);
  const game = {
    title,
    steamAppId,
    steamUrl: steamAppId ? `https://store.steampowered.com/app/${steamAppId}/` : '',
    igdbId: selectedCatalogGame?.igdbId || '',
    sourceUrl: selectedCatalogGame?.sourceUrl || (steamAppId ? `https://store.steampowered.com/app/${steamAppId}/` : ''),
    catalogSource: selectedCatalogGame?.catalogSource || (steamAppId ? 'steam' : 'manual'),
    coverUrl: selectedCatalogGame?.coverUrl || steamCover(steamAppId),
    minPlayers,
    maxPlayers,
    session: document.getElementById('coop-session').value,
    tags,
    releaseDate: selectedCatalogGame?.releaseDate || '',
    note: document.getElementById('coop-note').value.trim().slice(0, 280),
    submittedBy: profile.name,
    submittedAt: Date.now(),
    status: 'open',
    interests: {
      [profileKey(profile.name)]: { name: profile.name, avatar: profile.avatar, updatedAt: Date.now() },
    },
  };
  submit.disabled = true;
  submit.textContent = 'Ajout…';
  try {
    await db.push('coopGames', game);
    resetGameForm(form);
    closeForm();
    await loadGames({ quiet: true });
  } catch (requestError) {
    error.textContent = `Ajout impossible : ${requestError.message}`;
  } finally {
    submit.disabled = false;
    submit.textContent = 'Ajouter à la liste';
  }
}

async function handleCardAction(event) {
  const button = event.target.closest('[data-action]');
  const card = button?.closest('[data-game-id]');
  if (!button || !card) return;
  const game = games.find(item => item.id === card.dataset.gameId);
  if (button.dataset.action === 'status-menu') {
    const menu = button.closest('.coop-status-control')?.querySelector('.coop-status-menu');
    const opening = Boolean(menu?.hidden);
    document.querySelectorAll('.coop-status-menu').forEach(other => { other.hidden = true; });
    document.querySelectorAll('[data-action="status-menu"]').forEach(other => other.setAttribute('aria-expanded', 'false'));
    if (menu && opening) { menu.hidden = false; button.setAttribute('aria-expanded', 'true'); }
    return;
  }
  const profile = selectedProfile();
  if (!game || !profile) return void askProfile();
  button.disabled = true;
  try {
    if (button.dataset.action === 'vote') {
      const key = profileKey(profile.name);
      const current = game.interests?.[key];
      await db.set(`coopGames/${game.id}/interests/${key}`, current ? null : { name: profile.name, avatar: profile.avatar, updatedAt: Date.now() });
    } else if (button.dataset.action === 'replay') {
      const reason = window.prompt('Qu’est-ce qui donne envie d’y rejouer ? (mise à jour, nouveau contenu…)', 'Nouvelle mise à jour');
      if (reason === null) return;
      await db.update(`coopGames/${game.id}`, { status: 'replay', replayNote: reason.trim().slice(0, 160), statusBy: profile.name, statusAt: Date.now() });
    } else if (button.dataset.action === 'set-status') {
      const nextStatus = button.dataset.status;
      if (!STATUS_META[nextStatus] || nextStatus === game.status) return;
      let replayNote = game.replayNote || null;
      if (nextStatus === 'replay') {
        const reason = window.prompt('Qu’est-ce qui donne envie d’y rejouer ? (mise à jour, nouveau contenu…)', game.replayNote || 'Nouvelle mise à jour');
        if (reason === null) return;
        replayNote = reason.trim().slice(0, 160);
      } else if (nextStatus === 'played') {
        replayNote = null;
      }
      await db.update(`coopGames/${game.id}`, { status: nextStatus, replayNote, statusBy: profile.name, statusAt: Date.now() });
    } else if (button.dataset.action === 'delete') {
      if (!canDeleteCoopGame(profile)) return;
      const confirmed = window.confirm(`Supprimer « ${game.title} » de la liste ?\n\nLes votes associés seront également supprimés. Cette action est définitive.`);
      if (!confirmed) return;
      await db.remove(`coopGames/${game.id}`);
    }
    await loadGames({ quiet: true });
  } catch (actionError) {
    window.alert(`Action impossible : ${actionError.message}`);
  } finally {
    button.disabled = false;
  }
}

function bindControls() {
  document.getElementById('coop-add-btn')?.addEventListener('click', openForm);
  document.getElementById('coop-modal-close')?.addEventListener('click', closeForm);
  document.getElementById('coop-game-modal')?.addEventListener('click', event => {
    if (event.target.id === 'coop-game-modal') closeForm();
  });
  document.getElementById('coop-game-form')?.addEventListener('submit', submitGame);
  document.getElementById('coop-catalog-search-btn')?.addEventListener('click', runCatalogSearch);
  document.getElementById('coop-catalog-query')?.addEventListener('input', () => {
    clearTimeout(catalogSearchTimer);
    const value = document.getElementById('coop-catalog-query')?.value.trim() || '';
    if (value.length < 2) {
      catalogAbortController?.abort();
      renderCatalogResults([]);
      const status = document.getElementById('coop-catalog-status');
      if (status) status.textContent = value ? 'Encore un caractère…' : '';
      return;
    }
    catalogSearchTimer = setTimeout(() => {
      runCatalogSearch();
    }, 160);
  });
  document.getElementById('coop-catalog-query')?.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); runCatalogSearch(); }
  });
  document.getElementById('coop-games-grid')?.addEventListener('click', handleCardAction);
  document.getElementById('coop-games-grid')?.addEventListener('click', event => {
    if (event.target.closest('[data-coop-demo-only]')) {
      filters.demo = true;
      render();
      document.getElementById('coop-games-grid')?.scrollIntoView({ behavior:'smooth', block:'start' });
      return;
    }
    if (event.target.closest('[data-coop-retry]')) {
      restartRealtime();
      loadGames();
      return;
    }
    if (!event.target.closest('[data-coop-reset]')) return;
    Object.assign(filters, DEFAULT_FILTERS);
    compatibleTonight = false;
    document.getElementById('coop-tonight').checked = false;
    const search = document.getElementById('coop-search');
    const players = document.getElementById('coop-players');
    const genre = document.getElementById('coop-genre');
    const sort = document.getElementById('coop-sort');
    if (search) search.value = '';
    if (players) players.value = '0';
    if (genre) genre.value = 'all';
    if (sort) sort.value = DEFAULT_FILTERS.sort;
    render();
  });
  document.addEventListener('click', event => {
    if (event.target.closest('.coop-status-control')) return;
    document.querySelectorAll('.coop-status-menu').forEach(menu => { menu.hidden = true; });
    document.querySelectorAll('[data-action="status-menu"]').forEach(button => button.setAttribute('aria-expanded', 'false'));
  });
  document.getElementById('coop-search')?.addEventListener('input', event => { filters.search = event.target.value; render(); });
  document.getElementById('coop-tonight')?.addEventListener('change', event => { compatibleTonight = event.target.checked; render(); });
  document.addEventListener('olycity:night-updated', render);
  document.getElementById('coop-players')?.addEventListener('change', event => { filters.players = Number(event.target.value); render(); });
  document.getElementById('coop-genre')?.addEventListener('change', event => { filters.genre = event.target.value; render(); });
  document.querySelectorAll('[data-coop-status]').forEach(button => button.addEventListener('click', () => { filters.status = button.dataset.coopStatus; render(); }));
  document.getElementById('coop-sort')?.addEventListener('change', event => { filters.sort = event.target.value; render(); });
  document.getElementById('coop-demo')?.addEventListener('change', event => { filters.demo = event.target.checked; render(); });
}

export function initCoopPage(nextRoster = [], nextProfile = null) {
  roster = nextRoster;
  profile = nextProfile;
  if (initialized) { render(); return; }
  initialized = true;
  const cached = readGamesCache();
  if (cached?.games.length) {
    games = cached.games;
    rawGames = Object.fromEntries(games.map(game => [game.id, game]));
    syncNotice = { state:'syncing', savedAt:cached.savedAt };
  }
  bindControls();
  startRealtime();
  if (games.length) {
    syncGenreOptions();
    render();
    void loadSteamDetails();
    void loadGames({ quiet:true });
  } else {
    void loadGames();
  }
}

export function setCoopProfile(nextProfile) {
  profile = nextProfile;
  if (initialized) render();
}

/** Jeux connus du catalogue, pour la planification des soirées. */
export function coopGames() {
  return games;
}
