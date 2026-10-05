import { escapeHTML, isManager, safeHttpsUrl } from '/sdk/olycity.mjs';
import { avatarMarkup, mountLobbyGame, playersMarkup } from '/sdk/lobby-ui.mjs';
import {
  MAX_CLIP_SECONDS, MIN_PLAYERS, SUPER_LIKE, TROPHIES, applyVote, awardTrophies, buildClip, everyoneDone,
  formatTime, mergeStats, parseTime, parseYouTube, shuffle, tallyRound, titleFromKey,
} from './rules.mjs';
import {
  base64ToObjectUrl, blobToBase64, createClipPlayer, getMicrophone, playDub, releaseMicrophone,
  startRecording, videoFileDuration,
} from './media.mjs';
import {
  addToLibrary, deleteHostedVideo, deleteLobbyAudio, deleteRoundAudio, listHostedVideos, listLibrary, loadTake, removeFromLibrary,
  renameInLibrary, saveTake, savedUploadToken, sweepOrphanAudio, thumbnailOf, uploadVideo,
  videoEndpoint, youtubeTitle,
} from './library.mjs';

const app = document.getElementById('app');
const MAX_TAKE_BYTES = 1_500_000;

let lobby = null;
let ui = null;
let viewKey = '';
let hostTask = '';
let clipKey = '';
let player = null;
let playerPromise = null;
let playerError = '';
let library = null;
let libraryLoading = false;
let take = null;             // { blob, url } : prise locale pas encore validée
let recordState = 'idle';    // idle | countdown | recording | review | sending
let countdown = 0;
let withOriginal = true;
let localError = '';
let audioCache = new Map();  // `${round}:${id}` → URL de la prise
let playbackSeen = '';
let currentDub = null;
let needsSoundUnlock = false;
let importNote = '';

const nameOf = (players, id) => players.find(player => player.id === id)?.name || 'Un joueur';
const scoreOf = data => player => `<small>${data.state?.scores?.[player.id] || 0}</small>`;
const clipLength = clip => formatTime((clip?.end || 0) - (clip?.start || 0));

/* ─── Squelette : la scène vidéo reste en place pendant toute la manche ─── */

function ensureSkeleton() {
  if (app.querySelector('[data-skeleton]')) return;
  destroyPlayer();
  app.innerHTML = `<section class="panel imitation" data-skeleton>
    <div data-head></div>
    <div class="stage" data-stage hidden><div class="stage-video" data-video></div><div class="stage-overlay" data-overlay hidden></div></div>
    <div data-body></div>
    <div data-status></div>
  </section>`;
  viewKey = '';
}

function destroyPlayer() {
  currentDub?.stop?.();
  currentDub = null;
  player?.destroy();
  player = null;
  playerPromise = null;
  clipKey = '';
}

/** Lecteur de l'extrait courant ; tous les appels concurrents attendent la même création. */
function ensurePlayer(clip) {
  const key = clip ? `${clip.kind}:${clip.youtubeId || clip.url}:${clip.start}:${clip.end}` : '';
  if (key === clipKey && playerPromise) return playerPromise;
  destroyPlayer();
  clipKey = key;
  playerError = '';
  if (!clip) return (playerPromise = Promise.resolve(null));
  playerPromise = createClipPlayer(app.querySelector('[data-video]'), clip).then(created => {
    if (clipKey !== key) { created.destroy(); return null; }
    player = created;
    return created;
  }).catch(error => {
    if (clipKey === key) { playerError = error.message; rerender(); }
    return null;
  });
  return playerPromise;
}

function rerender() {
  viewKey = '';
  if (lobby?.data) render(lobby.data, lobby, ui);
}

function setOverlay(html = '') {
  const overlay = app.querySelector('[data-overlay]');
  if (!overlay) return;
  overlay.hidden = !html;
  overlay.innerHTML = html;
}

/* ─── Rendu ─── */

function render(data, current, nextUi) {
  lobby = current;
  ui = nextUi;
  const players = lobby.players;
  const state = data.state || {};
  if (lobby.isHost) driveHost(data, players);
  if (data.status === 'ended') return renderEnd(data, players);
  ensureSkeleton();

  const stage = app.querySelector('[data-stage]');
  const showStage = ['record', 'playback', 'vote'].includes(state.phase) && state.clip;
  stage.hidden = !showStage;
  if (showStage) void ensurePlayer(state.clip);

  const locked = Boolean(state.takes?.[lobby.me.id]);
  const key = [state.round, state.phase, lobby.isHost, locked, recordState, countdown, clipKey, playerError, localError,
    state.playback?.nonce, needsSoundUnlock, library ? library.length : 'x', JSON.stringify(state.votes?.[lobby.me.id] || {}),
    Boolean(state.voted?.[lobby.me.id])].join('|');
  app.querySelector('[data-status]').innerHTML = statusMarkup(data, players, state);
  bindStatus(state, players);
  if (state.phase === 'vote') refreshVoteChips(state, players);
  if (key === viewKey) return;
  viewKey = key;

  app.querySelector('[data-head]').innerHTML = `<div class="round-head">
    <span class="round">Manche ${state.round}${state.clip ? ` · ${escapeHTML(state.clip.title)}` : ''}</span>
    <span class="phase-pill">${{ pick:'Choix de la vidéo', record:'Enregistrement', playback:'Diffusion', vote:'Votes', results:'Résultats' }[state.phase] || ''}</span>
  </div>`;
  const body = app.querySelector('[data-body]');
  if (state.phase === 'pick') body.innerHTML = pickMarkup(players, state);
  else if (state.phase === 'record') body.innerHTML = recordMarkup(state, locked);
  else if (state.phase === 'playback') body.innerHTML = playbackMarkup(state, players);
  else if (state.phase === 'vote') body.innerHTML = voteMarkup(state, players);
  else if (state.phase === 'results') body.innerHTML = resultsMarkup(state, players);
  if (playerError && showStage) body.insertAdjacentHTML('afterbegin', `<p class="error">${escapeHTML(playerError)}</p>`);
  bindBody(state, players);
  if (state.phase === 'vote') refreshVoteChips(state, players);
  if (state.phase === 'playback') void followPlayback(state);
  if (!['playback', 'vote'].includes(state.phase)) setOverlay('');
}

function statusMarkup(data, players, state) {
  const mark = player => {
    if (state.phase === 'record') return state.takes?.[player.id] ? '<small>✓</small>' : '<small>🎙</small>';
    if (state.phase === 'vote') return state.voted?.[player.id] ? '<small>✓</small>' : '<small>…</small>';
    return scoreOf(data)(player);
  };
  const buttons = [];
  if (lobby.isHost) {
    const takes = Object.keys(state.takes || {}).length;
    if (state.phase === 'record') buttons.push(`<button class="btn" data-host="playback" ${takes ? '' : 'disabled'}>Passer à la diffusion${takes ? ` (${takes})` : ''}</button>`);
    if (state.phase === 'playback') {
      const last = (state.playback?.index ?? 0) >= (state.order?.length || 1) - 1;
      buttons.push('<button class="btn" data-host="replay">Rejouer</button>');
      buttons.push(`<button class="btn btn-primary" data-host="${last ? 'vote' : 'next-dub'}">${last ? 'Passer au vote' : 'Doublage suivant'}</button>`);
    }
    if (state.phase === 'vote') buttons.push('<button class="btn" data-host="results">Voir les résultats</button>');
    if (state.phase === 'results') {
      buttons.push('<button class="btn" data-host="finish">Terminer la partie</button>');
      buttons.push('<button class="btn btn-primary" data-host="next-round">Manche suivante</button>');
    }
  }
  return `${playersMarkup(data, players, mark)}${buttons.length ? `<div class="row host-row">${buttons.join('')}</div>` : ''}`;
}

/* ─── Choix de la vidéo ─── */

function clipCard(clip, manager) {
  const thumb = safeHttpsUrl(thumbnailOf(clip));
  return `<article class="clip-card">
    <button type="button" class="clip-pick" data-pick="${escapeHTML(clip.id)}">
      <span class="clip-thumb">${thumb ? `<img src="${escapeHTML(thumb)}" alt="" loading="lazy">` : '<span aria-hidden="true">▶</span>'}<em>${clipLength(clip)}</em></span>
      <span class="clip-copy"><strong>${escapeHTML(clip.title)}</strong><small>${clip.kind === 'youtube' ? 'YouTube' : 'Vidéo hébergée'}${clip.addedBy ? ` · ${escapeHTML(clip.addedBy)}` : ''}</small></span>
    </button>
    ${manager ? `<div class="clip-tools">
      <button type="button" data-rename="${escapeHTML(clip.id)}" aria-label="Renommer ${escapeHTML(clip.title)}">✎</button>
      <button type="button" class="is-danger" data-remove="${escapeHTML(clip.id)}" aria-label="${clip.kind === 'file' && clip.key ? 'Supprimer définitivement' : 'Retirer de la bibliothèque'} : ${escapeHTML(clip.title)}" title="${clip.kind === 'file' && clip.key ? 'Supprimer définitivement' : 'Retirer de la bibliothèque'}">×</button>
    </div>` : ''}
  </article>`;
}

function pickMarkup(players, state) {
  if (!lobby.isHost) {
    return `<div class="waiting-card"><span class="pulse" aria-hidden="true"></span><p><strong>${escapeHTML(nameOf(players, lobby.data.hostId))}</strong> choisit la vidéo de la manche…</p></div>`;
  }
  if (!library && !libraryLoading) {
    libraryLoading = true;
    listLibrary().then(list => { library = list; libraryLoading = false; rerender(); });
  }
  const manager = isManager(lobby.me);
  const list = library
    ? library.length ? `<div class="clip-grid">${library.map(clip => clipCard(clip, manager)).join('')}</div>` : '<p class="hint">La bibliothèque est vide : ajoute un premier extrait ci-dessous.</p>'
    : '<p class="hint">Chargement de la bibliothèque…</p>';
  return `<div class="pick">
    <div class="pick-head"><h2>Choisis l’extrait à doubler</h2>
      ${manager ? '<button type="button" class="btn btn-small" data-import hidden>Importer les vidéos hébergées</button>' : ''}</div>
    <p class="hint" data-import-status>${escapeHTML(importNote)}</p>
    ${list}
    <details class="add-clip" ${library && !library.length ? 'open' : ''}>
      <summary>Ajouter un extrait YouTube</summary>
      <form class="clip-form" data-add-youtube>
        <label class="field field-wide"><span>Lien YouTube</span><input class="input" name="url" required placeholder="https://www.youtube.com/watch?v=…" autocomplete="off"></label>
        <label class="field field-wide"><span>Titre</span><input class="input" name="title" maxlength="80" placeholder="Rempli tout seul depuis YouTube"></label>
        <label class="field"><span>Début</span><input class="input" name="start" placeholder="0:00" autocomplete="off"></label>
        <label class="field"><span>Fin (max ${MAX_CLIP_SECONDS} s d’extrait)</span><input class="input" name="end" required placeholder="0:30" autocomplete="off"></label>
        <p class="error field-wide" data-form-error></p>
        <button class="btn btn-primary field-wide" type="submit">Ajouter et jouer cet extrait</button>
      </form>
    </details>
    <details class="add-clip" data-upload-block>
      <summary>Envoyer une vidéo</summary>
      <form class="clip-form" data-add-file>
        <label class="field field-wide"><span>Fichier vidéo (MP4 conseillé, 100 Mo max)</span><input class="input" type="file" name="file" accept="video/*" required></label>
        <label class="field field-wide"><span>Titre</span><input class="input" name="title" maxlength="80" required></label>
        <label class="field"><span>Début</span><input class="input" name="start" placeholder="0:00" autocomplete="off"></label>
        <label class="field"><span>Fin (vide = jusqu’à ${MAX_CLIP_SECONDS} s)</span><input class="input" name="end" placeholder="0:30" autocomplete="off"></label>
        <label class="field field-wide"><span>Code d’envoi</span><input class="input" type="password" name="token" value="${escapeHTML(savedUploadToken())}" required autocomplete="off"></label>
        <p class="hint field-wide" data-upload-progress></p>
        <p class="error field-wide" data-form-error></p>
        <button class="btn btn-primary field-wide" type="submit">Envoyer et jouer cette vidéo</button>
      </form>
    </details>
  </div>`;
}

async function chooseClip(clip) {
  const { id, addedAt, addedBy, ...rest } = clip;
  await lobby.setState({ clip:rest, phase:'record', takes:null, votes:null, voted:null, playback:null, order:null, last:null });
}

/* ─── Enregistrement ─── */

function recordMarkup(state, locked) {
  if (locked) {
    return '<div class="waiting-card"><span class="pulse" aria-hidden="true"></span><p><strong>Prise validée.</strong> On attend les autres doubleurs…</p></div>';
  }
  const error = localError ? `<p class="error">${escapeHTML(localError)}</p>` : '';
  if (recordState === 'countdown') return `<div class="record-bar"><span class="countdown">${countdown}</span><p>Prépare-toi…</p></div>`;
  if (recordState === 'starting') return '<div class="record-bar"><span class="pulse" aria-hidden="true"></span><p>Lancement de la vidéo…</p></div>';
  if (recordState === 'recording') return '<div class="record-bar is-live"><span class="rec-dot" aria-hidden="true"></span><p><strong>Enregistrement</strong> jusqu’à la fin de l’extrait</p></div>';
  if (recordState === 'sending') return '<div class="record-bar"><p>Envoi de ta prise…</p></div>';
  if (recordState === 'review') {
    return `${error}<div class="record-actions">
      <button class="btn" data-rec="review">▶ Réécouter</button>
      <button class="btn" data-rec="retry">↺ Refaire</button>
      <button class="btn btn-primary" data-rec="lock">✓ Valider ma prise</button>
    </div>`;
  }
  return `${error}<div class="record-actions">
    <button class="btn" data-rec="preview">▶ Voir l’extrait</button>
    <button class="btn btn-primary btn-rec" data-rec="start"><span class="rec-dot" aria-hidden="true"></span>Enregistrer ma prise</button>
  </div>
  <label class="toggle"><input type="checkbox" data-original ${withOriginal ? 'checked' : ''}> Entendre le son original pendant la prise <small>(avec un casque, sinon le micro le capte)</small></label>
  <p class="hint">Une prise dure exactement l’extrait (${clipLength(state.clip)}). Tu peux la refaire autant que tu veux avant de valider.</p>`;
}

async function startTake() {
  localError = '';
  let stream;
  try {
    stream = await getMicrophone();
  } catch (error) {
    localError = error.name === 'NotAllowedError' ? 'Micro refusé : autorise-le dans ton navigateur pour doubler.' : error.message;
    return rerender();
  }
  const ready = await ensurePlayer(lobby.data.state.clip);
  if (!ready) return rerender();
  for (countdown = 3; countdown > 0; countdown -= 1) {
    recordState = 'countdown';
    rerender();
    await new Promise(resolve => setTimeout(resolve, 700));
  }
  let recording = null;
  const stopOnEnd = ready.onEnd(async () => {
    stopOnEnd();
    const blob = await recording?.stop();
    if (take?.url) URL.revokeObjectURL(take.url);
    take = blob ? { blob, url:URL.createObjectURL(blob) } : null;
    recordState = take ? 'review' : 'idle';
    rerender();
  });
  recordState = 'starting';
  rerender();
  try {
    await ready.play({ muted:!withOriginal });
  } catch (error) {
    stopOnEnd();
    localError = error.message;
    recordState = take ? 'review' : 'idle';
    return rerender();
  }
  recording = startRecording(stream);
  recordState = 'recording';
  rerender();
}

async function lockTake() {
  if (!take) return;
  if (take.blob.size > MAX_TAKE_BYTES) {
    localError = 'Prise trop lourde, réessaie (micro très bruyant ?).';
    return rerender();
  }
  recordState = 'sending';
  rerender();
  try {
    const state = lobby.data.state;
    await saveTake(lobby.code, state.round, lobby.me.id, { mime:take.blob.type || 'audio/webm', data:await blobToBase64(take.blob) });
    await lobby.setState({ [`takes/${lobby.me.id}`]:{ at:Date.now() } });
    audioCache.set(`${state.round}:${lobby.me.id}`, take.url);
    take = null;
    recordState = 'idle';
  } catch (error) {
    localError = `Envoi impossible : ${error.message}`;
    recordState = 'review';
  }
  rerender();
}

/* ─── Diffusion ─── */

async function audioUrlFor(round, id) {
  const key = `${round}:${id}`;
  if (audioCache.has(key)) return audioCache.get(key);
  const stored = await loadTake(lobby.code, round, id);
  if (!stored?.data) return '';
  const url = base64ToObjectUrl(stored.data, stored.mime);
  audioCache.set(key, url);
  return url;
}

function playbackMarkup(state, players) {
  const order = state.order || [];
  const index = state.playback?.index ?? 0;
  return `<div class="playback">
    <p class="now-playing">Doublage ${index + 1} / ${order.length} · <strong>${escapeHTML(nameOf(players, order[index]))}</strong></p>
    <ol class="dub-steps">${order.map((id, step) => `<li class="${step < index ? 'is-done' : step === index ? 'is-current' : ''}">${escapeHTML(nameOf(players, id))}</li>`).join('')}</ol>
    ${needsSoundUnlock ? '<button class="btn btn-primary" data-unlock>🔊 Activer le son et écouter</button>' : ''}
  </div>`;
}

async function playTake(round, id) {
  currentDub?.stop();
  currentDub = null;
  const ready = await ensurePlayer(lobby.data.state.clip);
  const url = await audioUrlFor(round, id);
  if (!ready || !url) return;
  try {
    currentDub = await playDub(ready, url);
    needsSoundUnlock = false;
    // En phase de vote, le nom du doubleur disparaît avec la fin de la relecture.
    const off = ready.onEnd(() => { off(); if (lobby.data?.state?.phase === 'vote') setOverlay(''); });
  } catch {
    // Lecture automatique bloquée par le navigateur : un clic suffit à la débloquer.
    needsSoundUnlock = true;
  }
  rerender();
}

async function followPlayback(state) {
  const nonce = `${state.round}:${state.playback?.nonce}`;
  // Toutes les prises sont préchargées dès le début de la diffusion.
  (state.order || []).forEach(id => { void audioUrlFor(state.round, id); });
  if (!state.playback || playbackSeen === nonce) return;
  playbackSeen = nonce;
  const id = state.order?.[state.playback.index];
  setOverlay(`<span>${escapeHTML(nameOf(lobby.players, id))}</span>`);
  await playTake(state.round, id);
}

/* ─── Votes ─── */

const VOTE_BUTTONS = [[-1, '−1'], [0, '0'], [1, '+1'], [SUPER_LIKE, '★']];

function voteMarkup(state, players) {
  const mine = state.votes?.[lobby.me.id] || {};
  const done = Boolean(state.voted?.[lobby.me.id]);
  return `<div class="votes">
    <p class="hint">Note chaque doublage. Le ★ vaut 2 points, un seul par manche. Les votes sont publics.</p>
    <div class="vote-rows">${(state.order || []).map(id => {
      const player = players.find(item => item.id === id) || { name:'Un joueur' };
      const self = id === lobby.me.id;
      return `<article class="vote-row${self ? ' is-self' : ''}">
        <div class="vote-who">${avatarMarkup(player)}<strong>${escapeHTML(player.name)}</strong></div>
        <button class="btn btn-small" data-replay="${escapeHTML(id)}" aria-label="Revoir le doublage de ${escapeHTML(player.name)}">▶</button>
        <div class="vote-buttons">${self ? '<span class="self-note">Ta prise</span>' : VOTE_BUTTONS.map(([value, label]) => `<button type="button" class="vote-btn${mine[id] === value ? ' is-active' : ''}${value === SUPER_LIKE ? ' is-super' : ''}" data-vote="${escapeHTML(id)}" data-value="${value}" ${done ? 'disabled' : ''}>${label}</button>`).join('')}</div>
        <div class="vote-chips" data-chips="${escapeHTML(id)}"></div>
      </article>`;
    }).join('')}</div>
    ${done ? '<p class="hint">✓ Votes envoyés. On attend les autres…</p>' : '<button class="btn btn-primary" data-voted>J’ai fini de voter</button>'}
  </div>`;
}

/** Les votes des autres s'affichent en direct sous chaque doublage. */
function refreshVoteChips(state, players) {
  app.querySelectorAll('[data-chips]').forEach(root => {
    const taker = root.dataset.chips;
    root.innerHTML = Object.entries(state.votes || {}).filter(([voter, ballot]) => voter !== taker && ballot?.[taker] !== undefined)
      .map(([voter, ballot]) => `<span class="chip v${String(ballot[taker]).replace('-', 'm')}">${escapeHTML(nameOf(players, voter))} ${ballot[taker] === SUPER_LIKE ? '★' : ballot[taker] > 0 ? `+${ballot[taker]}` : ballot[taker]}</span>`).join('');
  });
}

/* ─── Résultats ─── */

function resultsMarkup(state, players) {
  const points = state.last?.points || {};
  const ranked = Object.keys(points).sort((left, right) => points[right] - points[left]);
  return `<div class="results-block">
    <h2>${ranked.length ? `${escapeHTML(nameOf(players, ranked[0]))} remporte la manche` : 'Personne n’a doublé'}</h2>
    <ol class="results">${ranked.map((id, index) => `<li class="${index === 0 ? 'is-winner' : ''}"><span>${escapeHTML(nameOf(players, id))}</span><span>${points[id] > 0 ? '+' : ''}${points[id]}</span></li>`).join('')}</ol>
  </div>`;
}

function renderEnd(data, players) {
  destroyPlayer();
  releaseMicrophone();
  viewKey = '';
  const scores = data.state?.scores || {};
  const ranked = [...players].sort((left, right) => (scores[right.id] || 0) - (scores[left.id] || 0));
  const trophies = awardTrophies(data.state?.stats || {});
  const podium = ranked.slice(0, 3);
  // Rang partagé en cas d'égalité : 1 + le nombre de joueurs strictement devant.
  const rankOf = player => 1 + ranked.filter(other => (scores[other.id] || 0) > (scores[player.id] || 0)).length;
  app.innerHTML = `<section class="panel card imitation">
    <span class="round">Fin de partie · ${data.state?.round || 0} manche${(data.state?.round || 0) > 1 ? 's' : ''}</span>
    <div class="podium">${[podium[1], podium[0], podium[2]].map((player, slot) => player ? `<div class="podium-step step-${[2, 1, 3][slot]}">
      ${avatarMarkup(player)}<strong>${escapeHTML(player.name)}</strong><small>${scores[player.id] || 0} pt</small><span>${rankOf(player)}</span></div>` : '<div></div>').join('')}</div>
    <ol class="results">${ranked.map(player => `<li class="${rankOf(player) === 1 ? 'is-winner' : ''}"><span>${escapeHTML(player.name)}</span><span>${scores[player.id] || 0} pt</span></li>`).join('')}</ol>
    <div class="trophies">${Object.entries(TROPHIES).map(([key, trophy]) => {
      const winner = trophies[key];
      return `<div class="trophy${winner ? '' : ' is-empty'}"><strong>${trophy.label}</strong><span>${winner ? `${escapeHTML(nameOf(players, winner.id))} · ${winner.count}` : 'Personne'}</span><small>${trophy.detail}</small></div>`;
    }).join('')}</div>
    <div class="row">
      ${lobby.isHost ? '<button class="btn btn-primary" data-again>Nouvelle partie</button>' : '<p>L’hôte peut relancer une partie.</p>'}
      <button class="btn" data-leave>Quitter</button>
    </div>
  </section>`;
  app.querySelector('[data-again]')?.addEventListener('click', ui.backToLobby);
  app.querySelector('[data-leave]').addEventListener('click', ui.leave);
}

/* ─── Interactions ─── */

function bindBody(state, players) {
  const body = app.querySelector('[data-body]');
  body.querySelectorAll('[data-pick]').forEach(button => button.addEventListener('click', () => {
    const clip = library?.find(item => item.id === button.dataset.pick);
    if (clip) void chooseClip(clip);
  }));
  body.querySelectorAll('[data-remove]').forEach(button => button.addEventListener('click', async () => {
    const clip = library?.find(item => item.id === button.dataset.remove);
    if (!clip) return;
    const hosted = clip.kind === 'file' && clip.key;
    const question = hosted
      ? `Supprimer définitivement « ${clip.title} » ?\n\nLe fichier vidéo sera effacé de l’hébergement et ne pourra pas être récupéré.`
      : `Retirer « ${clip.title} » de la bibliothèque ?\n\n(La vidéo reste sur YouTube.)`;
    if (!window.confirm(question)) return;
    if (hosted) {
      const token = savedUploadToken() || window.prompt('Code d’envoi (nécessaire pour supprimer une vidéo hébergée)')?.trim();
      if (!token) return;
      button.disabled = true;
      try {
        // Le fichier d'abord : en cas d'échec, l'extrait reste dans la bibliothèque.
        await deleteHostedVideo(clip.key, token);
      } catch (error) {
        button.disabled = false;
        window.alert(error.message);
        return;
      }
    }
    await removeFromLibrary(clip.id);
    library = library.filter(item => item.id !== clip.id);
    importNote = hosted ? `« ${clip.title} » a été supprimée définitivement.` : '';
    rerender();
  }));
  body.querySelectorAll('[data-rename]').forEach(button => button.addEventListener('click', async () => {
    const clip = library?.find(item => item.id === button.dataset.rename);
    const title = clip && window.prompt('Nouveau titre de l’extrait', clip.title)?.replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!title) return;
    await renameInLibrary(clip.id, title);
    clip.title = title;
    rerender();
  }));
  bindImport(body);
  bindAddForms(body);

  body.querySelector('[data-original]')?.addEventListener('change', event => { withOriginal = event.target.checked; });
  body.querySelectorAll('[data-rec]').forEach(button => button.addEventListener('click', async () => {
    const action = button.dataset.rec;
    if (action === 'start' || action === 'retry') return startTake();
    if (action === 'lock') return lockTake();
    const ready = await ensurePlayer(state.clip);
    if (!ready) return;
    if (action === 'preview') return ready.play({ muted:false });
    if (action === 'review' && take) {
      currentDub?.stop();
      currentDub = await playDub(ready, take.url).catch(() => null);
    }
  }));

  body.querySelector('[data-unlock]')?.addEventListener('click', () => {
    needsSoundUnlock = false;
    void playTake(state.round, state.order?.[state.playback?.index ?? 0]);
  });

  body.querySelectorAll('[data-replay]').forEach(button => button.addEventListener('click', () => {
    setOverlay(`<span>${escapeHTML(nameOf(players, button.dataset.replay))}</span>`);
    void playTake(state.round, button.dataset.replay);
  }));
  body.querySelectorAll('[data-vote]').forEach(button => button.addEventListener('click', () => {
    const ballot = applyVote(state.votes?.[lobby.me.id] || {}, button.dataset.vote, Number(button.dataset.value));
    void lobby.setState({ [`votes/${lobby.me.id}`]:ballot });
  }));
  body.querySelector('[data-voted]')?.addEventListener('click', () => {
    void lobby.setState({ [`voted/${lobby.me.id}`]:true });
  });
}

/**
 * Vidéos déjà hébergées sur R2 mais absentes de la bibliothèque (celles de
 * l'ancienne version du jeu, ou envoyées autrement) : ajoutées en un clic,
 * extrait = début de la vidéo, 45 s au plus.
 */
async function bindImport(body) {
  const button = body.querySelector('[data-import]');
  if (!button) return;
  let hosted = [];
  try { hosted = await listHostedVideos(); } catch { return; }
  const known = new Set((library || []).map(clip => clip.key || clip.url));
  const fresh = hosted.filter(video => !known.has(video.key) && !known.has(video.url));
  if (!fresh.length || !button.isConnected) return;
  button.hidden = false;
  button.textContent = `Importer les vidéos hébergées (${fresh.length})`;
  button.addEventListener('click', async () => {
    button.disabled = true;
    const status = body.querySelector('[data-import-status]');
    let added = 0;
    for (const [index, video] of fresh.entries()) {
      status.textContent = `Import ${index + 1} / ${fresh.length}…`;
      const duration = await videoUrlDuration(video.url);
      const result = buildClip({ kind:'file', title:titleFromKey(video.key, (library?.length || 0) + index + 1), url:video.url, start:0, duration });
      if (result.error) continue;
      const entry = await addToLibrary({ ...result.clip, key:video.key }, lobby.me);
      library = [entry, ...(library || [])];
      added += 1;
    }
    importNote = `${added} vidéo${added > 1 ? 's' : ''} importée${added > 1 ? 's' : ''}. Renomme-les avec ✎.`;
    rerender();
  }, { once:true });
}

function videoUrlDuration(url) {
  return new Promise(resolve => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    const done = value => { video.removeAttribute('src'); video.load(); resolve(value); };
    video.onloadedmetadata = () => done(Number.isFinite(video.duration) ? video.duration : null);
    video.onerror = () => done(null);
    setTimeout(() => done(null), 15_000);
    video.src = url;
  });
}

function bindAddForms(body) {
  const youtubeForm = body.querySelector('[data-add-youtube]');
  youtubeForm?.url.addEventListener('change', async () => {
    const parsed = parseYouTube(youtubeForm.url.value);
    if (!parsed) return;
    if (!youtubeForm.start.value && parsed.start) youtubeForm.start.value = formatTime(parsed.start);
    if (!youtubeForm.title.value) youtubeForm.title.value = await youtubeTitle(parsed.id);
  });
  youtubeForm?.addEventListener('submit', async event => {
    event.preventDefault();
    const error = youtubeForm.querySelector('[data-form-error]');
    const parsed = parseYouTube(youtubeForm.url.value);
    if (!parsed) { error.textContent = 'Ce lien n’est pas une vidéo YouTube.'; return; }
    const title = youtubeForm.title.value || await youtubeTitle(parsed.id);
    const start = youtubeForm.start.value ? parseTime(youtubeForm.start.value) : parsed.start;
    const end = parseTime(youtubeForm.end.value);
    if (start === null || end === null) { error.textContent = 'Écris les temps comme 1:23 ou 83.'; return; }
    const result = buildClip({ kind:'youtube', title, youtube:parsed.id, start, end });
    if (result.error) { error.textContent = result.error; return; }
    youtubeForm.querySelector('[type="submit"]').disabled = true;
    const entry = await addToLibrary(result.clip, lobby.me);
    library = [entry, ...(library || [])];
    await chooseClip(entry);
  });

  const fileForm = body.querySelector('[data-add-file]');
  if (!fileForm) return;
  videoEndpoint().then(endpoint => {
    const block = body.querySelector('[data-upload-block]');
    if (!endpoint && block) {
      block.querySelector('summary').textContent = 'Envoyer une vidéo (hébergement pas encore branché)';
      block.querySelectorAll('input, button').forEach(element => { element.disabled = true; });
    }
  });
  fileForm.addEventListener('submit', async event => {
    event.preventDefault();
    const error = fileForm.querySelector('[data-form-error]');
    const progress = fileForm.querySelector('[data-upload-progress]');
    const file = fileForm.file.files[0];
    if (!file) return;
    if (file.size > 100 * 1024 * 1024) { error.textContent = 'Fichier trop lourd (100 Mo max).'; return; }
    const duration = await videoFileDuration(file);
    const start = fileForm.start.value ? parseTime(fileForm.start.value) : 0;
    const end = fileForm.end.value ? parseTime(fileForm.end.value) : null;
    const check = buildClip({ kind:'file', title:fileForm.title.value, url:'https://placeholder', start, end, duration });
    if (check.error) { error.textContent = check.error; return; }
    error.textContent = '';
    fileForm.querySelector('[type="submit"]').disabled = true;
    try {
      const uploaded = await uploadVideo(file, fileForm.token.value, ratio => { progress.textContent = `Envoi… ${Math.round(ratio * 100)} %`; });
      const entry = await addToLibrary({ ...check.clip, url:uploaded.url, key:uploaded.key }, lobby.me);
      library = [entry, ...(library || [])];
      await chooseClip(entry);
    } catch (uploadError) {
      error.textContent = uploadError.message;
      progress.textContent = '';
      fileForm.querySelector('[type="submit"]').disabled = false;
    }
  });
}

function bindStatus(state, players) {
  app.querySelectorAll('[data-host]').forEach(button => button.addEventListener('click', () => {
    button.disabled = true;
    hostAction(button.dataset.host, state, players);
  }, { once:true }));
}

/* ─── Hôte : il fait avancer la partie ─── */

function hostAction(action, state, players) {
  const ids = players.map(player => player.id);
  if (action === 'playback') {
    const order = shuffle(Object.keys(state.takes || {}).filter(id => ids.includes(id)));
    if (order.length) void lobby.setState({ phase:'playback', order, playback:{ index:0, nonce:1 } });
  } else if (action === 'replay') {
    void lobby.setState({ playback:{ index:state.playback?.index ?? 0, nonce:(state.playback?.nonce || 0) + 1 } });
  } else if (action === 'next-dub') {
    void lobby.setState({ playback:{ index:(state.playback?.index ?? 0) + 1, nonce:(state.playback?.nonce || 0) + 1 } });
  } else if (action === 'vote') {
    currentDub?.stop();
    void lobby.setState({ phase:'vote', playback:null });
  } else if (action === 'results') {
    const latest = lobby.data?.state || state;
    const { points, stats } = tallyRound(latest.votes || {}, latest.order || []);
    const scores = { ...(latest.scores || {}) };
    Object.entries(points).forEach(([id, value]) => { scores[id] = (scores[id] || 0) + value; });
    void lobby.setState({ phase:'results', scores, stats:mergeStats(latest.stats || {}, stats), last:{ points } });
  } else if (action === 'next-round') {
    void deleteRoundAudio(lobby.code, state.round);
    void lobby.setState({ round:state.round + 1, phase:'pick', clip:null, takes:null, votes:null, voted:null, order:null, playback:null, last:null });
  } else if (action === 'finish') {
    if (!window.confirm('Terminer la partie et afficher le podium ?')) { rerender(); return; }
    void deleteLobbyAudio(lobby.code);
    void lobby.update({ status:'ended' });
  }
}

function driveHost(data, players) {
  if (data.status !== 'playing') { hostTask = ''; return; }
  const state = data.state || {};
  const ids = players.map(player => player.id);
  const once = (task, action) => { if (hostTask !== task) { hostTask = task; action(); } };
  if (state.phase === 'record' && everyoneDone(state.takes, ids)) {
    once(`${state.round}:all-takes`, () => setTimeout(() => hostAction('playback', lobby.data.state, lobby.players), 600));
  }
  if (state.phase === 'vote') {
    const voters = ids.filter(id => (state.order || []).some(taker => taker !== id));
    if (everyoneDone(state.voted, voters)) once(`${state.round}:all-votes`, () => setTimeout(() => hostAction('results', lobby.data.state, lobby.players), 600));
  }
  // Diffusion : à la fin d'un doublage, l'hôte enchaîne sur le suivant, puis sur le vote.
  if (state.phase === 'playback' && player) {
    const task = `${state.round}:play:${state.playback?.nonce}`;
    if (hostTask !== task) {
      hostTask = task;
      const off = player.onEnd(() => {
        off();
        setTimeout(() => {
          const latest = lobby.data?.state;
          if (latest?.phase !== 'playback' || `${latest.round}:play:${latest.playback?.nonce}` !== task) return;
          const last = latest.playback.index >= latest.order.length - 1;
          hostAction(last ? 'vote' : 'next-dub', latest, lobby.players);
        }, 1_800);
      });
    }
  }
}

/* ─── Changement de manche : on repart d'une prise vierge ─── */

let lastRound = 0;
const baseRender = render;
function renderWithReset(data, current, nextUi) {
  const round = data.state?.round || 0;
  if (round !== lastRound) {
    lastRound = round;
    if (take?.url) URL.revokeObjectURL(take.url);
    take = null;
    recordState = 'idle';
    localError = '';
    needsSoundUnlock = false;
    playbackSeen = '';
    audioCache.forEach(url => URL.revokeObjectURL(url));
    audioCache = new Map();
  }
  baseRender(data, current, nextUi);
}

void sweepOrphanAudio();

mountLobbyGame({
  slug:'imitation',
  title:'The Imitation Game',
  intro:'L’hôte choisit un extrait, chacun refait la bande-son au micro, puis on écoute tous les doublages et on vote. Prévois un casque et autorise le micro.',
  minPlayers:MIN_PLAYERS,
  initialState:() => ({ round:1, phase:'pick' }),
  render:renderWithReset,
});
