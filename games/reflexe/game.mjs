import { createLobby, escapeHTML, joinLobby, normalizeLobbyCode, requireProfile } from '/sdk/olycity.mjs';
import { MIN_PLAYERS, ROUNDS, everyoneAnswered, randomDelay, resolveRound } from './rules.mjs';

const GAME = 'reflexe';
const app = document.getElementById('app');
const codeBadge = document.getElementById('lobby-code');
const isLocal = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);

let lobby = null;
let goSeen = { round:0, at:0 };
let hostTask = '';
let hostTimer = null;

function avatar(player) {
  return player.avatar
    ? `<img src="${escapeHTML(player.avatar)}" alt="">`
    : `<span class="initial">${escapeHTML(String(player.name || '?').slice(0, 1))}</span>`;
}

function playersMarkup(data, players) {
  const scores = data.state?.scores || {};
  return `<div class="players">${players.map(player => `<div class="player${player.id === data.hostId ? ' is-host' : ''}">
    ${avatar(player)}<strong>${escapeHTML(player.name)}</strong>${data.status === 'playing' || data.status === 'ended' ? `<small>${scores[player.id] || 0}</small>` : ''}
  </div>`).join('')}</div>`;
}

/* ─── Accueil : créer ou rejoindre ─── */

function renderHome(error = '') {
  codeBadge.hidden = true;
  const prefill = normalizeLobbyCode(new URLSearchParams(location.search).get('code'));
  app.innerHTML = `<section class="panel card">
    <div><h1>Réflexe</h1><p>Attends le vert, puis clique le plus vite possible. Trop tôt, et la manche est perdue. ${ROUNDS} manches, le meilleur score gagne.</p></div>
    <button class="btn btn-primary" data-create>Créer une partie</button>
    <form class="row" data-join>
      <input class="input" name="code" maxlength="6" placeholder="CODE" value="${escapeHTML(prefill)}" aria-label="Code du lobby" autocomplete="off">
      <button class="btn" type="submit">Rejoindre</button>
    </form>
    <p class="error">${escapeHTML(error)}</p>
  </section>`;
  app.querySelector('[data-create]').addEventListener('click', () => enter(() => createLobby(GAME, { settings:{ rounds:ROUNDS } })));
  app.querySelector('[data-join]').addEventListener('submit', event => {
    event.preventDefault();
    const code = new FormData(event.currentTarget).get('code');
    enter(() => joinLobby(code, { gameSlug:GAME }));
  });
}

async function enter(open) {
  const profile = await requireProfile({ subtitle:'Choisis ton profil pour jouer.' });
  if (!profile) return renderHome('Un profil est nécessaire pour jouer.');
  try {
    lobby = await open();
  } catch (error) {
    return renderHome(error.message);
  }
  history.replaceState(null, '', `?code=${lobby.code}`);
  codeBadge.textContent = lobby.code;
  codeBadge.hidden = false;
  lobby.subscribe(render);
  addEventListener('pagehide', () => { void lobby?.leave(); }, { once:true });
}

/* ─── Rendu selon l'état du lobby ─── */

function render(data) {
  if (!data) {
    lobby = null;
    history.replaceState(null, '', location.pathname);
    return renderHome('Le lobby a été fermé.');
  }
  const players = lobby.players;
  if (lobby.isHost) driveHost(data, players);
  if (data.status === 'waiting') return renderWaiting(data, players);
  if (data.status === 'ended') return renderEnd(data, players);
  renderRound(data, players);
}

function renderWaiting(data, players) {
  const canStart = lobby.isHost && (players.length >= MIN_PLAYERS || isLocal);
  const link = `${location.origin}${location.pathname}?code=${lobby.code}`;
  app.innerHTML = `<section class="panel card">
    <div><h1>Salle d’attente</h1><p>Partage le code <strong>${escapeHTML(lobby.code)}</strong> ou le lien de la partie.</p></div>
    ${playersMarkup(data, players)}
    <div class="row">
      <button class="btn" data-copy>Copier le lien</button>
      ${lobby.isHost
        ? `<button class="btn btn-primary" data-start ${canStart ? '' : 'disabled'}>Lancer (${players.length} joueur${players.length > 1 ? 's' : ''})</button>`
        : '<p>L’hôte va lancer la partie…</p>'}
    </div>
    ${lobby.isHost && !canStart ? `<p>Il faut au moins ${MIN_PLAYERS} joueurs.</p>` : ''}
  </section>`;
  app.querySelector('[data-copy]').addEventListener('click', event => {
    navigator.clipboard?.writeText(link).then(() => { event.target.textContent = 'Lien copié ✓'; });
  });
  app.querySelector('[data-start]')?.addEventListener('click', () => {
    lobby.start({ round:1, phase:'wait', clicks:null, scores:{}, last:null });
  });
}

function renderRound(data, players) {
  const state = data.state || {};
  const mine = state.clicks?.[lobby.me.id];
  if (state.phase === 'go' && goSeen.round !== state.round) goSeen = { round:state.round, at:performance.now() };
  let label = 'Attends le vert…';
  let detail = 'Ne clique pas encore';
  let phase = state.phase;
  if (mine?.early) { label = 'Trop tôt !'; detail = 'Manche perdue, attends les autres'; phase = 'idle'; }
  else if (mine) { label = `${mine.ms} ms`; detail = 'En attente des autres…'; phase = 'idle'; }
  else if (state.phase === 'go') { label = 'MAINTENANT !'; detail = 'Clique !'; }
  if (state.phase === 'result') {
    const names = Object.fromEntries(players.map(player => [player.id, player.name]));
    const ranking = state.last?.ranking || [];
    app.innerHTML = `<section class="panel card">
      <span class="round">Manche ${state.round} / ${ROUNDS}</span>
      <h1>${state.last?.winner ? `${escapeHTML(names[state.last.winner] || '?')} gagne la manche` : 'Personne ne marque'}</h1>
      <ol class="results">${ranking.map(entry => `<li class="${entry.id === state.last?.winner ? 'is-winner' : ''}"><span>${escapeHTML(names[entry.id] || entry.id)}</span><span>${Number.isFinite(entry.ms) ? `${entry.ms} ms` : escapeHTML(entry.note)}</span></li>`).join('')}</ol>
      ${playersMarkup(data, players)}
    </section>`;
    return;
  }
  app.innerHTML = `<section class="panel">
    <span class="round">Manche ${state.round} / ${ROUNDS}</span>
    <button class="arena" data-phase="${phase}" data-arena>${label}<small>${detail}</small></button>
    ${playersMarkup(data, players)}
  </section>`;
  app.querySelector('[data-arena]').addEventListener('pointerdown', () => {
    if (mine) return;
    const click = state.phase === 'go'
      ? { ms:Math.round(performance.now() - goSeen.at) }
      : { early:true };
    void lobby.setState({ [`clicks/${lobby.me.id}`]:click });
  });
}

function renderEnd(data, players) {
  const scores = data.state?.scores || {};
  const ranked = [...players].sort((left, right) => (scores[right.id] || 0) - (scores[left.id] || 0));
  app.innerHTML = `<section class="panel card">
    <span class="round">Fin de partie</span>
    <h1>🏆 ${escapeHTML(ranked[0]?.name || '?')}</h1>
    <ol class="results">${ranked.map((player, index) => `<li class="${index === 0 ? 'is-winner' : ''}"><span>${escapeHTML(player.name)}</span><span>${scores[player.id] || 0} pt</span></li>`).join('')}</ol>
    <div class="row">
      ${lobby.isHost ? '<button class="btn btn-primary" data-again>Rejouer</button>' : '<p>L’hôte peut relancer une partie.</p>'}
      <button class="btn" data-leave>Quitter</button>
    </div>
  </section>`;
  app.querySelector('[data-again]')?.addEventListener('click', () => {
    lobby.start({ round:1, phase:'wait', clicks:null, scores:{}, last:null });
  });
  app.querySelector('[data-leave]').addEventListener('click', async () => {
    await lobby.leave();
    lobby = null;
    history.replaceState(null, '', location.pathname);
    renderHome();
  });
}

/* ─── Logique de l'hôte : c'est lui qui fait avancer la partie ─── */

function schedule(task, delay, action) {
  if (hostTask === task) return;
  hostTask = task;
  clearTimeout(hostTimer);
  hostTimer = setTimeout(action, delay);
}

function driveHost(data, players) {
  if (data.status !== 'playing') { hostTask = ''; clearTimeout(hostTimer); return; }
  const state = data.state || {};
  const ids = players.map(player => player.id);
  const finish = () => {
    // Lu au moment où le minuteur se déclenche : des clics ont pu arriver depuis.
    const latest = lobby?.data?.state || state;
    if (latest.round !== state.round || latest.phase === 'result') return;
    const result = resolveRound(latest.clicks || {}, lobby.players.map(player => player.id));
    const scores = { ...(latest.scores || {}) };
    if (result.winner) scores[result.winner] = (scores[result.winner] || 0) + 1;
    void lobby.setState({ phase:'result', scores, last:result });
  };
  if (state.phase === 'wait') {
    // Tout le monde est parti trop tôt : inutile d'attendre le vert.
    if (everyoneAnswered(state.clicks || {}, ids)) return schedule(`${state.round}:early`, 400, finish);
    schedule(`${state.round}:wait`, randomDelay(), () => lobby.setState({ phase:'go' }));
  } else if (state.phase === 'go') {
    if (everyoneAnswered(state.clicks || {}, ids)) schedule(`${state.round}:done`, 300, finish);
    else schedule(`${state.round}:go`, 3_000, finish);
  } else if (state.phase === 'result') {
    schedule(`${state.round}:result`, 2_800, () => {
      if (state.round >= ROUNDS) void lobby.update({ status:'ended' });
      else void lobby.setState({ round:state.round + 1, phase:'wait', clicks:null, last:null });
    });
  }
}

renderHome();
