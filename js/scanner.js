/* ============================================
   BRIGHTLY - Barcode scanner (camera)
   Gebruikt ZXing (via CDN). Opent een overlay met
   het camerabeeld en roept onDetected(code) aan.
   ============================================ */

let _zxControls = null;

function _buildOverlay() {
  let el = document.getElementById('scanOverlay');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'scanOverlay';
  el.innerHTML = `
    <div class="scan-head">
      <span>Richt op de streepjescode</span>
      <button id="scanClose" class="scan-close" aria-label="Sluiten">✕</button>
    </div>
    <video id="scanVideo" playsinline muted></video>
    <div class="scan-frame"></div>
    <div id="scanMsg" class="scan-msg">Camera starten…</div>`;
  document.body.appendChild(el);
  return el;
}

/** Start de scanner. onDetected krijgt de barcode-string. */
async function startScanner(onDetected) {
  if (!window.ZXingBrowser) {
    alert('Scanner-bibliotheek kon niet laden. Controleer je internetverbinding.');
    return;
  }
  const overlay = _buildOverlay();
  overlay.classList.add('open');
  const video = document.getElementById('scanVideo');
  const msg = document.getElementById('scanMsg');
  document.getElementById('scanClose').onclick = stopScanner;

  try {
    const reader = new ZXingBrowser.BrowserMultiFormatReader();
    msg.textContent = 'Zoeken naar een streepjescode…';
    _zxControls = await reader.decodeFromConstraints(
      { video: { facingMode: { ideal: 'environment' } } },
      video,
      (result) => {
        if (result) {
          const code = result.getText();
          stopScanner();
          if (typeof navigator.vibrate === 'function') navigator.vibrate(60);
          onDetected(code);
        }
      }
    );
  } catch (err) {
    msg.textContent = 'Geen toegang tot de camera. Geef toestemming en probeer opnieuw.';
    console.error(err);
  }
}

function stopScanner() {
  if (_zxControls) { try { _zxControls.stop(); } catch (e) {} _zxControls = null; }
  const overlay = document.getElementById('scanOverlay');
  if (overlay) overlay.classList.remove('open');
}
