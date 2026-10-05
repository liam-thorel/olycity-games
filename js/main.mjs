import { currentProfile, escapeHTML, loadMembers, onProfileChange, pickProfile } from '../sdk/olycity.mjs';
import { coopGames, initCoopPage, setCoopProfile } from './coop/coop-page.mjs';
import { initNightPanel, setNightProfile } from './night/night-panel.mjs';
import { renderRegistry } from './registry.mjs';
import { initSiteSwitcher } from './site-switcher.mjs';

function renderProfileChip(profile) {
  const chip = document.getElementById('profile-chip');
  if (!chip) return;
  chip.innerHTML = profile
    ? `${profile.avatar ? `<img src="${escapeHTML(profile.avatar)}" alt="">` : `<span>${escapeHTML(profile.name.slice(0, 1))}</span>`}<strong>${escapeHTML(profile.name)}</strong>`
    : '<span>?</span><strong>Choisir mon profil</strong>';
}

async function boot() {
  initSiteSwitcher(document.querySelector('.topbar'));
  void renderRegistry(document.getElementById('games-grid'));
  const [members, profile] = await Promise.all([loadMembers(), currentProfile()]);
  renderProfileChip(profile);
  initCoopPage(members, profile);
  initNightPanel({ members, profile, games:coopGames });
  document.getElementById('profile-chip')?.addEventListener('click', () => pickProfile());
  onProfileChange(next => {
    renderProfileChip(next);
    setCoopProfile(next);
    setNightProfile(next);
  });
}

boot();
