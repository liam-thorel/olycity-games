import { escapeHTML } from '/sdk/olycity.mjs';
import { avatarMarkup, mountLobbyGame, playersMarkup } from '/sdk/lobby-ui.mjs';
import {
  CARDS, MIN_PLAYERS, MODES, allGuessed, angleToValue, cardSpectrum, drawCard, normalizeSpectrum,
  pickTarget, psychicFor, scoreRound, valueToAngle,
} from './rules.mjs';

const app = document.getElementById('app');
const NEEDLE_COLORS = ['#1d2340', '#6a3df0', '#0b7fb3', '#0f8a5a', '#b0287f', '#7a5200', '#3d4458', '#c2410c'];

let lobby = null;
let ui = null;
let needle = { round:0, value:50 };
let viewKey = '';
let spunRound = 0;
let hostTask = '';

/* ─── Cadran ───
   Repère SVG : pivot en (100,100), face de rayon 90. Valeur 0 à gauche, 100 à droite. */

const R = 90;
const point = (value, radius = R) => {
  const angle = valueToAngle(value);
  return [100 + radius * Math.cos(angle), 100 - radius * Math.sin(angle)].map(n => n.toFixed(2)).join(',');
};
const needleRotation = value => ((value - 50) * 1.8).toFixed(2);
const FACE = `M${100 - R},100 A${R},${R} 0 0 1 ${100 + R},100 Z`;

// Étoiles du cache, toujours aux mêmes endroits (générateur pseudo-aléatoire fixe).
const STARS = (() => {
  let seed = 7;
  const next = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  return Array.from({ length:70 }, () => {
    const radius = 14 + Math.sqrt(next()) * 72;
    const angle = next() * Math.PI;
    return { x:(100 + radius * Math.cos(angle)).toFixed(1), y:(100 - radius * Math.sin(angle)).toFixed(1), r:(0.35 + next() * 0.9).toFixed(2), o:(0.35 + next() * 0.65).toFixed(2) };
  });
})();

function wedge(from, to, className) {
  const a = Math.max(0, from);
  const b = Math.min(100, to);
  if (b <= a) return '';
  return `<path class="${className}" d="M100,100 L${point(a)} A${R},${R} 0 0 1 ${point(b)} Z"/>`;
}

function bandsMarkup(target) {
  // Cinq bandes côte à côte : 2 · 3 · 4 · 3 · 2.
  const edges = [-12.5, -7.5, -2.5, 2.5, 7.5, 12.5].map(offset => target + offset);
  const points = [2, 3, 4, 3, 2];
  return points.map((value, index) => {
    const mid = (edges[index] + edges[index + 1]) / 2;
    const [x, y] = point(mid, 70).split(',');
    const label = mid > 0 && mid < 100 ? `<text class="band-label" x="${x}" y="${y}" transform="rotate(${needleRotation(mid)} ${x} ${y})">${value}</text>` : '';
    return `${wedge(edges[index], edges[index + 1], `band band-${value}`)}${label}`;
  }).join('');
}

function needleMarkup(value, color, label = '', id = '') {
  const badge = label ? (() => {
    const [x, y] = point(value, 58).split(',');
    return `<g class="needle-badge" style="--needle:${color}"><circle cx="${x}" cy="${y}" r="6.5"/><text x="${x}" y="${(Number(y) + 2.6).toFixed(2)}">${escapeHTML(label)}</text></g>`;
  })() : '';
  return `<g class="needle" ${id ? `data-needle="${id}"` : ''} style="--needle:${color}" transform="rotate(${needleRotation(value)} 100 100)">
    <path class="needle-shadow" d="M96.4,101 L100,16 L103.6,101 Z" transform="translate(1.2 1.6)"/>
    <path class="needle-body" d="M96.4,101 L100,16 L103.6,101 Z"/>
    <circle class="needle-tip" cx="100" cy="17" r="2.6"/>
  </g>${badge}`;
}

/**
 * `shutter` : 'closed' (cache étoilé, les devineurs ne voient rien),
 * 'opening' (le cache s'ouvre à la révélation) ou rien (le médium).
 */
function dialMarkup({ target = null, needles = [], interactive = false, spin = false, shutter = '' }) {
  // La roue part d'un angle au hasard et freine jusqu'à la cible.
  const spinFrom = spin ? ` style="--spin-from:${(Math.random() < 0.5 ? -1 : 1) * (540 + Math.round(Math.random() * 360))}deg"` : '';
  const bands = target === null ? '' : `<g class="bands${spin ? ' is-spinning' : ''}"${spinFrom}>${bandsMarkup(target)}</g>`;
  const ticks = Array.from({ length:21 }, (_, index) => {
    const value = index * 5;
    const major = value % 25 === 0;
    return `<line class="tick${major ? ' is-major' : ''}" x1="${point(value, major ? 80 : 83).split(',')[0]}" y1="${point(value, major ? 80 : 83).split(',')[1]}" x2="${point(value, 87).split(',')[0]}" y2="${point(value, 87).split(',')[1]}"/>`;
  }).join('');
  const scallops = Array.from({ length:33 }, (_, index) => {
    const [x, y] = point(index * (100 / 32), 95.5).split(',');
    return `<circle cx="${x}" cy="${y}" r="4.3"/>`;
  }).join('');
  const shutterMarkup = shutter ? `<g class="shutter${shutter === 'opening' ? ' is-opening' : ''}">
      <path class="shutter-face" d="${FACE}"/>
      ${STARS.map(star => `<circle cx="${star.x}" cy="${star.y}" r="${star.r}" opacity="${star.o}"/>`).join('')}
    </g>` : '';
  return `<svg class="dial${interactive ? ' is-interactive' : ''}" viewBox="-4 -4 208 116" data-dial role="${interactive ? 'slider' : 'img'}"
      ${interactive ? `aria-label="Aiguille" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${needle.value}" tabindex="0"` : 'aria-hidden="true"'}>
    <defs>
      <clipPath id="dial-clip"><path d="${FACE}"/></clipPath>
      <radialGradient id="dial-face-gradient" cx="50%" cy="100%" r="100%">
        <stop offset="0" stop-color="#c9f5e6"/><stop offset=".55" stop-color="#9fe3cd"/><stop offset="1" stop-color="#6fc9b0"/>
      </radialGradient>
      <radialGradient id="dial-shutter-gradient" cx="50%" cy="100%" r="100%">
        <stop offset="0" stop-color="#2b3350"/><stop offset="1" stop-color="#0d1020"/>
      </radialGradient>
      <radialGradient id="dial-hub-gradient" cx="35%" cy="30%" r="80%">
        <stop offset="0" stop-color="#ffffff"/><stop offset=".6" stop-color="#d9dde8"/><stop offset="1" stop-color="#9aa1b5"/>
      </radialGradient>
    </defs>
    <g class="dial-scallops">${scallops}</g>
    <path class="dial-rim" d="M${100 - R - 3},100 A${R + 3},${R + 3} 0 0 1 ${100 + R + 3},100 Z"/>
    <path class="dial-face" d="${FACE}"/>
    <g clip-path="url(#dial-clip)">${bands}${shutterMarkup}</g>
    <g class="ticks">${ticks}</g>
    ${needles.join('')}
    <rect class="dial-base" x="-2" y="100" width="204" height="9" rx="3"/>
    <circle class="dial-hub" cx="100" cy="100" r="10"/>
    <circle class="dial-hub-cap" cx="100" cy="100" r="3.4"/>
  </svg>`;
}

function spectrumMarkup(spectrum) {
  if (!spectrum) return '<div class="spectrum is-pending"><span>← ?</span><span>? →</span></div>';
  return `<div class="spectrum"><span>← ${escapeHTML(spectrum.left)}</span><span>${escapeHTML(spectrum.right)} →</span></div>`;
}

const modeOf = data => (data?.settings?.mode === MODES.custom ? MODES.custom : MODES.cards);

/** Thème de départ d'une manche : une carte tirée, ou rien tant que le médium n'a pas écrit le sien. */
function roundTheme(mode, used = []) {
  if (mode === MODES.custom) return { spectrum:null, used };
  const card = drawCard(used);
  return { spectrum:cardSpectrum(card), card, used:[...used, card] };
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
    svg.querySelector('[data-needle="me"]').setAttribute('transform', `rotate(${needleRotation(needle.value)} 100 100)`);
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
  const mode = modeOf(data);
  const key = `${state.round}:${state.phase}:${isPsychic}:${guessed}:${JSON.stringify(state.spectrum || null)}:${state.clue || ''}`;
  const status = statusMarkup(data, players, state);
  if (key === viewKey && app.querySelector('[data-status]')) {
    app.querySelector('[data-status]').innerHTML = status;
    bindHostButtons(state, players);
    return;
  }
  viewKey = key;

  const header = `<div class="round-head"><span class="round">Manche ${state.round} · ${mode === MODES.custom ? 'Nos thèmes' : 'Cartes'}</span>
    <span class="psychic">${avatarMarkup(psychic)} <span>${isPsychic ? 'Tu es le médium' : `Médium : <strong>${escapeHTML(psychic?.name || '?')}</strong>`}</span></span></div>`;
  let body = '';

  if (state.phase === 'theme') {
    // Le thème est choisi AVANT de tirer la cible : impossible de l'adapter à la cible.
    if (isPsychic && mode === MODES.custom) {
      body = `${spectrumMarkup(null)}
        ${dialMarkup({})}
        <p class="hint">Invente un thème avec deux extrémités. La cible sera tirée quand tu feras tourner la roue.</p>
        <form class="theme-form" data-theme>
          <div class="theme-ends">
            <input class="input" name="left" maxlength="40" placeholder="À gauche (ex. Nul)" required autocomplete="off" aria-label="Extrémité gauche">
            <input class="input" name="right" maxlength="40" placeholder="À droite (ex. Génial)" required autocomplete="off" aria-label="Extrémité droite">
          </div>
          <p class="error" data-theme-error></p>
          <div class="row"><button class="btn" data-idea type="button">Une idée ?</button><button class="btn btn-primary" type="submit">Faire tourner la roue</button></div>
        </form>`;
    } else if (isPsychic) {
      body = `${spectrumMarkup(state.spectrum)}
        ${dialMarkup({})}
        <p class="hint">Garde cette carte ou changes-en, puis fais tourner la roue pour tirer la cible.</p>
        <form class="row" data-theme><button class="btn" data-redraw type="button">Changer de carte</button><button class="btn btn-primary" type="submit">Faire tourner la roue</button></form>`;
    } else {
      body = `${spectrumMarkup(mode === MODES.custom ? null : state.spectrum)}
        ${dialMarkup({ shutter:'closed' })}
        <p class="hint">${escapeHTML(psychic?.name || 'Le médium')} choisit le thème…</p>`;
    }
  } else if (state.phase === 'clue') {
    if (isPsychic) {
      const spin = spunRound !== state.round;
      spunRound = state.round;
      body = `${spectrumMarkup(state.spectrum)}
        ${dialMarkup({ target:state.target, spin })}
        <p class="hint">Toi seul vois la cible. Donne un indice qui la place sur ce spectre.</p>
        <form class="row" data-clue><input class="input" name="clue" maxlength="60" placeholder="Ton indice…" required autocomplete="off" aria-label="Indice"><button class="btn btn-primary" type="submit">Envoyer</button></form>`;
    } else {
      body = `${spectrumMarkup(state.spectrum)}
        ${dialMarkup({ shutter:'closed' })}
        <p class="hint">La roue a tourné : ${escapeHTML(psychic?.name || 'le médium')} cherche un indice…</p>`;
    }
  } else if (state.phase === 'guess') {
    const clue = `<p class="clue">« ${escapeHTML(state.clue)} »</p>`;
    if (isPsychic) {
      body = `${spectrumMarkup(state.spectrum)}${clue}${dialMarkup({ target:state.target })}<p class="hint">Les autres placent leur aiguille…</p>`;
    } else if (guessed) {
      body = `${spectrumMarkup(state.spectrum)}${clue}${dialMarkup({ shutter:'closed', needles:[needleMarkup(state.guesses[lobby.me.id], '#ff4656')] })}<p class="hint">Aiguille verrouillée. On attend les autres…</p>`;
    } else {
      body = `${spectrumMarkup(state.spectrum)}${clue}
        ${dialMarkup({ interactive:true, shutter:'closed', needles:[needleMarkup(needle.value, '#ff4656', '', 'me')] })}
        <p class="hint">Fais glisser l’aiguille, puis valide.</p>
        <button class="btn btn-primary" data-lock type="button">Valider ma réponse</button>`;
    }
  } else if (state.phase === 'reveal') {
    const guessers = players.filter(player => player.id !== state.psychic);
    const needles = guessers.filter(player => Number.isFinite(state.guesses?.[player.id]))
      .map((player, index) => needleMarkup(state.guesses[player.id], NEEDLE_COLORS[index % NEEDLE_COLORS.length], player.name.slice(0, 1).toUpperCase()));
    const points = state.last?.points || {};
    body = `${spectrumMarkup(state.spectrum)}<p class="clue">« ${escapeHTML(state.clue)} »</p>
      ${dialMarkup({ target:state.target, needles, shutter:lobby.me.id === state.psychic ? '' : 'opening' })}
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
    hostControls = '<button class="btn" data-finish type="button">Terminer la partie</button><button class="btn btn-primary" data-next type="button">Manche suivante</button>';
  }
  return `${playersMarkup(data, players, check)}${hostControls ? `<div class="row host-row">${hostControls}</div>` : ''}`;
}

function bindPhase(state) {
  // Thème verrouillé : la cible n'est tirée qu'à cet instant.
  app.querySelector('[data-theme]')?.addEventListener('submit', event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    let spectrum = state.spectrum;
    if (form.has('left')) {
      spectrum = normalizeSpectrum(form.get('left'), form.get('right'));
      if (!spectrum) {
        app.querySelector('[data-theme-error]').textContent = 'Il faut deux extrémités différentes.';
        return;
      }
    }
    event.currentTarget.querySelector('[type="submit"]').disabled = true;
    void lobby.setState({ spectrum, target:pickTarget(), phase:'clue' });
  });
  app.querySelector('[data-clue]')?.addEventListener('submit', event => {
    event.preventDefault();
    const clue = String(new FormData(event.currentTarget).get('clue') || '').trim().slice(0, 60);
    if (clue) void lobby.setState({ clue, phase:'guess', guesses:null });
  });
  app.querySelector('[data-redraw]')?.addEventListener('click', () => {
    const used = Array.isArray(state.used) ? state.used : [];
    const card = drawCard(used);
    void lobby.setState({ card, spectrum:cardSpectrum(card), used:[...used, card] });
  });
  // Mode « Nos thèmes » : une carte en guise d'inspiration, modifiable avant l'envoi.
  app.querySelector('[data-idea]')?.addEventListener('click', () => {
    const idea = cardSpectrum(drawCard());
    const form = app.querySelector('[data-theme]');
    form.left.value = idea.left;
    form.right.value = idea.right;
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
  app.querySelector('[data-finish]')?.addEventListener('click', () => {
    if (window.confirm('Terminer la partie et afficher le classement ?')) void lobby.update({ status:'ended' });
  });
}

function renderEnd(data, players) {
  viewKey = '';
  const scores = data.state?.scores || {};
  const ranked = [...players].sort((left, right) => (scores[right.id] || 0) - (scores[left.id] || 0));
  const best = scores[ranked[0]?.id] || 0;
  const winners = ranked.filter(player => (scores[player.id] || 0) === best);
  app.innerHTML = `<section class="panel card">
    <span class="round">Fin de partie · ${data.state?.round || 0} manche${(data.state?.round || 0) > 1 ? 's' : ''}</span>
    <h1>🔮 ${winners.length > 1 ? `Égalité : ${escapeHTML(winners.map(player => player.name).join(', '))}` : escapeHTML(ranked[0]?.name || '?')}</h1>
    <ol class="results">${ranked.map(player => `<li class="${(scores[player.id] || 0) === best ? 'is-winner' : ''}"><span>${escapeHTML(player.name)}</span><span>${scores[player.id] || 0} pt</span></li>`).join('')}</ol>
    <div class="row">
      ${lobby.isHost ? '<button class="btn btn-primary" data-again>Nouvelle partie</button>' : '<p>L’hôte peut relancer une partie.</p>'}
      <button class="btn" data-leave>Quitter</button>
    </div>
  </section>`;
  // Retour à la salle d'attente : on peut y changer de mode avant de relancer.
  app.querySelector('[data-again]')?.addEventListener('click', ui.backToLobby);
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
  const round = state.round + 1;
  const ids = players.map(player => player.id);
  // Un joueur arrivé en cours de partie entre dans la rotation des médiums.
  const order = [...(state.order || []), ...ids.filter(id => !(state.order || []).includes(id))];
  void lobby.setState({
    round, phase:'theme', order, psychic:psychicFor(round, order, ids),
    card:null, ...roundTheme(modeOf(lobby.data), Array.isArray(state.used) ? state.used : []),
    target:null, clue:null, guesses:null, last:null,
  });
}

function driveHost(data, players) {
  if (data.status !== 'playing') { hostTask = ''; return; }
  const state = data.state || {};
  const ids = players.map(player => player.id);
  // Le médium a quitté la partie : on lui trouve un remplaçant.
  if (['theme', 'clue'].includes(state.phase) && !ids.includes(state.psychic)) {
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
  title:'Lost in Translation',
  intro:'Chaque manche, un médium choisit un thème, fait tourner la roue, puis voit seul où se cache la cible et donne un indice. Les autres placent leur aiguille : plus on tombe près, plus on marque. On joue autant de manches qu’on veut.',
  minPlayers:MIN_PLAYERS,
  options:[{
    key:'mode', label:'Mode de jeu', default:MODES.cards,
    choices:[
      { value:MODES.cards, label:'Cartes', hint:`${CARDS.length} spectres tout prêts, le médium peut changer de carte.` },
      { value:MODES.custom, label:'Nos thèmes', hint:'Le médium invente lui-même les deux extrémités du spectre.' },
    ],
  }],
  initialState:(players, lobby) => {
    const order = players.map(player => player.id);
    return {
      round:1, order, psychic:order[0], phase:'theme',
      ...roundTheme(modeOf(lobby.data), []),
    };
  },
  render,
});
