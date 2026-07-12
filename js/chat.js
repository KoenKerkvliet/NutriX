/* ============================================
   BRIGHTLY - Coach (chatbot op Claude Haiku 4.5, met tool use)
   Praat, motiveert, en logt echt voeding + activiteiten via de edge function `chat`.
   ============================================ */

const $ = (id) => document.getElementById(id);

let userId = null;
const messages = [];   // { role: 'user'|'assistant', content: string } — alleen tekstbeurten
let busy = false;

const GREETING =
  'Hoi! Ik ben je Brightly-coach. Vertel me gerust wat je hebt gegeten of gedronken, of welke beweging je hebt gedaan — dan log ik het meteen voor je. Vraag ook gerust hoe je ervoor staat vandaag. 🌱';

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function scrollDown() {
  const log = $('chatLog');
  requestAnimationFrame(() => { log.scrollTop = log.scrollHeight; });
}

function addBubble(role, text) {
  const el = document.createElement('div');
  el.className = 'chat-msg ' + (role === 'user' ? 'from-me' : 'from-bot');
  el.innerHTML = `<div class="bubble">${escapeHtml(text).replace(/\n/g, '<br>')}</div>`;
  $('chatLog').appendChild(el);
  scrollDown();
  return el;
}

function addLogged(logged) {
  if (!logged || !logged.length) return;
  const parts = logged.map(l =>
    l.kind === 'activity'
      ? `${escapeHtml(l.label)} · ${l.kcal} kcal verbrand`
      : `${escapeHtml(l.label)} · ${l.kcal} kcal`);
  const el = document.createElement('div');
  el.className = 'chat-logged';
  el.innerHTML = '✓ Toegevoegd: ' + parts.join(' · ');
  $('chatLog').appendChild(el);
  scrollDown();
}

function typingBubble() {
  const el = document.createElement('div');
  el.className = 'chat-msg from-bot';
  el.innerHTML = '<div class="bubble typing"><span></span><span></span><span></span></div>';
  $('chatLog').appendChild(el);
  scrollDown();
  return el;
}

async function send(text) {
  if (busy) return;
  busy = true;
  $('sendBtn').disabled = true;

  addBubble('user', text);
  messages.push({ role: 'user', content: text });

  const typing = typingBubble();
  try {
    const { data: sess } = await supabase.auth.getSession();
    const res = await fetch(`${SUPABASE_URL}/functions/v1/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sess.session.access_token}` },
      body: JSON.stringify({ messages }),
    });
    const data = await res.json();
    typing.remove();
    if (!res.ok || data.error) throw new Error(data.error || ('status ' + res.status));

    const reply = data.reply || '…';
    addBubble('assistant', reply);
    messages.push({ role: 'assistant', content: reply });
    addLogged(data.logged);
  } catch (e) {
    typing.remove();
    addBubble('assistant', '⚠️ Er ging iets mis: ' + String(e.message || e));
  } finally {
    busy = false;
    $('sendBtn').disabled = false;
    $('chatInput').focus();
  }
}

function autoGrow(t) {
  t.style.height = 'auto';
  t.style.height = Math.min(t.scrollHeight, 120) + 'px';
}

(async function init() {
  const session = await requireAuth();
  if (!session) return;
  userId = session.user.id;

  addBubble('assistant', GREETING);

  const form = $('chatForm');
  const input = $('chatInput');

  input.addEventListener('input', () => autoGrow(input));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); }
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    autoGrow(input);
    send(text);
  });

  if (window.hideLoader) hideLoader();
  input.focus();
})();
