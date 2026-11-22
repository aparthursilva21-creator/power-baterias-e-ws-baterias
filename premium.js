// Microinterações visuais: não altera autorização nem dados.
(() => {
  const useReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const view = document.getElementById('view');
  const panel = document.getElementById('app-shell');
  if (!view || !panel) return;
  const observer = new MutationObserver(() => {
    if (!panel.hidden && !useReducedMotion) {
      view.classList.remove('premium-enter');
      void view.offsetWidth;
      view.classList.add('premium-enter');
    }
  });
  observer.observe(view, { childList: true, subtree: false });
  document.addEventListener('pointermove', event => {
    if (panel.hidden || event.pointerType !== 'mouse') return;
    const cards = document.querySelectorAll('#app-shell .card');
    for (const card of cards) {
      const b = card.getBoundingClientRect();
      const x = event.clientX - b.left, y = event.clientY - b.top;
      if (x >= 0 && y >= 0 && x <= b.width && y <= b.height) {
        card.style.setProperty('--mx', Math.round(x) + 'px');
        card.style.setProperty('--my', Math.round(y) + 'px');
      }
    }
  }, { passive: true });
})();
