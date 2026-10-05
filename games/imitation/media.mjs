/**
 * Lecture d'un extrait (fichier vidéo ou YouTube) et enregistrement micro.
 *
 * Le calage image/voix repose sur un principe simple : l'enregistrement
 * démarre quand la vidéo commence VRAIMENT à jouer (événement « playing »),
 * et la relecture démarre la voix au même signal. Le petit délai de
 * démarrage de la vidéo est ainsi le même des deux côtés.
 */

let youtubeApi = null;

/** Une vidéo qui ne démarre pas (lecture automatique bloquée, réseau) ne doit pas figer l'écran. */
function withTimeout(promise, ms = 8_000) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('La vidéo ne démarre pas. Clique sur « Voir l’extrait », puis réessaie.')), ms))]);
}

function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (!youtubeApi) {
    youtubeApi = new Promise((resolve, reject) => {
      const previous = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { previous?.(); resolve(window.YT); };
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.onerror = () => { youtubeApi = null; reject(new Error('Impossible de charger YouTube.')); };
      document.head.append(script);
    });
  }
  return youtubeApi;
}

/**
 * Crée un lecteur d'extrait dans `container`.
 * play({ muted }) résout quand l'image bouge ; onEnd(cb) est appelé à la fin
 * de l'extrait (la vidéo est alors mise en pause sur la dernière image).
 */
export async function createClipPlayer(container, clip) {
  container.replaceChildren();
  const listeners = new Set();
  let watching = 0;
  const fireEnd = () => listeners.forEach(callback => callback());

  if (clip.kind === 'file') {
    const video = document.createElement('video');
    video.src = clip.url;
    video.playsInline = true;
    video.preload = 'auto';
    video.className = 'clip-video';
    container.append(video);
    await new Promise((resolve, reject) => {
      if (video.readyState >= 1) return resolve();
      video.addEventListener('loadedmetadata', resolve, { once:true });
      video.addEventListener('error', () => reject(new Error('Vidéo introuvable ou illisible.')), { once:true });
    });
    video.currentTime = clip.start;
    const watch = () => {
      if (video.currentTime >= clip.end - 0.04 || video.ended) { video.pause(); watching = 0; fireEnd(); return; }
      watching = requestAnimationFrame(watch);
    };
    return {
      async play({ muted = false } = {}) {
        cancelAnimationFrame(watching);
        video.pause();
        video.muted = muted;
        video.currentTime = clip.start;
        const started = new Promise(resolve => video.addEventListener('playing', resolve, { once:true }));
        await withTimeout(video.play().then(() => started));
        watching = requestAnimationFrame(watch);
      },
      stop() { cancelAnimationFrame(watching); video.pause(); video.currentTime = clip.start; },
      onEnd(callback) { listeners.add(callback); return () => listeners.delete(callback); },
      destroy() { cancelAnimationFrame(watching); video.pause(); video.removeAttribute('src'); video.load(); container.replaceChildren(); },
    };
  }

  const YT = await loadYouTubeApi();
  const host = document.createElement('div');
  container.append(host);
  let resolvePlaying = null;
  let rejectPlaying = null;
  const youtubeError = code => new Error([101, 150, 153].includes(code)
    ? 'Le propriétaire de cette vidéo YouTube interdit sa lecture hors de YouTube : choisis-en une autre.'
    : 'Cette vidéo YouTube ne peut pas être lue (supprimée ou privée ?).');
  const player = await new Promise((resolve, reject) => {
    let ready = false;
    const instance = new YT.Player(host, {
      videoId:clip.youtubeId,
      playerVars:{ start:Math.floor(clip.start), controls:0, disablekb:1, modestbranding:1, rel:0, playsinline:1, iv_load_policy:3, fs:0 },
      events:{
        onReady:() => { ready = true; resolve(instance); },
        // YouTube signale souvent le refus d'intégration seulement au lancement de la lecture.
        onError:event => {
          if (!ready) reject(youtubeError(event.data));
          else if (rejectPlaying) { rejectPlaying(youtubeError(event.data)); rejectPlaying = null; resolvePlaying = null; }
        },
        onStateChange:event => {
          if (event.data === YT.PlayerState.PLAYING && resolvePlaying) { resolvePlaying(); resolvePlaying = null; rejectPlaying = null; }
          if (event.data === YT.PlayerState.ENDED && watching) { clearInterval(watching); watching = 0; fireEnd(); }
        },
      },
    });
  });
  container.querySelector('iframe')?.classList.add('clip-video');
  return {
    async play({ muted = false } = {}) {
      clearInterval(watching);
      if (muted) player.mute(); else player.unMute();
      player.seekTo(clip.start, true);
      const started = new Promise((resolve, reject) => { resolvePlaying = resolve; rejectPlaying = reject; });
      player.playVideo();
      try {
        await withTimeout(started);
      } catch (error) {
        resolvePlaying = null;
        rejectPlaying = null;
        player.pauseVideo();
        throw error;
      }
      watching = setInterval(() => {
        if (player.getCurrentTime() >= clip.end - 0.06) { player.pauseVideo(); clearInterval(watching); watching = 0; fireEnd(); }
      }, 30);
    },
    stop() { clearInterval(watching); watching = 0; player.pauseVideo(); player.seekTo(clip.start, true); },
    onEnd(callback) { listeners.add(callback); return () => listeners.delete(callback); },
    destroy() { clearInterval(watching); player.destroy(); container.replaceChildren(); },
  };
}

/** Joue la vidéo en muet avec une voix par-dessus, calée sur le démarrage de l'image. */
export async function playDub(player, audioUrl) {
  const audio = new Audio(audioUrl);
  audio.preload = 'auto';
  await new Promise(resolve => {
    if (audio.readyState >= 3) return resolve();
    audio.addEventListener('canplaythrough', resolve, { once:true });
    audio.addEventListener('error', resolve, { once:true });
    setTimeout(resolve, 3_000);
  });
  await player.play({ muted:true });
  try {
    await audio.play();
  } catch (error) {
    player.stop();
    throw error;
  }
  return {
    audio,
    stop() { audio.pause(); player.stop(); },
  };
}

/* ─── Micro ─── */

let micStream = null;

export async function getMicrophone() {
  if (micStream) return micStream;
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Ce navigateur ne permet pas d’enregistrer (il faut une page en https).');
  // Traitements désactivés : l'annulation d'écho coupe la voix quand la vidéo
  // parle, la suppression de bruit hache les imitations, le gain automatique
  // fait respirer le volume.
  micStream = await navigator.mediaDevices.getUserMedia({
    audio:{ echoCancellation:false, noiseSuppression:false, autoGainControl:false, channelCount:1 },
  });
  return micStream;
}

export function releaseMicrophone() {
  micStream?.getTracks().forEach(track => track.stop());
  micStream = null;
}

function pickMimeType() {
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
    .find(type => window.MediaRecorder?.isTypeSupported?.(type)) || '';
}

/** Démarre un enregistrement ; `stop()` résout avec le Blob audio. */
export function startRecording(stream) {
  const mimeType = pickMimeType();
  // 48 kbit/s en Opus : une voix reste nette, et une prise de 45 s tient en ~270 Ko.
  const recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond:48_000 });
  const chunks = [];
  recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
  recorder.start();
  return {
    stop:() => new Promise(resolve => {
      if (recorder.state === 'inactive') return resolve(new Blob(chunks, { type:recorder.mimeType || mimeType || 'audio/webm' }));
      recorder.onstop = () => resolve(new Blob(chunks, { type:recorder.mimeType || mimeType || 'audio/webm' }));
      recorder.stop();
    }),
  };
}

/* ─── Audio ⇄ texte (stockage Firebase) ─── */

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export function base64ToObjectUrl(data, mime = 'audio/webm') {
  const bytes = Uint8Array.from(atob(data), char => char.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type:mime }));
}

/** Durée réelle d'un fichier vidéo choisi pour l'envoi. */
export function videoFileDuration(file) {
  return new Promise(resolve => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => { resolve(Number.isFinite(video.duration) ? video.duration : null); URL.revokeObjectURL(video.src); };
    video.onerror = () => resolve(null);
    video.src = URL.createObjectURL(file);
  });
}
