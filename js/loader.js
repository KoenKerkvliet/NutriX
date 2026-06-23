/* ============================================
   BRIGHTLY - Laad-overlay
   Toont een spinner tot de pagina z'n data heeft geladen (window.hideLoader()).
   Vangnet: verdwijnt sowieso na 6s zodat 'ie nooit blijft hangen.
   ============================================ */
(function () {
  if (window.hideLoader || document.getElementById('appLoader')) return;
  const el = document.createElement('div');
  el.id = 'appLoader';
  el.className = 'app-loader';
  el.innerHTML = '<div class="app-spinner"></div>';
  const add = () => { if (document.body && !document.getElementById('appLoader')) document.body.appendChild(el); };
  if (document.body) add(); else document.addEventListener('DOMContentLoaded', add);

  let hidden = false;
  window.hideLoader = function () {
    if (hidden) return;
    hidden = true;
    const node = document.getElementById('appLoader');
    if (!node) return;
    node.classList.add('hide');
    setTimeout(() => node.remove(), 300);
  };
  setTimeout(() => window.hideLoader(), 6000); // vangnet
})();
