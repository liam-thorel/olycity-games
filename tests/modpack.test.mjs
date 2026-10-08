import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
const read = file => readFileSync(new URL(file,import.meta.url),'utf8');
test('OLYCITY V1 has a static download and installation guide independent of Firebase', () => {
  const page = read('../index.html');
  const pack = JSON.parse(read('../assets/modpacks/olycity-v1.json'));
  assert.match(page,/id="modpacks"/);
  assert.match(page,/href="#modpacks"/);
  assert.match(page,/id="modpack-install"/);
  assert.ok(page.includes(`href="${pack.downloadUrl}"`));
  assert.ok(pack.modCount > 150);
  assert.ok(page.includes(`<strong>${pack.modCount}</strong> mods`));
  assert.ok(page.includes(pack.server.downloadUrl));
  assert.equal(pack.essential,false);
  assert.match(pack.sha256,/^[a-f0-9]{64}$/);
  assert.ok(pack.bytes < 2 * 1024 ** 3);
  assert.ok(page.includes(`Forge <strong>${pack.loader.replace('forge-','')}</strong>`));
  assert.match(page,/Version V1/);
  assert.match(page,/Rejoindre le serveur OLYCITY/);
  assert.match(page,/modpacks\.css\?v=20261008-v2/);
});

test('Packwiz distribution preserves personal paths, exact hashes and client/server selection', () => {
  const pack = JSON.parse(read('../assets/modpacks/olycity-v1.json'));
  assert.equal(pack.updates.type,'packwiz');
  assert.ok(pack.bytes < 5_000_000);
  assert.ok(pack.server.updateKitUrl.endsWith('.zip'));
  const root = new URL('../assets/modpacks/updates/',import.meta.url);
  const hash = data => createHash('sha256').update(data).digest('hex');
  for (const channel of ['stable','test',...readdirSync(new URL('versions/',root)).map(v=>`versions/${v}`)]) {
    const manifest = readFileSync(new URL(`${channel}/pack.toml`,root),'utf8');
    const bytes = readFileSync(new URL(`${channel}/index.toml`,root));
    assert.ok(manifest.includes(`hash = "${hash(bytes)}"`),`Exact byte hash: ${channel}`);
  }
  const stable = readFileSync(new URL('stable/pack.toml',root),'utf8');
  const pinned = readFileSync(new URL(`versions/${pack.updates.version}/pack.toml`,root),'utf8');
  assert.equal(stable,pinned);
  const index = readFileSync(new URL('stable/index.toml',root));
  assert.ok(stable.includes(`hash = "${hash(index)}"`));
  const counts = {client:0,server:0};
  for (const block of index.toString().split('[[files]]').slice(1)) {
    const path = JSON.parse(block.match(/file = (".*")/)[1]);
    const expected = block.match(/hash = "([a-f0-9]+)"/)[1];
    const metadata = readFileSync(new URL(`stable/${path}`,root));
    assert.equal(hash(metadata),expected,path);
    const text = metadata.toString();
    const side = text.match(/side = "(client|server|both)"/)[1];
    assert.ok(!path.startsWith('saves/') && !path.startsWith('shaderpacks/') && !path.startsWith('config/xaero/'));
    assert.ok(!['options.txt.pw.toml','servers.dat.pw.toml','ops.json.pw.toml','server.properties.pw.toml'].includes(path));
    if (path.startsWith('mods/') && path.endsWith('.jar.pw.toml')) {
      if (side !== 'server') counts.client++;
      if (side !== 'client') counts.server++;
    }
    const url = JSON.parse(text.match(/url = (".*")/)[1]);
    if (url.includes('/updates/payload/')) {
      const file = new URL(`payload/${url.split('/').at(-1)}`,root);
      assert.ok(existsSync(file));
      assert.equal(hash(readFileSync(file)),text.match(/hash = "([a-f0-9]+)"/)[1]);
    }
  }
  assert.deepEqual(counts,{client:pack.modCount,server:pack.server.modCount});
});
