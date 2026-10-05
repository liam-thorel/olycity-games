export const MIN_PLAYERS = 2;

/**
 * Zones de points autour de la cible, en unités du cadran (0 à 100).
 * Chaque bande fait 5 unités : 4 points au centre, puis 3, puis 2.
 */
export const BANDS = [
  { points:4, half:2.5 },
  { points:3, half:7.5 },
  { points:2, half:12.5 },
];

export function scoreGuess(guess, target) {
  const distance = Math.abs(Number(guess) - Number(target));
  return BANDS.find(band => distance <= band.half)?.points || 0;
}

/** Cible tirée assez loin des bords pour que toute la zone de points reste sur le cadran. */
export function pickTarget(random = Math.random) {
  const margin = BANDS.at(-1).half;
  return Math.round((margin + random() * (100 - 2 * margin)) * 10) / 10;
}

/** Le médium tourne dans l'ordre d'arrivée ; un joueur parti est sauté. */
export function psychicFor(round, order = [], presentIds = []) {
  if (!order.length) return presentIds[0] || null;
  for (let step = 0; step < order.length; step += 1) {
    const id = order[(round - 1 + step) % order.length];
    if (presentIds.includes(id)) return id;
  }
  return presentIds[0] || null;
}

/** Points d'une manche : chaque devineur selon son aiguille, le médium la moyenne arrondie de ses devineurs. */
export function scoreRound({ target, guesses = {}, psychic, guesserIds = [] }) {
  const points = {};
  guesserIds.forEach(id => {
    points[id] = Number.isFinite(guesses[id]) ? scoreGuess(guesses[id], target) : 0;
  });
  const values = guesserIds.map(id => points[id]);
  if (psychic) points[psychic] = values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
  return points;
}

export function drawCard(used = [], random = Math.random) {
  const available = CARDS.map((_, index) => index).filter(index => !used.includes(index));
  const pool = available.length ? available : CARDS.map((_, index) => index);
  return pool[Math.floor(random() * pool.length)];
}

export const MODES = { cards:'cards', custom:'custom' };
const LABEL_MAX = 40;

/** Spectre écrit par le médium : deux extrémités non vides et différentes, ou null. */
export function normalizeSpectrum(left = '', right = '') {
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim().slice(0, LABEL_MAX);
  const spectrum = { left:clean(left), right:clean(right) };
  if (!spectrum.left || !spectrum.right) return null;
  if (spectrum.left.toLocaleLowerCase('fr') === spectrum.right.toLocaleLowerCase('fr')) return null;
  return spectrum;
}

export function cardSpectrum(index) {
  const [left, right] = CARDS[index] || CARDS[0];
  return { left, right };
}

export function allGuessed(guesses = {}, guesserIds = []) {
  return guesserIds.length > 0 && guesserIds.every(id => Number.isFinite(guesses[id]));
}

/* Valeurs du cadran ↔ angle : 0 à gauche, 100 à droite, demi-cercle vers le haut. */
export function valueToAngle(value) {
  return Math.PI * (1 - Math.max(0, Math.min(100, value)) / 100);
}

export function angleToValue(angle) {
  const clamped = Math.max(0, Math.min(Math.PI, angle));
  return Math.round((1 - clamped / Math.PI) * 1000) / 10;
}

export const CARDS = [
  ['Sale', 'Propre'],
  ['Froid', 'Chaud'],
  ['Inutile', 'Indispensable'],
  ['Sous-coté', 'Surcoté'],
  ['Facile à dessiner', 'Impossible à dessiner'],
  ['Ringard', 'Stylé'],
  ['Calme', 'Bruyant'],
  ['Pas cher', 'Hors de prix'],
  ['Mou', 'Dur'],
  ['Effrayant', 'Rassurant'],
  ['Mauvais film', 'Chef-d’œuvre'],
  ['Petit déj', 'Dîner'],
  ['Héros', 'Méchant'],
  ['Ennuyeux', 'Passionnant'],
  ['Talent', 'Chance'],
  ['Vieux jeu', 'Moderne'],
  ['Inoffensif', 'Dangereux'],
  ['Salé', 'Sucré'],
  ['Pour les enfants', 'Pour les adultes'],
  ['Sport', 'Pas un sport'],
  ['Introverti', 'Extraverti'],
  ['Naturel', 'Artificiel'],
  ['Légal', 'Illégal'],
  ['Moche', 'Beau'],
  ['Lent', 'Rapide'],
  ['Mauvaise idée', 'Bonne idée'],
  ['Rare', 'Courant'],
  ['Fragile', 'Indestructible'],
  ['Gênant', 'Classe'],
  ['Triste', 'Joyeux'],
  ['Sain', 'Malsain'],
  ['Simple', 'Compliqué'],
  ['Flop', 'Carton'],
  ['Silencieux', 'Assourdissant'],
  ['Odeur horrible', 'Odeur divine'],
  ['Inconnu', 'Célèbre'],
  ['Tranquille', 'Chaotique'],
  ['Utile en cas de zombies', 'Inutile en cas de zombies'],
  ['Ça se mange', 'Ça ne se mange pas'],
  ['Mauvais jeu vidéo', 'Excellent jeu vidéo'],
  ['Tôt le matin', 'Tard le soir'],
  ['Lieu romantique', 'Lieu pas du tout romantique'],
  ['Arnaque', 'Bonne affaire'],
  ['Pas fun', 'Très fun'],
  ['Petit', 'Énorme'],
  ['Tiède', 'Brûlant'],
  ['Banal', 'Bizarre'],
  ['Sérieux', 'Ridicule'],
  ['Suivi', 'Leader'],
  ['Rouge', 'Bleu'],
  ['Mouillé', 'Sec'],
  ['À faire seul', 'À faire en groupe'],
  ['Dernier recours', 'Premier choix'],
  ['Démodé', 'Intemporel'],
  ['Cri de joie', 'Cri de peur'],
  ['Talent caché', 'Talent évident'],
  ['Ça pique', 'Ça caresse'],
  ['Vacances ratées', 'Vacances de rêve'],
  ['Pas mon genre', 'Mon type'],
  ['Mieux en vrai', 'Mieux en photo'],
];
