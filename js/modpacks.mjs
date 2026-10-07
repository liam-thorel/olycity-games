// Static download and guide must not depend on the portal's Firebase boot.
document.querySelectorAll('a[href="#modpack-install"]').forEach(link => {
  link.addEventListener('click', () => {
    const guide = document.getElementById('modpack-install');
    if (guide) guide.open = true;
  });
});
