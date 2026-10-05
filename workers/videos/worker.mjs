/**
 * olycity-videos : hébergement des vidéos de The Imitation Game sur Cloudflare R2.
 *
 *   POST   /upload        envoie un fichier (corps brut, Authorization: Bearer <UPLOAD_TOKEN>)
 *   GET    /v/<clé>       lit une vidéo, avec prise en charge des plages (lecture et saut)
 *   DELETE /v/<clé>       supprime une vidéo (même jeton)
 *
 * R2 : 10 Go gratuits et bande passante sortante gratuite, ce qui compte quand
 * tout le groupe regarde la même vidéo en même temps.
 */

const MAX_BYTES = 100 * 1024 * 1024;
const EXTENSIONS = { 'video/mp4':'mp4', 'video/webm':'webm', 'video/quicktime':'mov', 'video/ogg':'ogv' };

export function siteOrigins(env) {
  return String(env?.SITE_ORIGIN || 'https://games.olycity.fr').split(',').map(origin => origin.trim()).filter(Boolean);
}

export function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = siteOrigins(env).includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return {
    'Access-Control-Allow-Origin':allowed ? origin : siteOrigins(env)[0],
    'Access-Control-Allow-Methods':'GET, HEAD, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers':'Authorization, Content-Type, Range',
    'Access-Control-Expose-Headers':'Content-Length, Content-Range, Accept-Ranges',
    Vary:'Origin',
  };
}

const json = (body, status, headers) => new Response(JSON.stringify(body), {
  status, headers:{ ...headers, 'Content-Type':'application/json; charset=utf-8' },
});

/** Comparaison à temps constant, pour ne pas laisser deviner le jeton caractère par caractère. */
export function tokenMatches(given = '', expected = '') {
  if (!expected) return false;
  let diff = given.length ^ expected.length;
  for (let index = 0; index < expected.length; index += 1) {
    diff |= (given.charCodeAt(index) || 0) ^ expected.charCodeAt(index);
  }
  return diff === 0;
}

export function isValidKey(key = '') {
  return /^[a-z0-9]{6,40}\.(mp4|webm|mov|ogv)$/.test(key);
}

function authorized(request, env) {
  const header = request.headers.get('Authorization') || '';
  return tokenMatches(header.replace(/^Bearer\s+/i, ''), String(env.UPLOAD_TOKEN || ''));
}

export async function handleRequest(request, env) {
  const cors = corsHeaders(request, env);
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') return new Response(null, { status:204, headers:cors });

  if (url.pathname === '/upload' && request.method === 'POST') {
    if (!authorized(request, env)) return json({ error:'Code d’envoi incorrect.' }, 401, cors);
    const type = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
    const extension = EXTENSIONS[type];
    if (!extension) return json({ error:'Format non pris en charge (MP4, WebM, MOV).' }, 415, cors);
    const length = Number(request.headers.get('Content-Length') || 0);
    if (length > MAX_BYTES) return json({ error:'Fichier trop lourd (100 Mo max).' }, 413, cors);
    const key = `${Date.now().toString(36)}${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}.${extension}`;
    await env.BUCKET.put(key, request.body, { httpMetadata:{ contentType:type, cacheControl:'public, max-age=31536000, immutable' } });
    return json({ key, url:`${url.origin}/v/${key}` }, 201, cors);
  }

  const match = url.pathname.match(/^\/v\/([^/]+)$/);
  if (match) {
    const key = match[1];
    if (!isValidKey(key)) return json({ error:'Vidéo introuvable.' }, 404, cors);
    if (request.method === 'DELETE') {
      if (!authorized(request, env)) return json({ error:'Code d’envoi incorrect.' }, 401, cors);
      await env.BUCKET.delete(key);
      return new Response(null, { status:204, headers:cors });
    }
    if (request.method === 'GET' || request.method === 'HEAD') {
      // `range` et `onlyIf` lisent directement les en-têtes Range / If-None-Match.
      const object = await env.BUCKET.get(key, { range:request.headers, onlyIf:request.headers });
      if (!object) return json({ error:'Vidéo introuvable.' }, 404, cors);
      const headers = new Headers(cors);
      object.writeHttpMetadata(headers);
      headers.set('ETag', object.httpEtag);
      headers.set('Accept-Ranges', 'bytes');
      if (!('body' in object)) return new Response(null, { status:304, headers });
      let status = 200;
      if (object.range && request.headers.has('Range')) {
        const offset = object.range.offset ?? 0;
        const length = object.range.length ?? object.size - offset;
        headers.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${object.size}`);
        headers.set('Content-Length', String(length));
        status = 206;
      } else {
        headers.set('Content-Length', String(object.size));
      }
      return new Response(request.method === 'HEAD' ? null : object.body, { status, headers });
    }
  }
  return json({ error:'Introuvable.' }, 404, cors);
}

export default { fetch:handleRequest };
