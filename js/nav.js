/* ============================================
   BRIGHTLY - Plus-knop menu (Voeding / Activiteit / Gewicht)
   Gedeeld op alle pagina's met een onderbalk.
   ============================================ */
// Module 'Gewoontes' → extra item in de onderbalk wanneer ingeschakeld.
(function () {
  let mods = {};
  try { mods = JSON.parse(localStorage.getItem('brightly_modules') || '{}'); } catch (e) {}
  if (!mods.gewoontes) return;
  const navEl = document.querySelector('.bottom-nav');
  if (!navEl || navEl.querySelector('a[href="gewoontes.html"]')) return;
  const a = document.createElement('a');
  a.href = 'gewoontes.html';
  if (location.pathname.split('/').pop() === 'gewoontes.html') a.className = 'active';
  a.innerHTML = '<span class="ico"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6"/></svg></span>Gewoontes';
  const profielLink = navEl.querySelector('a[href="profiel.html"]');
  navEl.insertBefore(a, profielLink || null);
})();

(function () {
  const fab = document.getElementById('fabBtn');
  if (!fab) return;

  const ICON = {
    food: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2v7c0 1.1.9 2 2 2a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/></svg>',
    act:  '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>',
    wt:   '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a3 3 0 0 1 2.8 2H19a2 2 0 0 1 2 2l-2 12a2 2 0 0 1-2 1.7H7A2 2 0 0 1 5 19L3 7a2 2 0 0 1 2-2h4.2A3 3 0 0 1 12 3Z"/><path d="m9 12 3-3 3 3"/></svg>',
    quick: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9.94 6.06 9 4 8.06 6.06 6 7l2.06.94L9 10l.94-2.06L12 7zM18 10l-.7-1.6L15.7 8l1.6-.7L18 6l.7 1.3L20.3 8l-1.6.7zM16 14l-1 2.2-2.2 1 2.2 1 1 2.2 1-2.2 2.2-1-2.2-1z"/></svg>',
  };

  const backdrop = document.createElement('div');
  backdrop.className = 'fab-menu-backdrop';

  const menu = document.createElement('div');
  menu.className = 'fab-menu';
  menu.innerHTML = `
    <div class="fab-menu-title">Toevoegen</div>
    <a href="snel-loggen.html" class="fab-item quick"><span class="fab-ico">${ICON.quick}</span>Snel loggen</a>
    <a href="loggen.html" class="fab-item food"><span class="fab-ico">${ICON.food}</span>Voeding</a>
    <a href="activiteit.html" class="fab-item act"><span class="fab-ico">${ICON.act}</span>Activiteit</a>
    <a href="gewicht.html" class="fab-item wt"><span class="fab-ico">${ICON.wt}</span>Gewicht</a>`;

  document.body.appendChild(backdrop);
  document.body.appendChild(menu);

  const open = () => { backdrop.classList.add('open'); menu.classList.add('open'); fab.classList.add('open'); };
  const close = () => { backdrop.classList.remove('open'); menu.classList.remove('open'); fab.classList.remove('open'); };

  fab.addEventListener('click', (e) => {
    e.preventDefault();
    menu.classList.contains('open') ? close() : open();
  });
  backdrop.addEventListener('click', close);
})();
