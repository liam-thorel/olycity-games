import test from 'node:test';
import assert from 'node:assert/strict';
import { gameBuilds, readRegistry, validateRegistry } from '../scripts/build.mjs';
import { visibleGames } from '../js/registry.mjs';
import { everyoneAnswered, randomDelay, resolveRound } from '../games/reflexe/rules.mjs';

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
