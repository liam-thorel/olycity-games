import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('OLYCITY external Patchouli book has complete discoverable chapter files',()=>{
 const root=new URL('../assets/modpacks/updates/',import.meta.url);
 const index=readFileSync(new URL('stable/index.toml',root),'utf8');
 const paths=index.split('[[files]]').slice(1).map(b=>JSON.parse(b.match(/file = (".*")/)[1]));
 const load=path=>{
  const meta=readFileSync(new URL(`stable/${path}`,root),'utf8');
  const hash=meta.match(/hash = "([a-f0-9]+)"/)[1];
  return JSON.parse(readFileSync(new URL(`payload/${hash}`,root),'utf8'));
 };
 for(const locale of ['en_us','fr_fr']){
  const prefix=`patchouli_books/chroniques_olycity/${locale}/`;
  const categories=paths.filter(p=>p.startsWith(prefix+'categories/') && p.endsWith('.json.pw.toml'));
  const entries=paths.filter(p=>p.startsWith(prefix+'entries/') && p.endsWith('.json.pw.toml'));
  assert.equal(categories.length,6,`${locale}: external loader category discovery`);
  assert.equal(entries.length,30,`${locale}: external loader entry discovery`);
  const ids=new Set(categories.map(p=>'patchouli:'+p.split('/').at(-1).replace('.json.pw.toml','')));
  const used=new Set();
  for(const p of entries){const entry=load(p);assert.ok(ids.has(entry.category),p);assert.ok(entry.pages.length>0,p);if(!entry.advancement)used.add(entry.category);}
  assert.deepEqual(used,ids,`${locale}: every category has an initially available entry`);
 }
});
