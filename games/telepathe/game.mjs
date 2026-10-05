import { escapeHTML } from '/sdk/olycity.mjs';
import { avatarMarkup, mountLobbyGame, playersMarkup } from '/sdk/lobby-ui.mjs';
import {
  BANDS, CARDS, MIN_PLAYERS, allGuessed, angleToValue, drawCard, pickTarget, psychicFor, scoreRound, valueToAngle,
} from './rules.mjs';

const app = document.getElementById('app');
const NEEDLE_COLORS = ['#3fcfcf', '#a87fff', '#f5c842', '#4bd07b', '#ff8fb1', '#7fb2ff', '#ffb35c', '#e2e5ee'];
const BAND_COLORS = { 4:'#ff4656', 3:'#ff8a5c', 2:'#f5c842' };

let lobby = null;
let ui = null;
let needle = { round:0, value:50 };
let viewKey = '';
let hostTask = '';

/* ─── Cadran ─── */

const point = (value, radius = 90) => {
  const angle = valueToAngle(value);
  return [100 + radius * Math.cos(angle), 100 - radius * Math.sin(angle)].map(n => n.toFixed(2)).join(',');
};

function wedge(from, to, color) {
  const a = Math.max(0, from);
  const b = Math.min(100, to);
  return `<path d="M100,100 L${point(a)} A90,90 0 0 1 ${point(b)} Z" fill="${color}"/>`;
}

function needleMarkup(value, color, label = '', id = '') {
  const [x, y] = point(value, 80).split(',');
  return `<g class="needle" ${id ? `data-needle="${id}"` : ''} style="--needle:${color}">
    <line x1="100" y1="100" x2="${x}" y2="${y}"/>
    <circle cx="${x}" cy="${y}" r="7"/>
    ${label ? `<text x="${x}" y="${Number(y) + 3.5}">${escapeHTML(label)}</text>` : ''}
  </g>`;
}

function dialMarkup({ target = null, needles = [], interactive = false, reveal = false }) {
  const bands = target === null ? '' : `<g class="bands${reveal ? ' is-reveal' : ''}">${[...BANDS].reverse()
    .map(band => wedge(target - band.half, target + band.half, BAND_COLORS[band.points])).join('')}
    ${[...BANDS].reverse().map(band => {
      const [x, y] = point(target, 62 - band.points * 6).split(',');
      return band.points === 4 ? `<text class="band-label" x="${x}" y="${y}">4</text>` : '';
    }).join('')}</g>`;
  return `<svg class="dial${interactive ? ' is-interactive' : ''}" viewBox="0 0 200 106" data-dial role="${interactive ? 'slider' : 'img'}"
      ${interactive ? `aria-label="Aiguille" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${needle.value}" tabindex="0"` : 'aria-hidden="true"'}>
    <path class="dial-face" d="M10,100 A90,90 0 0 1 190,100 Z"/>
    ${bands}
    <path class="dial-rim" d="M10,100 A90,90 0 0 1 190,100"/>
    ${needles.join('')}
    <circle class="dial-hub" cx="100" cy="100" r="9"/>
  </svg>`;
}

function cardMarkup(card) {
  const [left, right] = CARDS[card] || ['?', '?'];
  return `<div class="spectrum"><span>← ${escapeHTML(left)}</span><span>${escapeHTML(right)} →</span></div>`;
}

function bindDial(onChange) {
  const svg = app.querySelector('[data-dial].is-interactive');
  if (!svg) return;
  const update = event => {
    const matrix = svg.getScreenCTM()?.inverse();
    if (!matrix) return;
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix);
    let angle = Math.atan2(100 - p.y, p.x - 100);
    if (angle < 0) angle = p.x < 100 ? Math.PI : 0;
    needle.value = angleToValue(angle);
    const [x, y] = point(needle.value, 80).split(',');
    const group = svg.querySelector('[data-needle="me"]');
    group.querySelector('line').setAttribute('x2', x);
    group.querySelector('line').setAttribute('y2', y);
    group.querySelector('circle').setAttribute('cx', x);
    group.querySelector('circle').setAttribute('cy', y);
    svg.setAttribute('aria-valuenow', String(needle.value));
    onChange?.();
  };
  let dragging = false;
  svg.addEventListener('pointerdown', event => {
    dragging = true;
    try { svg.setPointerCapture(event.pointerId); } catch { /* pointeur déjà relâché */ }
    update(event);
  });
  svg.addEventListener('pointermove', event => { if (dragging) update(event); });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(type => svg.addEventListener(type, () => { dragging = false; }));
  svg.addEventListener('keydown', event => {
    const step = event.shiftKey ? 5 : 1;
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    needle.value = Math.max(0, Math.min(100, needle.value + (event.key === 'ArrowRight' ? step : -step)));
    viewKey = '';
    render(lobby.data, lobby, ui);
    app.querySelector('[data-dial]')?.focus();
  });
}

/* ─── Rendu ─── */

const scoreOf = data => player => `<small>${data.state?.scores?.[player.id] || 0}</small>`;

function render(data, current, nextUi) {
  lobby = current;
  ui = nextUi;
  const players = lobby.players;
  const state = data.state || {};
  if (lobby.isHost) driveHost(data, players);
  if (data.status === 'ended') return renderEnd(data, players);
  if (needle.round !== state.round) needle = { round:state.round, value:50 };

  const psychic = players.find(player => player.id === state.psychic);
  const isPsychic = state.psychic === lobby.me.id;
  const guessed = Number.isFinite(state.guesses?.[lobby.me.id]);
  const key = `${state.round}:${state.phase}:${isPsychic}:${guessed}:${state.card}:${state.clue || ''}`;
  const status = statusMarkup(data, players, state);
  if (key === viewKey && app.querySelector('[data-status]')) {
    app.querySelector('[data-status]').innerHTML = status;
    bindHostButtons(state, players);
    return;
  }
  viewKey = key;

  const header = `<div class="round-head"><span class="round">Manche ${state.round} / ${state.rounds}</span>
    <span class="psychic">${avatarMarkup(psychic)} <span>${isPsychic ? 'Tu es le médium' : `Médium : <strong>${escapeHTML(psychic?.name || '?')}</strong>`}</span></span></div>`;
  let body = '';

  if (state.phase === 'clue') {
    body = isPsychic
      ? `${cardMarkup(state.card)}
        ${dialMarkup({ target:state.target })}
        <p class="hint">Toi seul vois la cible. Donne un indice qui la place sur ce spectre.</p>
        <form class="row" data-clue>
          <input class="input" name="clue" maxlength="60" placeholder="Ton indice…" required autocomplete="off" aria-label="Indice">
          <button class="btn btn-primary" type="submit">Envoyer</button>
        </form>
        <button class="btn" data-redraw type="button">Changer de carte</button>`
      : `${cardMarkup(state.card)}
        ${dialMarkup({})}
        <p class="hint">${escapeHTML(psychic?.name || 'Le médium')} cherche un indice…</p>`;
  } else if (state.phase === 'guess') {
    const clue = `<p class="clue">« ${escapeHTML(state.clue)} »</p>`;
    if (isPsychic) {
      body = `${cardMarkup(state.card)}${clue}${dialMarkup({ target:state.target })}<p class="hint">Les autres placent leur aiguille…</p>`;
    } else if (guessed) {
      body = `${cardMarkup(state.card)}${clue}${dialMarkup({ needles:[needleMarkup(state.guesses[lobby.me.id], '#3fcfcf')] })}<p class="hint">Aiguille verrouillée. On attend les autres…</p>`;
    } else {
      body = `${cardMarkup(state.card)}${clue}
        ${dialMarkup({ interactive:true, needles:[needleMarkup(needle.value, '#3fcfcf', '', 'me')] })}
        <p class="hint">Fais glisser l’aiguille, puis valide.</p>
        <button class="btn btn-primary" data-lock type="button">Valider ma réponse</button>`;
    }
  } else if (state.phase === 'reveal') {
    const guessers = players.filter(player => player.id !== state.psychic);
    const needles = guessers.filter(player => Number.isFinite(state.guesses?.[player.id]))
      .map((player, index) => needleMarkup(state.guesses[player.id], NEEDLE_COLORS[index % NEEDLE_COLORS.length], player.name.slice(0, 1).toUpperCase()));
    const points = state.last?.points || {};
    body = `${cardMarkup(state.card)}<p class="clue">« ${escapeHTML(state.clue)} »</p>
      ${dialMarkup({ target:state.target, needles, reveal:true })}
      <ol class="results">${[...players].sort((a, b) => (points[b.id] || 0) - (points[a.id] || 0)).map(player => `<li>
        <span>${escapeHTML(player.name)}${player.id === state.psychic ? ' · médium' : ''}</span><span>+${points[player.id] || 0}</span></li>`).join('')}</ol>`;
  }

  app.innerHTML = `<section class="panel">${header}${body}<div data-status>${status}</div></section>`;
  bindPhase(state);
  bindHostButtons(state, players);
}

function statusMarkup(data, players, state) {
  const check = player => {
    if (player.id === state.psychic) return '<small>🔮</small>';
    if (state.phase === 'guess') return Number.isFinite(state.guesses?.[player.id]) ? '<small>✓</small>' : '<small>…</small>';
    return scoreOf(data)(player);
  };
  let hostControls = '';
  if (lobby.isHost && state.phase === 'guess') hostControls = '<button class="btn" data-force-reveal type="button">Révéler maintenant</button>';
  if (lobby.isHost && state.phase === 'reveal') {
    hostControls = `<button class="btn btn-primary" data-next type="button">${state.round >= state.rounds ? 'Voir le classement' : 'Manche suivante'}</button>`;
  }
  return `${playersMarkup(data, players, check)}${hostControls ? `<div class="row host-row">${hostControls}</div>` : ''}`;
}

function bindPhase(state) {
  app.querySelector('[data-clue]')?.addEventListener('submit', event => {
    event.preventDefault();
    const clue = String(new FormData(event.currentTarget).get('clue') || '').trim().slice(0, 60);
    if (clue) void lobby.setState({ clue, phase:'guess', guesses:null });
  });
  app.querySelector('[data-redraw]')?.addEventListener('click', () => {
    const used = Array.isArray(state.used) ? state.used : [];
    const card = drawCard(used);
    void lobby.setState({ card, used:[...used, card] });
  });
  bindDial();
  app.querySelector('[data-lock]')?.addEventListener('click', event => {
    event.currentTarget.disabled = true;
    void lobby.setState({ [`guesses/${lobby.me.id}`]:needle.value });
  });
}

function bindHostButtons(state, players) {
  app.querySelector('[data-force-reveal]')?.addEventListener('click', () => reveal(state, players), { once:true });
  app.querySelector('[data-next]')?.addEventListener('click', event => {
    event.currentTarget.disabled = true;
    nextRound(state, players);
  }, { once:true });
}

function renderEnd(data, players) {
  viewKey = '';
  const scores = data.state?.scores || {};
  const ranked = [...players].sort((left, right) => (scores[right.id] || 0) - (scores[left.id] || 0));
  const best = scores[ranked[0]?.id] || 0;
  const winners = ranked.filter(player => (scores[player.id] || 0) === best);
  app.innerHTML = `<section class="panel card">
    <span class="round">Fin de partie</span>
    <h1>🔮 ${winners.length > 1 ? `Égalité : ${escapeHTML(winners.map(player => player.name).join(', '))}` : escapeHTML(ranked[0]?.name || '?')}</h1>
    <ol class="results">${ranked.map(player => `<li class="${(scores[player.id] || 0) === best ? 'is-winner' : ''}"><span>${escapeHTML(player.name)}</span><span>${scores[player.id] || 0} pt</span></li>`).join('')}</ol>
    <div class="row">
      ${lobby.isHost ? '<button class="btn btn-primary" data-again>Rejouer</button>' : '<p>L’hôte peut relancer une partie.</p>'}
      <button class="btn" data-leave>Quitter</button>
    </div>
  </section>`;
  app.querySelector('[data-again]')?.addEventListener('click', ui.restart);
  app.querySelector('[data-leave]').addEventListener('click', ui.leave);
}

/* ─── Hôte : révélation et enchaînement des manches ─── */

function reveal(state, players) {
  const latest = lobby.data?.state || state;
  if (latest.round !== state.round || latest.phase !== 'guess') return;
  const guesserIds = players.map(player => player.id).filter(id => id !== latest.psychic);
  const points = scoreRound({ target:latest.target, guesses:latest.guesses || {}, psychic:latest.psychic, guesserIds });
  const scores = { ...(latest.scores || {}) };
  Object.entries(points).forEach(([id, value]) => { scores[id] = (scores[id] || 0) + value; });
  void lobby.setState({ phase:'reveal', scores, last:{ points } });
}

function nextRound(state, players) {
  if (state.round >= state.rounds) return void lobby.update({ status:'ended' });
  const used = Array.isArray(state.used) ? state.used : [];
  const card = drawCard(used);
  const round = state.round + 1;
  void lobby.setState({
    round, phase:'clue', psychic:psychicFor(round, state.order, players.map(player => player.id)),
    card, used:[...used, card], target:pickTarget(), clue:null, guesses:null, last:null,
  });
}

function driveHost(data, players) {
  if (data.status !== 'playing') { hostTask = ''; return; }
  const state = data.state || {};
  const ids = players.map(player => player.id);
  // Le médium a quitté la partie : on lui trouve un remplaçant.
  if (state.phase === 'clue' && !ids.includes(state.psychic)) {
    const task = `${state.round}:psychic`;
    if (hostTask !== task) {
      hostTask = task;
      void lobby.setState({ psychic:psychicFor(state.round, state.order, ids) });
    }
    return;
  }
  const guesserIds = ids.filter(id => id !== state.psychic);
  if (state.phase === 'guess' && allGuessed(state.guesses || {}, guesserIds)) {
    const task = `${state.round}:reveal`;
    if (hostTask !== task) {
      hostTask = task;
      setTimeout(() => reveal(state, lobby.players), 500);
    }
  }
}

mountLobbyGame({
  slug:'telepathe',
  title:'Télépathe',
  intro:'Chaque manche, un médium voit où se cache la cible sur un spectre et donne un indice. Les autres placent leur aiguille : plus on tombe près, plus on marque.',
  minPlayers:MIN_PLAYERS,
  initialState:players => {
    const order = players.map(player => player.id);
    const card = drawCard([]);
    return {
      round:1, rounds:Math.max(4, order.length), order, psychic:order[0],
      phase:'clue', card, used:[card], target:pickTarget(),
    };
  },
  render,
});
