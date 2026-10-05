import test from 'node:test';
import assert from 'node:assert/strict';
import { gameBuilds, readRegistry, validateRegistry } from '../scripts/build.mjs';
import { visibleGames } from '../js/registry.mjs';
import { everyoneAnswered, randomDelay, resolveRound } from '../games/reflexe/rules.mjs';
import * as telepathe from '../games/telepathe/rules.mjs';

test('Télépathe: points by band around the target', () => {
  const { scoreGuess } = telepathe;
  assert.equal(scoreGuess(50, 50), 4);
  assert.equal(scoreGuess(52.5, 50), 4);
  assert.equal(scoreGuess(55, 50), 3);
  assert.equal(scoreGuess(62.5, 50), 2);
  assert.equal(scoreGuess(63, 50), 0);
});

test('Télépathe: targets keep the whole scoring zone on the dial', () => {
  assert.equal(telepathe.pickTarget(() => 0), 12.5);
  assert.equal(telepathe.pickTarget(() => 0.9999), 87.5);
});

test('Télépathe: the psychic rotates and skips players who left', () => {
  const order = ['a', 'b', 'c'];
  assert.equal(telepathe.psychicFor(1, order, order), 'a');
  assert.equal(telepathe.psychicFor(4, order, order), 'a');
  assert.equal(telepathe.psychicFor(2, order, ['a', 'c']), 'c');
  assert.equal(telepathe.psychicFor(1, order, ['d']), 'd');
});

test('Télépathe: guessers score their needle, the psychic gets their average', () => {
  const points = telepathe.scoreRound({ target:40, guesses:{ b:40, c:47 }, psychic:'a', guesserIds:['b', 'c', 'd'] });
  assert.deepEqual(points, { b:4, c:3, d:0, a:2 });
  assert.equal(telepathe.allGuessed({ b:1 }, ['b', 'c']), false);
  assert.equal(telepathe.allGuessed({ b:1, c:0 }, ['b', 'c']), true);
});

test('Télépathe: a custom theme needs two distinct, trimmed ends', () => {
  const { normalizeSpectrum, cardSpectrum, CARDS } = telepathe;
  assert.deepEqual(normalizeSpectrum('  Pas   drôle ', 'Hilarant'), { left:'Pas drôle', right:'Hilarant' });
  assert.equal(normalizeSpectrum('Chaud', ''), null);
  assert.equal(normalizeSpectrum('Nul', 'nul'), null);
  assert.equal(normalizeSpectrum('x'.repeat(80), 'y').left.length, 40);
  assert.deepEqual(cardSpectrum(0), { left:CARDS[0][0], right:CARDS[0][1] });
});

test('Télépathe: dial angle conversions round-trip and cards do not repeat', () => {
  assert.equal(telepathe.angleToValue(telepathe.valueToAngle(37.5)), 37.5);
  assert.equal(telepathe.angleToValue(Math.PI), 0);
  assert.equal(telepathe.angleToValue(-1), 100);
  const all = telepathe.CARDS.map((_, index) => index);
  assert.equal(telepathe.drawCard(all.slice(1)), 0);
  assert.ok(telepathe.CARDS.every(card => card.length === 2 && card.every(Boolean)));
  assert.equal(new Set(telepathe.CARDS.map(card => card.join('|'))).size, telepathe.CARDS.length);
});

test('the game registry is valid and every playable game has a folder', () => {
  assert.deepEqual(validateRegistry(readRegistry(), gameBuilds()), []);
});

test('registry validation catches dead links and bad entries', () => {
  const errors = validateRegistry([
    { slug:'ghost', name:'G', tagline:'t', status:'live' },
    { slug:'Bad Slug', name:'B', tagline:'t', status:'soon' },
    { slug:'x', name:'X', tagline:'t', status:'wip' },
  ], [{ slug:'x' }]);
  assert.equal(errors.length, 3);
});

test('games in development stay hidden from the public portal', () => {
  const registry = [{ slug:'a', status:'live' }, { slug:'b', status:'dev' }, { slug:'c', status:'soon' }];
  assert.deepEqual(visibleGames(registry).map(game => game.slug), ['a', 'c']);
  assert.deepEqual(visibleGames(registry, { dev:true }).map(game => game.slug), ['a', 'b', 'c']);
});

test('Réflexe: fastest valid click wins, false starts and no-shows never win', () => {
  const result = resolveRound({ a:{ ms:320 }, b:{ ms:250 }, c:{ early:true } }, ['a', 'b', 'c', 'd']);
  assert.equal(result.winner, 'b');
  assert.deepEqual(result.ranking.map(entry => entry.id), ['b', 'a', 'c', 'd']);
  assert.equal(resolveRound({ a:{ early:true } }, ['a', 'b']).winner, null);
  assert.equal(everyoneAnswered({ a:{ ms:1 } }, ['a', 'b']), false);
  assert.equal(everyoneAnswered({ a:{ ms:1 }, b:{ early:true } }, ['a', 'b']), true);
  assert.ok(randomDelay(() => 0) >= 1_500 && randomDelay(() => 0.999) < 4_000);
});
