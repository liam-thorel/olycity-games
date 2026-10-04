#!/usr/bin/env node
/**
 * Assemble le site publié dans _site/.
 *
 * - Le portail, le SDK et les jeux en HTML natif sont copiés tels quels.
 * - Un jeu qui a un package.json (Vite, Angular, React…) est compilé :
 *   `npm ci` puis `npm run build`, avec OLYCITY_BASE=/games/<slug>/ dans
 *   l'environnement pour régler le chemin de base. Seul son dossier de sortie
 *   est publié (`dist` par défaut, ou `"olycity": { "output": "…" }` dans son
 *   package.json).
 *
 * Usage : node scripts/build.mjs [--skip-install]
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const OUT = join(ROOT, '_site');
const STATIC = ['index.html', '404.html', 'CNAME', '.nojekyll', 'manifest.webmanifest', 'config.js', 'assets', 'css', 'js', 'sdk'];
const SKIP_IN_GAMES = new Set(['node_modules', '.angular', '.vite', 'dist']);

export function readRegistry(root = ROOT) {
  return JSON.parse(readFileSync(join(root, 'games', 'registry.json'), 'utf8'));
}

/** Décrit comment publier chaque dossier de games/. */
export function gameBuilds(root = ROOT) {
  const dir = join(root, 'games');
  return readdirSync(dir).filter(name => statSync(join(dir, name)).isDirectory()).map(slug => {
    const path = join(dir, slug);
    const pkgPath = join(path, 'package.json');
    if (!existsSync(pkgPath)) return { slug, path, kind:'static' };
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    return { slug, path, kind:'npm', output:join(path, pkg.olycity?.output || 'dist'), hasLock:existsSync(join(path, 'package-lock.json')) };
  });
}

/** Les jeux jouables du registre doivent exister, sinon le portail afficherait un lien mort. */
export function validateRegistry(registry, builds) {
  const errors = [];
  const slugs = new Set(builds.map(build => build.slug));
  const seen = new Set();
  for (const game of registry) {
    if (!/^[a-z0-9-]+$/.test(game.slug || '')) errors.push(`slug invalide : ${JSON.stringify(game.slug)}`);
    if (seen.has(game.slug)) errors.push(`slug en double : ${game.slug}`);
    seen.add(game.slug);
    if (!['live', 'beta', 'soon', 'dev'].includes(game.status)) errors.push(`${game.slug} : statut inconnu ${game.status}`);
    if (game.status !== 'soon' && !slugs.has(game.slug)) errors.push(`${game.slug} : dossier games/${game.slug}/ introuvable`);
    if (!game.name || !game.tagline) errors.push(`${game.slug} : name et tagline sont obligatoires`);
  }
  return errors;
}

function build({ skipInstall = false } = {}) {
  const registry = readRegistry();
  const builds = gameBuilds();
  const errors = validateRegistry(registry, builds);
  if (errors.length) {
    console.error(`Registre des jeux invalide :\n- ${errors.join('\n- ')}`);
    process.exit(1);
  }

  rmSync(OUT, { recursive:true, force:true });
  mkdirSync(join(OUT, 'games'), { recursive:true });
  for (const entry of STATIC) {
    if (existsSync(join(ROOT, entry))) cpSync(join(ROOT, entry), join(OUT, entry), { recursive:true });
  }
  cpSync(join(ROOT, 'games', 'registry.json'), join(OUT, 'games', 'registry.json'));

  for (const game of builds) {
    const target = join(OUT, 'games', game.slug);
    if (game.kind === 'static') {
      cpSync(game.path, target, { recursive:true, filter:source => !SKIP_IN_GAMES.has(source.split(/[\\/]/).pop()) });
      console.log(`✓ ${game.slug} (statique)`);
      continue;
    }
    const env = { ...process.env, OLYCITY_BASE:`/games/${game.slug}/` };
    if (!skipInstall) execSync(game.hasLock ? 'npm ci' : 'npm install', { cwd:game.path, stdio:'inherit', env });
    execSync('npm run build', { cwd:game.path, stdio:'inherit', env });
    if (!existsSync(game.output)) {
      console.error(`${game.slug} : dossier de sortie introuvable (${game.output}). Renseigne "olycity.output" dans son package.json.`);
      process.exit(1);
    }
    cpSync(game.output, target, { recursive:true });
    console.log(`✓ ${game.slug} (compilé)`);
  }
  console.log(`Site assemblé dans ${OUT}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  build({ skipInstall:process.argv.includes('--skip-install') });
}
