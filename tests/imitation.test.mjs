import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MAX_CLIP_SECONDS, applyVote, awardTrophies, buildClip, everyoneDone, formatTime, mergeStats, parseTime, parseYouTube, shuffle, tallyRound,
} from '../games/imitation/rules.mjs';
import { handleRequest, isValidKey, listVideos, tokenMatches } from '../workers/videos/worker.mjs';
import { titleFromKey } from '../games/imitation/rules.mjs';

test('Video worker: the list only returns videos, across pages', async () => {
  const pages = [
    { objects:[{ key:'videos/a.mp4', size:1, httpMetadata:{ contentType:'video/mp4' } }, { key:'thumbs/a.jpg', size:1, httpMetadata:{ contentType:'image/jpeg' } }], truncated:true, cursor:'c' },
    { objects:[{ key:'b.webm', size:2 }], truncated:false },
  ];
  const bucket = { list:async ({ cursor }) => pages[cursor ? 1 : 0] };
  assert.deepEqual((await listVideos(bucket)).map(video => video.key), ['videos/a.mp4', 'b.webm']);
  assert.equal(titleFromKey('videos/3f9c2a7b1e4d4c6f8a0b1c2d3e4f5a6b.mp4', 2), 'Vidéo importée 2');
  assert.equal(titleFromKey('videos/scene_du_diner.mp4'), 'scene du diner');
  assert.equal(titleFromKey('5b0d1dee-ee38-4ef5-a39f-6c35ffed50c8/8a422065-9177-4fbf-bb30-e7fc20915df2-du_bist_gut_genug.mp4'), 'du bist gut genug');
  assert.equal(titleFromKey('a/8a422065-9177-4fbf-bb30-e7fc20915df2.mp4', 3), 'Vidéo importée 3');
});

// Les modules du jeu importent « /sdk/… » (chemin du site) : Node ne peut pas les charger.
// On vérifie donc au moins que chaque nom importé par un module est bien exporté par sa cible.
test('Imitation: every imported name exists in the module it comes from', () => {
  const dir = new URL('../games/imitation/', import.meta.url);
  const sdk = new URL('../sdk/', import.meta.url);
  const exportsOf = file => new Set([...readFileSync(file, 'utf8').matchAll(/export\s+(?:async\s+)?(?:function|const|let|class)\s+(\w+)/g)].map(match => match[1]));
  for (const name of ['game.mjs', 'library.mjs', 'media.mjs', 'rules.mjs']) {
    const source = readFileSync(new URL(name, dir), 'utf8');
    for (const [, names, from] of source.matchAll(/import\s*\{([^}]+)\}\s*from\s*'([^']+)'/g)) {
      const target = from.startsWith('/sdk/') ? new URL(from.slice(5), sdk) : new URL(from, new URL(name, dir));
      const available = exportsOf(target);
      names.split(',').map(item => item.trim()).filter(Boolean).forEach(item => {
        assert.ok(available.has(item), `${name} importe ${item} depuis ${from}, qui ne l'exporte pas`);
      });
    }
  }
});

test('Imitation: times are read in every usual notation', () => {
  assert.equal(parseTime('83'), 83);
  assert.equal(parseTime('1:23'), 83);
  assert.equal(parseTime('1:02:03'), 3723);
  assert.equal(parseTime('1m23s'), 83);
  assert.equal(parseTime('2m'), 120);
  assert.equal(parseTime('abc'), null);
  assert.equal(parseTime(''), null);
  assert.equal(formatTime(83.4), '1:23');
});

test('Imitation: YouTube links of every shape give the id and the start', () => {
  assert.deepEqual(parseYouTube('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42'), { id:'dQw4w9WgXcQ', start:42 });
  assert.deepEqual(parseYouTube('https://youtu.be/dQw4w9WgXcQ?t=1m5s'), { id:'dQw4w9WgXcQ', start:65 });
  assert.equal(parseYouTube('https://www.youtube.com/shorts/dQw4w9WgXcQ').id, 'dQw4w9WgXcQ');
  assert.equal(parseYouTube('https://m.youtube.com/watch?v=dQw4w9WgXcQ').id, 'dQw4w9WgXcQ');
  assert.equal(parseYouTube('https://vimeo.com/12345'), null);
  assert.equal(parseYouTube('pas un lien'), null);
});

test('Imitation: clips are validated before entering the library', () => {
  assert.ok(buildClip({ kind:'youtube', title:'Scène', youtube:'dQw4w9WgXcQ', start:10, end:30 }).clip);
  assert.match(buildClip({ kind:'youtube', title:'Scène', youtube:'dQw4w9WgXcQ', start:0, end:MAX_CLIP_SECONDS + 1 }).error, /au plus/);
  assert.match(buildClip({ kind:'youtube', title:'', youtube:'dQw4w9WgXcQ', start:0, end:10 }).error, /titre/);
  assert.match(buildClip({ kind:'youtube', title:'X', youtube:'dQw4w9WgXcQ', start:20, end:10 }).error, /après/);
  // Fichier sans fin : on prend jusqu'à la durée maximale autorisée.
  assert.equal(buildClip({ kind:'file', title:'X', url:'https://v/x.mp4', start:5, duration:120 }).clip.end, 5 + MAX_CLIP_SECONDS);
  assert.match(buildClip({ kind:'file', title:'X', url:'https://v/x.mp4', start:0, end:30, duration:20 }).error, /dépasse/);
  assert.match(buildClip({ kind:'file', title:'X', url:'http://v/x.mp4', start:0, end:10 }).error, /invalide/);
});

test('Imitation: only one super like per voter and round', () => {
  let ballot = applyVote({}, 'a', 2);
  ballot = applyVote(ballot, 'b', 2);
  assert.deepEqual(ballot, { a:1, b:2 });
  assert.deepEqual(applyVote(ballot, 'c', 7), ballot);
});

test('Imitation: points add up votes from others, never your own', () => {
  const { points, stats } = tallyRound({
    liam:{ nico:2, noe:-1, liam:2 },
    nico:{ liam:1, noe:1 },
    noe:{ liam:0, nico:1, ghost:2 },
  }, ['liam', 'nico', 'noe']);
  assert.deepEqual(points, { liam:1, nico:3, noe:0 });
  assert.equal(stats.liam.minusGiven, 1);
  assert.equal(stats.nico.plusGiven, 2);
  assert.equal(stats.nico.superReceived, 1);
});

test('Imitation: trophies need a clear winner', () => {
  const stats = mergeStats({ a:{ minusGiven:1, plusGiven:0, superReceived:0 } }, { a:{ minusGiven:1, plusGiven:2, superReceived:0 }, b:{ minusGiven:0, plusGiven:2, superReceived:3 } });
  const trophies = awardTrophies(stats);
  assert.deepEqual(trophies.hater, { id:'a', count:2 });
  assert.deepEqual(trophies.goat, { id:'b', count:3 });
  assert.equal(trophies.liker, null);
  assert.equal(everyoneDone({ a:true }, ['a', 'b']), false);
  assert.deepEqual(shuffle([1, 2, 3], () => 0).sort(), [1, 2, 3]);
});

function fakeBucket() {
  const files = new Map();
  return {
    files,
    async put(key, body, options) { files.set(key, { body, type:options.httpMetadata.contentType }); },
    async delete(key) { files.delete(key); },
    async get(key) {
      const file = files.get(key);
      if (!file) return null;
      return { body:'data', size:4, httpEtag:'"e"', range:undefined, writeHttpMetadata:headers => headers.set('Content-Type', file.type) };
    },
  };
}

test('Video worker: uploads need the token and a video type', async () => {
  const env = { BUCKET:fakeBucket(), UPLOAD_TOKEN:'secret-code', SITE_ORIGIN:'https://games.olycity.fr' };
  const upload = (headers) => handleRequest(new Request('https://w.dev/upload', { method:'POST', body:'data', headers }), env);
  assert.equal((await upload({ 'Content-Type':'video/mp4', Authorization:'Bearer nope' })).status, 401);
  assert.equal((await upload({ 'Content-Type':'text/html', Authorization:'Bearer secret-code' })).status, 415);
  const ok = await upload({ 'Content-Type':'video/mp4', Authorization:'Bearer secret-code', Origin:'https://games.olycity.fr' });
  assert.equal(ok.status, 201);
  assert.equal(ok.headers.get('Access-Control-Allow-Origin'), 'https://games.olycity.fr');
  const { key, url } = await ok.json();
  assert.ok(isValidKey(key));
  assert.equal(url, `https://w.dev/v/${key}`);
  const read = await handleRequest(new Request(url), env);
  assert.equal(read.status, 200);
  assert.equal(read.headers.get('Content-Type'), 'video/mp4');
  assert.equal(read.headers.get('Accept-Ranges'), 'bytes');
});

test('Video worker: keys from the old version are accepted, path tricks are not', async () => {
  const env = { BUCKET:fakeBucket(), UPLOAD_TOKEN:'t' };
  assert.equal((await handleRequest(new Request('https://w.dev/v/..%2Fsecret.mp4'), env)).status, 404);
  assert.equal((await handleRequest(new Request('https://w.dev/v/abcdefgh.mp4'), env)).status, 404);
  assert.ok(isValidKey('videos/3f2a-uuid/clip_final.mp4'));
  assert.ok(!isValidKey('/etc/passwd.mp4'));
  assert.ok(!isValidKey('a/../b.mp4'));
  env.BUCKET.files.set('videos/old clip.mp4', { body:'x', type:'video/mp4' });
  assert.equal((await handleRequest(new Request('https://w.dev/v/videos/old%20clip.mp4'), env)).status, 404);
  env.BUCKET.files.set('videos/old-clip.mp4', { body:'x', type:'video/mp4' });
  assert.equal((await handleRequest(new Request('https://w.dev/v/videos/old-clip.mp4'), env)).status, 200);
  assert.equal(tokenMatches('abc', 'abc'), true);
  assert.equal(tokenMatches('abd', 'abc'), false);
  assert.equal(tokenMatches('anything', ''), false);
});
