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
    <div class="game-card-art" aria-hidden="true">${gameIllustration(game.slug)}</div>
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

function gameIllustration(slug) {
  const art = {
    reflexe:'<rect x="58" y="10" width="44" height="100" rx="16"/><circle cx="80" cy="30" r="9" opacity=".25"/><circle cx="80" cy="60" r="9" opacity=".45"/><circle cx="80" cy="90" r="10" fill="currentColor"/>',
    'lost-in-translation':'<path d="M25 95a55 55 0 0 1 110 0"/><path d="M80 95l28-42"/><circle cx="80" cy="95" r="5" fill="currentColor"/><path d="M35 80l8-3m9-28 6 7m22-22v10m28 5-6 7m24 24-8-3"/>',
    imitation:'<rect x="66" y="20" width="28" height="50" rx="14"/><path d="M56 55v8a24 24 0 0 0 48 0v-8M80 88v17M65 105h30M24 48v24m12-35v46m88-46v46m12-35v24"/>',
  };
  return `<svg viewBox="0 0 160 120" width="160" height="120" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" style="color:var(--accent)">${art[slug] || '<path d="M45 40h70v50H45zM60 55v20m-10-10h20M100 60h1m-1 10h1"/>'}</svg>`;
}
