import { db, escapeHTML, isManager, pickProfile, safeHttpsUrl } from '../../sdk/olycity.mjs';
import {
  confirmedTonightCount, groupNightCalendar, groupNightDateLabel, groupNightVoteSummary, localDateKey,
  nightResponseKey, normalizeGroupNight, responseCounts,
} from './night-utils.mjs';

// Même chemin que le tracker : une soirée planifiée d'un côté apparaît de
// l'autre, et le Worker de notifications continue d'envoyer les rappels.
const PLAN_PATH = 'groupNight/current';
const PLAN_CACHE_KEY = 'olycity-games-night-v1';
const RESPONSE_LABELS = { yes:'présent', maybe:'peut-être', no:'absent' };

let members = [];
let profile = null;
let getGames = () => [];
let plan = null;
let pendingAvailability = {};
let pendingGameVotes = new Set();

function cachedPlan() {
  try { return JSON.parse(localStorage.getItem(PLAN_CACHE_KEY) || 'null'); }
  catch { return null; }
}

function personAvatar(person, status = '') {
  const member = members.find(item => item.id === person.memberId || item.name === person.name);
  const name = person.name || member?.name || '?';
  const avatar = safeHttpsUrl(person.avatar || member?.avatar);
  return `<span class="night-person${status ? ` is-${escapeHTML(status)}` : ''}" title="${escapeHTML(`${name} · ${RESPONSE_LABELS[status] || status}`)}">${avatar ? `<img src="${escapeHTML(avatar)}" alt="">` : escapeHTML(name.slice(0, 1).toUpperCase())}</span>`;
}

function renderPlan() {
  document.dispatchEvent(new CustomEvent('olycity:night-updated'));
  const root = document.getElementById('night-content');
  const open = document.getElementById('night-open');
  if (!root || !open) return;
  if (!plan) {
    open.textContent = 'Organiser';
    root.innerHTML = '<div><strong>On se retrouve quand ?</strong><small>Propose des créneaux et des jeux, le groupe vote.</small></div>';
    return;
  }
  const counts = responseCounts(plan);
  const people = Object.values(plan.responses || {}).filter(item => item.status !== 'no');
  const cover = safeHttpsUrl(plan.games.find(game => game.id === plan.gameId)?.coverUrl);
  open.textContent = 'Voir / répondre';
  root.innerHTML = `${cover ? `<img class="night-cover" src="${escapeHTML(cover)}" alt="">` : ''}
    <div><strong>${escapeHTML(plan.gameTitle)}</strong>
      <small>${escapeHTML(groupNightDateLabel(plan))} · ${counts.yes} présent${counts.yes > 1 ? 's' : ''}${counts.maybe ? ` · ${counts.maybe} peut-être` : ''}${plan.final ? ' · choix validé' : ''}</small>
      <span class="night-people">${people.map(item => personAvatar(item, item.status)).join('') || '<span class="night-empty">En attente des réponses</span>'}</span>
    </div>
    <time class="night-time" datetime="${escapeHTML(`${plan.date}T${plan.time}`)}">${escapeHTML(plan.time)}</time>`;
}

export function tonightParticipantCount() {
  return confirmedTonightCount(plan);
}

function setStatus(message = '', error = false) {
  const status = document.getElementById('night-status');
  if (!status) return;
  status.textContent = message;
  status.classList.toggle('is-error', error);
}

async function loadPlan() {
  try {
    const raw = await db.get(PLAN_PATH, { timeoutMs:4_000 });
    localStorage.setItem(PLAN_CACHE_KEY, JSON.stringify(raw || null));
    plan = normalizeGroupNight(raw);
  } catch {
    plan = normalizeGroupNight(cachedPlan());
  }
  renderPlan();
}

function renderVoteControls(slots = [], gameChoices = []) {
  const root = document.getElementById('night-vote');
  if (!root) return;
  if (!plan) {
    root.innerHTML = '<p class="night-hint">Crée les propositions : chacun pourra ensuite voter pour chaque horaire et chaque jeu.</p>';
    return;
  }
  const summary = groupNightVoteSummary(plan);
  root.innerHTML = `<h3>Mes disponibilités</h3><div class="night-vote-slots">${slots.map(slot => {
    const selected = pendingAvailability[slot.id] || '';
    const tally = summary.optionVotes[slot.id] || { yes:0, maybe:0 };
    return `<article><span><strong>${escapeHTML(groupNightDateLabel(slot))} · ${escapeHTML(slot.time)}</strong><small>${tally.yes} oui${tally.maybe ? ` · ${tally.maybe} peut-être` : ''}</small></span><div>${[['yes', 'Oui'], ['maybe', 'Peut-être'], ['no', 'Non']].map(([status, label]) => `<button type="button" data-vote-slot="${escapeHTML(slot.id)}" data-vote-status="${status}" class="${selected === status ? 'is-active' : ''}">${label}</button>`).join('')}</div></article>`;
  }).join('')}</div>${gameChoices.length ? `<h3>Jeux qui me tentent</h3><div class="night-vote-games">${gameChoices.map(game => `<button type="button" data-vote-game="${escapeHTML(game.id)}" class="${pendingGameVotes.has(game.id) ? 'is-active' : ''}"><strong>${escapeHTML(game.title)}</strong><small>${summary.gameVotes[game.id] || 0} vote${summary.gameVotes[game.id] === 1 ? '' : 's'}</small></button>`).join('')}</div>` : ''}${plan.final ? '<p class="night-locked">✓ Le choix final est validé. Les réponses restent visibles.</p>' : ''}`;
}

function syncForm() {
  const today = localDateKey();
  const max = localDateKey(new Date(Date.now() + 30 * 86_400_000));
  const slots = plan?.options?.length ? plan.options : [{ id:'slot-1', date:today, time:'21:30' }];
  document.getElementById('night-slot-editors').innerHTML = [0, 1, 2].map(index => {
    const slot = slots[index] || {};
    return `<div class="night-slot-editor" data-slot-editor="${index}"><span>${index + 1}</span><input type="date" data-slot-date min="${today}" max="${max}" value="${escapeHTML(slot.date || '')}" ${index ? '' : 'required'} aria-label="Date du créneau ${index + 1}"><input type="time" data-slot-time value="${escapeHTML(slot.time || (index ? '' : '21:30'))}" ${index ? '' : 'required'} aria-label="Heure du créneau ${index + 1}"></div>`;
  }).join('');
  const games = getGames().filter(game => game.status !== 'played');
  const options = `<option value="">— aucun —</option>${games.map(game => `<option value="${escapeHTML(game.id)}">${escapeHTML(game.title)}</option>`).join('')}`;
  const gameRoot = document.getElementById('night-game-editors');
  gameRoot.innerHTML = [0, 1, 2].map(index => `<select data-night-game-select aria-label="Jeu proposé ${index + 1}">${options}</select>`).join('');
  gameRoot.querySelectorAll('[data-night-game-select]').forEach((select, index) => {
    const wanted = plan?.games?.[index]?.id || '';
    if (wanted && ![...select.options].some(option => option.value === wanted)) {
      select.add(new Option(plan.games[index].title, wanted));
    }
    select.value = wanted;
  });
  const response = profile ? plan?.responses?.[nightResponseKey(profile.id || profile.name)] : null;
  pendingAvailability = { ...(response?.availability || {}) };
  pendingGameVotes = new Set(Object.entries(response?.gameVotes || {}).filter(([, value]) => value).map(([id]) => id));
  renderVoteControls(slots, plan?.games || []);
  document.getElementById('night-calendar').hidden = !plan;
  const finalize = document.getElementById('night-finalize');
  finalize.hidden = !plan || !isManager(profile);
  finalize.textContent = plan?.final ? 'Rouvrir les votes' : 'Valider le meilleur choix';
  const attendees = document.getElementById('night-attendees');
  const responses = Object.values(plan?.responses || {});
  attendees.innerHTML = responses.length
    ? responses.sort((a, b) => String(a.name).localeCompare(String(b.name), 'fr')).map(item => personAvatar(item, item.status)).join('')
    : '<span class="night-empty">Personne n’a encore répondu.</span>';
  setStatus('');
}

async function openModal() {
  if (!profile) {
    await pickProfile({ subtitle:'Choisis ton profil pour organiser une soirée.' });
    if (!profile) return;
  }
  syncForm();
  document.getElementById('night-modal').hidden = false;
  document.querySelector('[data-slot-time]')?.focus();
}

function closeModal() {
  document.getElementById('night-modal').hidden = true;
}

async function submitPlan(event) {
  event.preventDefault();
  if (!profile) return;
  const submit = event.currentTarget.querySelector('[type="submit"]');
  const options = [...document.querySelectorAll('[data-slot-editor]')].map((row, index) => {
    const date = row.querySelector('[data-slot-date]')?.value || '';
    const time = row.querySelector('[data-slot-time]')?.value || '';
    if (!date || !time) return null;
    return { id:plan?.options?.[index]?.id || `slot-${index + 1}`, date, time, startsAt:new Date(`${date}T${time}:00`).getTime() };
  }).filter(Boolean);
  const games = getGames();
  const selectedIds = [...new Set([...document.querySelectorAll('[data-night-game-select]')].map(select => select.value).filter(Boolean))];
  const gameChoices = selectedIds.map(id => games.find(game => game.id === id) || plan?.games?.find(game => game.id === id)).filter(Boolean)
    .map(game => ({ id:game.id, title:game.title || 'Sans titre', coverUrl:game.coverUrl || '' }));
  const firstSlot = options[0];
  const firstGame = gameChoices[0];
  if (!firstSlot) { setStatus('Ajoute au moins un créneau complet.', true); return; }
  submit.disabled = true;
  setStatus('Enregistrement…');
  try {
    const updatedAt = Date.now();
    await db.update(PLAN_PATH, {
      date:firstSlot.date, time:firstSlot.time, startsAt:firstSlot.startsAt,
      gameId:firstGame?.id || '', gameTitle:firstGame?.title || 'Jeu à décider',
      options:Object.fromEntries(options.map(option => [option.id, option])),
      games:Object.fromEntries(gameChoices.map(game => [game.id, game])), final:null,
      createdBy:plan?.createdBy || profile.name, updatedAt,
    });
    const availability = plan ? pendingAvailability : { [firstSlot.id]:'yes' };
    const selectedVotes = pendingGameVotes.size ? pendingGameVotes : new Set(firstGame ? [firstGame.id] : []);
    const statuses = Object.values(availability);
    const status = statuses.includes('yes') ? 'yes' : statuses.includes('maybe') ? 'maybe' : statuses.includes('no') ? 'no' : '';
    await db.set(`${PLAN_PATH}/responses/${nightResponseKey(profile.id || profile.name)}`, {
      memberId:profile.id || '', name:profile.name, avatar:profile.avatar || '', status, availability,
      gameVotes:Object.fromEntries([...selectedVotes].map(id => [id, true])), updatedAt,
    });
    await loadPlan();
    closeModal();
  } catch (error) {
    setStatus(`Impossible d’enregistrer : ${error.message}`, true);
  } finally { submit.disabled = false; }
}

async function toggleFinalChoice() {
  if (!plan || !isManager(profile)) return;
  const button = document.getElementById('night-finalize');
  button.disabled = true;
  setStatus(plan.final ? 'Réouverture des votes…' : 'Validation du meilleur choix…');
  try {
    if (plan.final) {
      await db.set(`${PLAN_PATH}/final`, null);
    } else {
      const summary = groupNightVoteSummary(plan);
      await db.set(`${PLAN_PATH}/final`, {
        optionId:summary.bestOption?.id || plan.options?.[0]?.id || '',
        gameId:summary.bestGame?.id || plan.games?.[0]?.id || '', lockedAt:Date.now(), lockedBy:profile.name,
      });
    }
    await loadPlan();
    syncForm();
  } catch {
    setStatus('Impossible de modifier le choix final.', true);
  } finally { button.disabled = false; }
}

function downloadCalendar() {
  const content = groupNightCalendar(plan);
  if (!content) return;
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([content], { type:'text/calendar;charset=utf-8' }));
  link.download = `olycity-${plan.date}.ics`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 0);
}

export function setNightProfile(nextProfile) {
  profile = nextProfile;
  if (!document.getElementById('night-modal')?.hidden) syncForm();
}

export function initNightPanel({ members:nextMembers = [], profile:nextProfile = null, games = () => [] } = {}) {
  members = nextMembers;
  profile = nextProfile;
  getGames = games;
  plan = normalizeGroupNight(cachedPlan());
  renderPlan();
  document.getElementById('night-open')?.addEventListener('click', openModal);
  document.getElementById('night-form')?.addEventListener('submit', submitPlan);
  document.getElementById('night-calendar')?.addEventListener('click', downloadCalendar);
  document.getElementById('night-finalize')?.addEventListener('click', toggleFinalChoice);
  document.getElementById('night-vote')?.addEventListener('click', event => {
    const slot = event.target.closest('[data-vote-slot]');
    if (slot) pendingAvailability[slot.dataset.voteSlot] = slot.dataset.voteStatus;
    const game = event.target.closest('[data-vote-game]');
    if (game) {
      if (pendingGameVotes.has(game.dataset.voteGame)) pendingGameVotes.delete(game.dataset.voteGame);
      else pendingGameVotes.add(game.dataset.voteGame);
    }
    if (slot || game) renderVoteControls(plan?.options || [], plan?.games || []);
  });
  document.querySelectorAll('[data-night-close]').forEach(button => button.addEventListener('click', closeModal));
  document.getElementById('night-modal')?.addEventListener('click', event => { if (event.target.id === 'night-modal') closeModal(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeModal(); });
  db.subscribe(PLAN_PATH, raw => {
    try { localStorage.setItem(PLAN_CACHE_KEY, JSON.stringify(raw || null)); } catch { /* stockage plein */ }
    plan = normalizeGroupNight(raw);
    renderPlan();
  }, { onError:() => {} });
  void loadPlan();
}
