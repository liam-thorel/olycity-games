/**
 * Écrans communs à tous les jeux à lobby : accueil (créer / rejoindre),
 * salle d'attente, fermeture du lobby. Le jeu ne s'occupe que de la partie.
 *
 *   import { mountLobbyGame } from '/sdk/lobby-ui.mjs';
 *   mountLobbyGame({
 *     slug:'mon-jeu', title:'Mon jeu', intro:'Le principe en une phrase.',
 *     minPlayers:2,
 *     options:[{ key:'mode', label:'Mode', default:'a', choices:[      // réglages choisis par l'hôte
 *       { value:'a', label:'Mode A', hint:'…' }, { value:'b', label:'Mode B', hint:'…' },
 *     ] }],                                     // lus ensuite dans lobby.data.settings
 *     initialState:(players, lobby) => ({ manche:1 }),   // au lancement et à « Rejouer »
 *     render(data, lobby, ui) { … },            // status 'playing' ou 'ended'
 *   });
 *
 * Le HTML du jeu doit contenir <main id="app"> et, facultatif,
 * <span id="lobby-code" hidden> dans sa barre du haut.
 */
import { createLobby, escapeHTML, joinLobby, normalizeLobbyCode, requireProfile } from './olycity.mjs';

export function avatarMarkup(player) {
  return player?.avatar
    ? `<img src="${escapeHTML(player.avatar)}" alt="">`
    : `<span class="initial">${escapeHTML(String(player?.name || '?').slice(0, 1))}</span>`;
}

/** Liste des joueurs ; `extra(player)` ajoute un contenu à droite (score, ✓…). */
export function playersMarkup(data, players, extra = () => '') {
  return `<div class="players">${players.map(player => `<div class="player${player.id === data?.hostId ? ' is-host' : ''}">
    ${avatarMarkup(player)}<strong>${escapeHTML(player.name)}</strong>${extra(player) || ''}
  </div>`).join('')}</div>`;
}

export function mountLobbyGame({
  slug, title, intro = '', minPlayers = 2, settings = {}, options = [],
  initialState = () => ({}), render,
  app = document.getElementById('app'),
  codeBadge = document.getElementById('lobby-code'),
}) {
  const isLocal = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  let lobby = null;
  const defaults = Object.fromEntries(options.map(option => [option.key, option.default ?? option.choices[0]?.value]));

  const ui = {
    get lobby() { return lobby; },
    /** Relance une partie avec les joueurs présents (hôte). */
    restart:() => lobby.start(initialState(lobby.players, lobby)),
    /** Revient à la salle d'attente pour changer les réglages (hôte). */
    backToLobby:() => lobby.update({ status:'waiting', state:null }),
    async leave() {
      await lobby?.leave();
      lobby = null;
      history.replaceState(null, '', location.pathname);
      renderHome();
    },
  };

  function renderHome(error = '') {
    if (codeBadge) codeBadge.hidden = true;
    const prefill = normalizeLobbyCode(new URLSearchParams(location.search).get('code'));
    app.innerHTML = `<section class="panel card">
      <div><h1>${escapeHTML(title)}</h1><p>${escapeHTML(intro)}</p></div>
      <button class="btn btn-primary" data-create>Créer une partie</button>
      <form class="row" data-join>
        <input class="input code-input" name="code" maxlength="6" placeholder="CODE" value="${escapeHTML(prefill)}" aria-label="Code du lobby" autocomplete="off">
        <button class="btn" type="submit">Rejoindre</button>
      </form>
      <p class="error">${escapeHTML(error)}</p>
    </section>`;
    app.querySelector('[data-create]').addEventListener('click', () => enter(() => createLobby(slug, { settings:{ ...defaults, ...settings } })));
    app.querySelector('[data-join]').addEventListener('submit', event => {
      event.preventDefault();
      const code = new FormData(event.currentTarget).get('code');
      enter(() => joinLobby(code, { gameSlug:slug }));
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
    if (codeBadge) { codeBadge.textContent = lobby.code; codeBadge.hidden = false; }
    lobby.subscribe(onChange);
    addEventListener('pagehide', () => { void lobby?.leave({ keepalive:true }); }, { once:true });
  }

  function onChange(data) {
    if (!data) {
      lobby = null;
      history.replaceState(null, '', location.pathname);
      return renderHome('Le lobby a été fermé.');
    }
    if (data.status === 'waiting') return renderWaiting(data);
    render(data, lobby, ui);
  }

  function renderWaiting(data) {
    const players = lobby.players;
    const canStart = lobby.isHost && (players.length >= minPlayers || isLocal);
    const link = `${location.origin}${location.pathname}?code=${lobby.code}`;
    app.innerHTML = `<section class="panel card">
      <div><h1>Salle d’attente</h1><p>Partage le code <strong>${escapeHTML(lobby.code)}</strong> ou le lien de la partie.</p></div>
      ${playersMarkup(data, players)}
      ${optionsMarkup(data)}
      <div class="row">
        <button class="btn" data-copy>Copier le lien</button>
        ${lobby.isHost
          ? `<button class="btn btn-primary" data-start ${canStart ? '' : 'disabled'}>Lancer (${players.length} joueur${players.length > 1 ? 's' : ''})</button>`
          : '<p>L’hôte va lancer la partie…</p>'}
      </div>
      ${lobby.isHost && !canStart ? `<p>Il faut au moins ${minPlayers} joueurs.</p>` : ''}
    </section>`;
    app.querySelector('[data-copy]').addEventListener('click', event => {
      navigator.clipboard?.writeText(link).then(() => { event.target.textContent = 'Lien copié ✓'; });
    });
    app.querySelector('[data-start]')?.addEventListener('click', ui.restart);
    app.querySelectorAll('[data-option]').forEach(button => button.addEventListener('click', () => {
      void lobby.update({ [`settings/${button.dataset.option}`]:button.dataset.value });
    }));
  }

  function optionsMarkup(data) {
    return options.map(option => {
      const current = data.settings?.[option.key] ?? defaults[option.key];
      return `<fieldset class="lobby-option"><legend>${escapeHTML(option.label)}</legend><div class="lobby-choices">
        ${option.choices.map(choice => `<button type="button" class="lobby-choice${choice.value === current ? ' is-active' : ''}"
          ${lobby.isHost ? `data-option="${escapeHTML(option.key)}" data-value="${escapeHTML(choice.value)}"` : 'disabled'} aria-pressed="${choice.value === current}">
          <strong>${escapeHTML(choice.label)}</strong>${choice.hint ? `<small>${escapeHTML(choice.hint)}</small>` : ''}
        </button>`).join('')}
      </div></fieldset>`;
    }).join('');
  }

  renderHome();
  return ui;
}
