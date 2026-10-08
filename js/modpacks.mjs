// Independent of Firebase: the guide always works, including without sign-in.
const guide = document.getElementById('modpack-install');
const toggles = document.querySelectorAll('[data-modpack-guide-toggle]');
function syncGuideButtons() {
  toggles.forEach(button => {
    button.setAttribute('aria-expanded', String(!!guide?.open));
    button.textContent = guide?.open ? 'Refermer les instructions' : 'Comment l’installer';
  });
}
if (guide) {
  if (location.hash === '#modpack-install') guide.open = true;
  toggles.forEach(button => button.addEventListener('click', () => {
    guide.open = !guide.open;
    syncGuideButtons();
    if (guide.open) guide.scrollIntoView({ block: 'start' });
  }));
  document.querySelectorAll('[data-modpack-guide-close]').forEach(button => {
    button.addEventListener('click', () => {
      guide.open = false;
      syncGuideButtons();
      const toggle = toggles[0];
      if (toggle) {
        toggle.focus({ preventScroll: true });
        toggle.scrollIntoView({ block: 'nearest' });
      }
    });
  });
  guide.addEventListener('toggle', syncGuideButtons);
  syncGuideButtons();
}
