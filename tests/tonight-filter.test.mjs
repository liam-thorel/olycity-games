import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmedTonightCount } from '../js/night/night-utils.mjs';
test('compatibility counts confirmed participants for the evening slot only', () => {
  const plan = { date:'2026-10-05', options:[{id:'tonight',date:'2026-10-05'},{id:'tomorrow',date:'2026-10-06'}], responses:{
    nico:{status:'yes',availability:{tonight:'yes'}},
    liam:{status:'yes',availability:{tomorrow:'yes'}},
    logan:{status:'maybe',availability:{tonight:'maybe'}},
  } };
  assert.equal(confirmedTonightCount(plan, '2026-10-05'), 1);
  assert.equal(confirmedTonightCount({...plan,final:{optionId:'tomorrow'}}, '2026-10-05'), 0);
  assert.equal(confirmedTonightCount(null, '2026-10-05'), 0);
});
