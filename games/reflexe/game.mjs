import { escapeHTML } from '/sdk/olycity.mjs';
import { mountLobbyGame, playersMarkup } from '/sdk/lobby-ui.mjs';
import { MIN_PLAYERS, ROUNDS, everyoneAnswered, randomDelay, resolveRound } from './rules.mjs';

const app = document.getElementById('app');

let lobby = null;
let goSeen = { round:0, at:0 };
let hostTask = '';
let hostTimer = null;

// Firebase ne garde pas un objet vide : `scores` est absent tant que personne n'a marqué.
const scoreOf = data => player => `<small>${data.state?.scores?.[player.id] || 0}</small>`;

function render(data, current, ui) {
  lobby = current;
  const players = lobby.players;
  if (lobby.isHost) driveHost(data, players);
  if (data.status === 'ended') return renderEnd(data, players, ui);
  renderRound(data, players);
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
      ${playersMarkup(data, players, scoreOf(data))}
    </section>`;
    return;
  }
  app.innerHTML = `<section class="panel">
    <span class="round">Manche ${state.round} / ${ROUNDS}</span>
    <button class="arena" data-phase="${phase}" data-arena>${label}<small>${detail}</small></button>
    ${playersMarkup(data, players, scoreOf(data))}
  </section>`;
  app.querySelector('[data-arena]').addEventListener('pointerdown', () => {
    if (mine) return;
    const click = state.phase === 'go'
      ? { ms:Math.round(performance.now() - goSeen.at) }
      : { early:true };
    void lobby.setState({ [`clicks/${lobby.me.id}`]:click });
  });
}

function renderEnd(data, players, ui) {
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
  app.querySelector('[data-again]')?.addEventListener('click', ui.restart);
  app.querySelector('[data-leave]').addEventListener('click', ui.leave);
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

mountLobbyGame({
  slug:'reflexe',
  title:'Réflexe',
  intro:`Attends le vert, puis clique le plus vite possible. Trop tôt, et la manche est perdue. ${ROUNDS} manches, le meilleur score gagne.`,
  minPlayers:MIN_PLAYERS,
  settings:{ rounds:ROUNDS },
  initialState:() => ({ round:1, phase:'wait', scores:{} }),
  render,
});
