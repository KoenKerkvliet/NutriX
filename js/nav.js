/* ============================================
   BRIGHTLY - Plus-knop menu (Voeding / Activiteit / Gewicht)
   Gedeeld op alle pagina's met een onderbalk.
   ============================================ */
(function () {
  const fab = document.getElementById('fabBtn');
  if (!fab) return;

  const ICON = {
    food: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2v7c0 1.1.9 2 2 2a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/></svg>',
    act:  '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>',
    wt:   '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a3 3 0 0 1 2.8 2H19a2 2 0 0 1 2 2l-2 12a2 2 0 0 1-2 1.7H7A2 2 0 0 1 5 19L3 7a2 2 0 0 1 2-2h4.2A3 3 0 0 1 12 3Z"/><path d="m9 12 3-3 3 3"/></svg>',
  };

  const backdrop = document.createElement('div');
  backdrop.className = 'fab-menu-backdrop';

  const menu = document.createElement('div');
  menu.className = 'fab-menu';
  menu.innerHTML = `
    <div class="fab-menu-title">Toevoegen</div>
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
