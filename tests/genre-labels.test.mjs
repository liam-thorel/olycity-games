import test from 'node:test';
import assert from 'node:assert/strict';
import { genreLabel, visibleGenre } from '../js/coop/genre-labels.mjs';
test('translate known genres without changing catalog keys', () => {
  assert.equal(genreLabel('Adventure'), 'Aventure');
  assert.equal(genreLabel('Horror'), 'Horreur');
  assert.equal(genreLabel('Custom'), 'Custom');
  assert.equal(visibleGenre('Steam'), false);
});
