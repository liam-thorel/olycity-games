export const ROUNDS = 5;
export const MIN_PLAYERS = 2;

/** Délai aléatoire avant le feu vert, pour qu'on ne puisse pas anticiper. */
export function randomDelay(random = Math.random) {
  return 1_500 + Math.floor(random() * 2_500);
}

/**
 * Classe les clics d'une manche. `clicks` : { id: { ms } | { early:true } }.
 * Un départ anticipé ou une absence de clic ne peut pas gagner.
 */
export function resolveRound(clicks = {}, playerIds = []) {
  const ranking = playerIds.map(id => {
    const click = clicks[id];
    if (!click) return { id, ms:null, note:'pas cliqué' };
    if (click.early) return { id, ms:null, note:'trop tôt' };
    return { id, ms:Math.max(0, Number(click.ms) || 0), note:'' };
  }).sort((left, right) => {
    if (left.ms === null) return right.ms === null ? 0 : 1;
    if (right.ms === null) return -1;
    return left.ms - right.ms;
  });
  return { ranking, winner:ranking[0]?.ms !== null ? ranking[0]?.id || null : null };
}

export function everyoneAnswered(clicks = {}, playerIds = []) {
  return playerIds.length > 0 && playerIds.every(id => clicks[id]);
}
