import test from 'node:test';
import assert from 'node:assert/strict';
import { groupNightCalendar, groupNightDateLabel, groupNightNeedsResponse, groupNightVoteSummary, localDateKey, normalizeGroupNight, responseCounts } from '../js/night/night-utils.mjs';

test('today plan stays active and responses are summarized', () => {
  const today = localDateKey(new Date(2026, 7, 24, 12));
  const plan = normalizeGroupNight({ date:today, time:'21:30', gameTitle:'PEAK', responses:{ nico:{ status:'yes' }, liam:{ status:'maybe' } } }, today);
  assert.equal(plan.gameTitle, 'PEAK');
  assert.deepEqual(responseCounts(plan), { yes:1, maybe:1, no:0 });
  assert.equal(normalizeGroupNight({ date:'2020-01-01' }, today), null);
  const tomorrow = normalizeGroupNight({ date:'2026-08-25', time:'20:00', gameTitle:'PEAK' }, today);
  assert.equal(groupNightDateLabel(tomorrow, new Date(2026, 7, 24, 12)), 'Demain');
  assert.match(groupNightCalendar(tomorrow), /SUMMARY:PEAK/);
  assert.match(groupNightCalendar(tomorrow), /DTSTART:20260825T/);
});

test('group night supports several slots, game votes and a deterministic best choice', () => {
  const today = '2026-08-24';
  const plan = normalizeGroupNight({
    date:today, time:'20:00',
    options:{ friday:{ id:'friday', date:today, time:'20:00' }, saturday:{ id:'saturday', date:'2026-08-25', time:'21:00' } },
    games:{ peak:{ id:'peak', title:'PEAK' }, lethal:{ id:'lethal', title:'Lethal Company' } },
    responses:{
      nico:{ availability:{ friday:'yes', saturday:'maybe' }, gameVotes:{ peak:true } },
      liam:{ availability:{ friday:'yes', saturday:'no' }, gameVotes:{ peak:true, lethal:true } },
    },
  }, today);
  const summary = groupNightVoteSummary(plan);
  assert.equal(summary.bestOption.id, 'friday');
  assert.equal(summary.bestGame.id, 'peak');
  assert.equal(summary.optionVotes.friday.yes, 2);
  assert.equal(groupNightNeedsResponse(plan, 'nico'), false);
  assert.equal(groupNightNeedsResponse(plan, 'rayhan'), true);
});

