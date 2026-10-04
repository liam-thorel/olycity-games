import { escapeHTML } from '../sdk/olycity.mjs';

export const GAME_STATUSES = {
  live:{ label:'Jouable', playable:true },
  beta:{ label:'Bêta', playable:true },
  soon:{ label:'Bientôt', playable:false },
  // Visible seulement en local ou avec ?dev : un jeu en chantier peut être
  // déployé sans apparaître sur le portail.
  dev:{ label:'En dev', playable:true, hidden:true },
};

export function isDevMode(location = globalThis.location) {
  if (!location) return false;
  return /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) || new URLSearchParams(location.search).has('dev');
}

export function visibleGames(registry = [], { dev = false } = {}) {
  return registry.filter(game => GAME_STATUSES[game.status] && (dev || !GAME_STATUSES[game.status].hidden));
}

function playerLabel([min = 1, max = min] = []) {
  return min === max ? `${min} joueur${min > 1 ? 's' : ''}` : `${min}–${max} joueurs`;
}

export function gameCard(game) {
  const status = GAME_STATUSES[game.status];
  const accent = /^#[0-9a-f]{3,8}$/i.test(game.accent || '') ? game.accent : '#3fcfcf';
  const tag = status.playable ? 'a' : 'div';
  const href = status.playable ? ` href="games/${encodeURIComponent(game.slug)}/"` : ' aria-disabled="true"';
  return `<${tag} class="game-card is-${escapeHTML(game.status)}"${href} style="--accent:${accent}">
    <div class="game-card-art" aria-hidden="true"><span>${escapeHTML(game.name.slice(0, 1))}</span></div>
    <div class="game-card-body">
      <div class="game-card-top"><h3>${escapeHTML(game.name)}</h3><span class="badge" data-state="${escapeHTML(game.status)}">${status.label}</span></div>
      <p>${escapeHTML(game.tagline)}</p>
      <div class="tags"><span>${playerLabel(game.players)}</span>${(game.tags || []).map(item => `<span>${escapeHTML(item)}</span>`).join('')}</div>
    </div>
  </${tag}>`;
}

export async function renderRegistry(root) {
  if (!root) return;
  try {
    const response = await fetch('games/registry.json', { cache:'no-cache' });
    const games = visibleGames(await response.json(), { dev:isDevMode() });
    root.innerHTML = games.length ? games.map(gameCard).join('') : '<p class="empty">Les premiers jeux arrivent bientôt.</p>';
  } catch {
    root.innerHTML = '<p class="empty">Impossible de charger la liste des jeux.</p>';
  }
}
