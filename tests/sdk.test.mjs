import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PRESENCE_TIMEOUT_MS, activePlayers, generateLobbyCode, memberId, mergeMemberProfiles,
  mergeRealtimeEvent, normalizeLobbyCode, safeHttpsUrl,
} from '../sdk/olycity.mjs';

test('realtime put and patch events rebuild the local copy', () => {
  let value = mergeRealtimeEvent(null, { path:'/', data:{ a:{ x:1 } }, eventType:'put' });
  assert.deepEqual(value, { a:{ x:1 } });
  value = mergeRealtimeEvent(value, { path:'/a', data:{ y:2 }, eventType:'patch' });
  assert.deepEqual(value, { a:{ x:1, y:2 } });
  value = mergeRealtimeEvent(value, { path:'/state', data:{ 'clicks/liam':{ ms:210 } }, eventType:'patch' });
  assert.deepEqual(value.state, { clicks:{ liam:{ ms:210 } } });
  value = mergeRealtimeEvent(value, { path:'/a/x', data:null, eventType:'put' });
  assert.deepEqual(value.a, { y:2 });
  assert.equal(mergeRealtimeEvent(value, { path:'/', data:null, eventType:'put' }), null);
});

test('member profiles merge like the tracker and drop unsafe avatars', () => {
  const profiles = mergeMemberProfiles({
    roster:[{ name:'Noé', avatar:'https://cdn.discordapp.com/a.png', riot:{} }],
    members:[{ id:'logan', name:'Logan', avatar:'http://insecure/x.png' }],
    overlay:{ members:{ romain:{ name:'Romain' } }, hiddenMembers:{ logan:true } },
  });
  assert.deepEqual(profiles.map(profile => profile.id), ['noe', 'romain']);
  assert.equal(profiles[0].avatar, 'https://cdn.discordapp.com/a.png');
  assert.equal('riot' in profiles[0], false);
  assert.equal(memberId('M A I R'), 'm-a-i-r');
});

test('lobby codes are short, readable and normalized', () => {
  const code = generateLobbyCode(() => 0.5);
  assert.match(code, /^[A-Z]{4}$/);
  assert.doesNotMatch(generateLobbyCode(), /[IO]/);
  assert.equal(normalizeLobbyCode(' ab-cd '), 'ABCD');
});

test('only recently seen players count as present, oldest first', () => {
  const now = 1_000_000;
  const players = activePlayers({ players:{
    late:{ name:'B', joinedAt:20, lastSeen:now },
    first:{ name:'A', joinedAt:10, lastSeen:now - 1_000 },
    gone:{ name:'C', joinedAt:5, lastSeen:now - PRESENCE_TIMEOUT_MS - 1 },
  } }, now);
  assert.deepEqual(players.map(player => player.id), ['first', 'late']);
});

test('only https URLs, optionally from allowed hosts, are kept', () => {
  assert.equal(safeHttpsUrl('javascript:alert(1)'), '');
  assert.equal(safeHttpsUrl('https://store.steampowered.com/app/1/', ['steampowered.com']), 'https://store.steampowered.com/app/1/');
  assert.equal(safeHttpsUrl('https://evil.example/app/1/', ['steampowered.com']), '');
});
