/* Turflijst – Racing Mechelen
 * Vanilla JS. Gegevens in Supabase; turven gaan eerst in een lokale wachtrij (IndexedDB)
 * en worden gesynchroniseerd zodra er internet is.
 */
(function () {
'use strict';

const CFG = window.TURFLIJST_CONFIG || {};
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const byNaam = (a, b) => a.naam.localeCompare(b.naam, 'nl', { sensitivity: 'base' });
const byVolgorde = (a, b) => (a.volgorde - b.volgorde) || byNaam(a, b);
const plural = (n, een, meer) => `${n} ${n === 1 ? een : meer}`;
const V1_KEY = 'racing-drankenlijst-v1';
const APP_URL = location.origin + location.pathname.replace(/index\.html$/, '');

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/* ------------------------------------------------------------------ lokale opslag (IndexedDB) */
const DB = (() => {
  let dbp = null;
  function open() {
    if (!dbp) dbp = new Promise((res, rej) => {
      const r = indexedDB.open('turflijst', 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore('kv');
        r.result.createObjectStore('queue', { keyPath: 'seq' });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  async function run(store, mode, fn) {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction(store, mode);
      const req = fn(t.objectStore(store));
      t.oncomplete = () => res(req ? req.result : undefined);
      t.onerror = t.onabort = () => rej(t.error);
    });
  }
  return {
    get: k => run('kv', 'readonly', s => s.get(k)),
    set: (k, v) => run('kv', 'readwrite', s => s.put(v, k)),
    del: k => run('kv', 'readwrite', s => s.delete(k)),
    queue: () => run('queue', 'readonly', s => s.getAll()),
    qPut: op => run('queue', 'readwrite', s => s.put(op)),
    qDel: seq => run('queue', 'readwrite', s => s.delete(seq)),
    qClear: () => run('queue', 'readwrite', s => s.clear()),
  };
})();
let canStore = true;
function storeFail(e) {
  console.warn('Lokale opslag mislukt', e);
  if (canStore) { canStore = false; $('#storeWarn').hidden = false; }
}

/* ------------------------------------------------------------------ toestand */
const S = {
  user: null, rol: null,
  groups: [], players: [], drinks: [],
  open: [],          // open turven zoals laatst van de server gehaald
  queue: [],         // wachtende wijzigingen: {seq, kind:'add'|'del', entry}
  mine: { players: [], open: [], settlements: [] },
  failed: [],        // wijzigingen die de server definitief weigerde
  online: navigator.onLine, syncing: false, lastFetch: 0, lastSync: 0,
};
let effCache = null;
const dirty = () => { effCache = null; };
/* Open turven zoals de gebruiker ze moet zien: server + wachtende toevoegingen − wachtende verwijderingen. */
function eff() {
  if (effCache) return effCache;
  const del = new Set(S.queue.filter(o => o.kind === 'del').map(o => o.entry.id));
  const list = S.open.filter(e => !del.has(e.id));
  const have = new Set(list.map(e => e.id));
  for (const o of S.queue) {
    if (o.kind === 'add' && !del.has(o.entry.id) && !have.has(o.entry.id)) list.push({ ...o.entry, pending: true });
  }
  return (effCache = list);
}
const pById = id => S.players.find(p => p.id === id) || S.mine.players.find(p => p.id === id);
const dById = id => S.drinks.find(d => d.id === id);
const dName = id => (dById(id) || { naam: '?' }).naam;
function countsBy(list, key) { const c = {}; for (const e of list) c[e[key]] = (c[e[key]] || 0) + 1; return c; }
const playerOpen = pid => eff().filter(e => e.player_id === pid);
const guestGroup = () => S.groups.find(g => /gast/i.test(g.naam));
const activeDrinks = () => S.drinks.filter(d => d.actief).sort(byVolgorde);

/* ------------------------------------------------------------------ service worker (installeerbaar + offline openen) */
if ('serviceWorker' in navigator) {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(e => console.warn('Service worker niet geregistreerd', e)));
}

/* ------------------------------------------------------------------ Supabase */
if (!CFG.SUPABASE_URL || !CFG.SUPABASE_PUBLISHABLE_KEY || !window.supabase) {
  $('#cfgWarn').hidden = false;
  return;
}
const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit', storageKey: 'turflijst-auth' },
});

function isNetErr(err, status) {
  if (status === 0 || !navigator.onLine) return true;
  const m = String((err && (err.message || err)) || '');
  return /failed to fetch|networkerror|load failed|network request failed|fetch/i.test(m) && !status;
}
function transient(res) {
  const st = res.status;
  return isNetErr(res.error, st) || st === 401 || st === 408 || st === 429 || st >= 500;
}
async function fetchAll(make) {
  const out = []; const step = 1000;
  for (let from = 0; ; from += step) {
    const { data, error } = await make().range(from, from + step - 1);
    if (error) throw error;
    out.push(...data);
    if (data.length < step) return out;
  }
}

/* ------------------------------------------------------------------ cache per gebruiker */
const cacheKey = () => 'cache:' + S.user.id;
function persistCache() {
  if (!S.user) return;
  const c = { rol: S.rol, groups: S.groups, players: S.players, drinks: S.drinks, open: S.open, mine: S.mine, lastFetch: S.lastFetch };
  DB.set(cacheKey(), c).catch(storeFail);
}
function applyCache(c) {
  Object.assign(S, { rol: c.rol, groups: c.groups || [], players: c.players || [], drinks: c.drinks || [],
    open: c.open || [], mine: c.mine || { players: [], open: [], settlements: [] }, lastFetch: c.lastFetch || 0 });
  dirty();
}

/* ------------------------------------------------------------------ gegevens ophalen */
let syncGen = 0, refreshP = null;
function refresh() { if (!refreshP) refreshP = doRefresh().finally(() => { refreshP = null; }); return refreshP; }
async function doRefresh(tries = 0) {
  if (!S.user) return;
  const gen = syncGen;
  try {
    const { data: prof, error } = await sb.from('profiles').select('rol').eq('user_id', S.user.id).maybeSingle();
    if (error) throw error;
    const rol = prof ? prof.rol : 'speler';
    let groups = [], players = [], drinks = [], open = [], mine = { players: [], open: [], settlements: [] };
    if (rol === 'beheerder') {
      [groups, players, drinks, open] = await Promise.all([
        fetchAll(() => sb.from('groups').select('id,naam,volgorde').order('volgorde').order('id')),
        fetchAll(() => sb.from('players').select('id,naam,group_id,email,user_id,actief').order('naam').order('id')),
        fetchAll(() => sb.from('drinks').select('id,naam,volgorde,actief').order('volgorde').order('id')),
        fetchAll(() => sb.from('entries').select('id,player_id,drink_id,created_at').is('settlement_id', null).order('created_at').order('id')),
      ]);
      mine.players = players.filter(p => p.user_id === S.user.id);
    } else {
      [mine.players, drinks] = await Promise.all([
        fetchAll(() => sb.from('players').select('id,naam,group_id,email,user_id,actief').order('naam').order('id')),
        fetchAll(() => sb.from('drinks').select('id,naam,volgorde,actief').order('volgorde').order('id')),
      ]);
      if (mine.players.length) {
        mine.open = await fetchAll(() => sb.from('entries').select('id,player_id,drink_id,created_at').is('settlement_id', null).order('created_at').order('id'));
      }
    }
    if (mine.players.length) {
      mine.settlements = await fetchAll(() => sb.from('settlements')
        .select('id,player_id,settled_at,opmerking,entries(drink_id)')
        .in('player_id', mine.players.map(p => p.id))
        .order('settled_at', { ascending: false }).order('id'));
    }
    // Is er intussen iets gesynchroniseerd? Dan opnieuw ophalen, anders verdwijnt een turf even.
    if (gen !== syncGen && tries < 3) return doRefresh(tries + 1);
    Object.assign(S, { rol, groups, players, drinks, open, mine, lastFetch: Date.now() });
    dirty(); persistCache(); setNet(true);
  } catch (e) {
    if (isNetErr(e)) setNet(false);
    else { console.error(e); toast('Laden mislukt: ' + (e.message || e)); }
  }
  renderApp();
}

/* ------------------------------------------------------------------ wachtrij + synchronisatie */
let seqN = 0;
const nextSeq = () => Date.now() * 1000 + (seqN++ % 1000);
const inFlight = new Set();
async function enqueue(kind, entry) {
  const op = { seq: nextSeq(), kind, entry, user: S.user.id };
  S.queue.push(op); dirty();
  try { await DB.qPut(op); } catch (e) { storeFail(e); }
  renderStatus();
  sync();
}
let syncP = null;
function sync() { if (!syncP) syncP = doSync().finally(() => { syncP = null; renderStatus(); }); return syncP; }
async function doSync() {
  if (!S.user || S.rol !== 'beheerder' || !S.queue.length) return;
  S.syncing = true; renderStatus();
  try {
    while (S.queue.length) {
      if (!navigator.onLine) { setNet(false); return; }
      const op = S.queue[0];
      inFlight.add(op.seq);
      let res;
      try {
        res = op.kind === 'add'
          ? await sb.from('entries').upsert(
              { id: op.entry.id, player_id: op.entry.player_id, drink_id: op.entry.drink_id, created_at: op.entry.created_at },
              { onConflict: 'id', ignoreDuplicates: true })
          : await sb.from('entries').delete().eq('id', op.entry.id).is('settlement_id', null);
      } catch (e) {
        res = { error: e, status: 0 };
      } finally {
        inFlight.delete(op.seq);
      }
      if (res.error) {
        if (transient(res)) {
          if (res.status === 401) await sb.auth.refreshSession().catch(() => {});
          setNet(!isNetErr(res.error, res.status));
          return;
        }
        console.warn('Wijziging geweigerd', op, res.error);
        S.failed.push({ op, msg: res.error.message });
      } else if (op.kind === 'add') {
        if (!S.open.some(e => e.id === op.entry.id)) S.open.push(op.entry);
      } else {
        S.open = S.open.filter(e => e.id !== op.entry.id);
      }
      const i = S.queue.findIndex(o => o.seq === op.seq);
      if (i >= 0) S.queue.splice(i, 1);
      syncGen++; dirty();
      DB.qDel(op.seq).catch(storeFail);
      setNet(true);
    }
    S.lastSync = Date.now();
    persistCache();
  } finally {
    S.syncing = false;
    renderLight();
  }
}

/* ------------------------------------------------------------------ netwerkstatus */
function setNet(on) { if (S.online !== on) { S.online = on; renderStatus(); } }
addEventListener('online', () => { setNet(true); sync().then(() => refresh()); });
addEventListener('offline', () => setNet(false));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && S.user && navigator.onLine) sync().then(() => refresh());
});
setInterval(() => {
  if (!S.user || document.visibilityState !== 'visible' || !navigator.onLine) return;
  sync().then(() => { if (Date.now() - S.lastFetch > 60000) refresh(); });
}, 20000);

function renderStatus() {
  const b = $('#sync');
  if (!S.user) { b.hidden = true; return; }
  b.hidden = false;
  const n = S.queue.length, online = S.online && navigator.onLine;
  let cls = '', txt;
  if (S.failed.length) { cls = 'err'; txt = `${S.failed.length} mislukt`; }
  else if (!online) { cls = 'off'; txt = n ? `Offline · ${n}` : 'Offline'; }
  else if (S.syncing || n) { cls = 'busy'; txt = n ? `Sync · ${n}` : 'Sync…'; }
  else txt = 'Online';
  b.className = 'sync ' + cls;
  $('#syncTxt').textContent = txt;
}
$('#sync').onclick = () => {
  const n = S.queue.length;
  const t = ts => ts ? fmtDate(ts, true) : 'nog niet';
  let h = `<h3>Synchronisatie</h3><p class="muted">${S.online && navigator.onLine ? 'Er is internet.' : 'Geen internet. Turven worden bewaard op dit toestel en later verstuurd.'}</p>
    <p>Wachtende turven: <b>${n}</b><br>Laatst opgehaald: ${t(S.lastFetch)}</p>`;
  if (S.failed.length) {
    h += `<p class="banner">${plural(S.failed.length, 'wijziging werd', 'wijzigingen werden')} door de server geweigerd en niet opgeslagen:<br>` +
      S.failed.map(f => `${f.op.kind === 'add' ? '+1' : '−1'} ${esc(dName(f.op.entry.drink_id))} voor ${esc((pById(f.op.entry.player_id) || {}).naam || '?')}: ${esc(f.msg)}`).join('<br>') + '</p>';
  }
  dialog(h, S.failed.length ? 'Gezien' : 'Nu synchroniseren', () => {
    S.failed = [];
    sync().then(() => refresh());
  });
};

/* ------------------------------------------------------------------ login */
function showLogin() {
  S.user = null; renderStatus();
  $('#nav').hidden = true; document.body.classList.add('nonav');
  $('#sub').textContent = '';
  $('#fLogin').hidden = false; $('#lStep2').hidden = true;
  showView('login');
}
let loginEmail = '';
$('#fLogin').onsubmit = async ev => {
  ev.preventDefault();
  loginEmail = $('#lEmail').value.trim().toLowerCase();
  if (!loginEmail) return;
  $('#lSend').disabled = true;
  const { error } = await sb.auth.signInWithOtp({ email: loginEmail, options: { emailRedirectTo: APP_URL, shouldCreateUser: true } });
  $('#lSend').disabled = false;
  if (error) return toast(/rate|limit|seconds/i.test(error.message) ? 'Even wachten voor je een nieuwe mail vraagt' : 'Mail versturen mislukt: ' + error.message);
  $('#lTo').textContent = loginEmail; $('#fLogin').hidden = true; $('#lStep2').hidden = false;
  $('#lCode').value = ''; $('#lCode').focus();
};
$('#fCode').onsubmit = async ev => {
  ev.preventDefault();
  const token = $('#lCode').value.replace(/\s/g, '');
  if (!token) return;
  $('#lVerify').disabled = true;
  const { error } = await sb.auth.verifyOtp({ email: loginEmail, token, type: 'email' });
  $('#lVerify').disabled = false;
  if (error) toast('Code klopt niet of is verlopen');
};
$('#lBack').onclick = () => { $('#fLogin').hidden = false; $('#lStep2').hidden = true; };

async function logout() {
  const doIt = async () => {
    try { await DB.qClear(); if (S.user) await DB.del(cacheKey()); } catch (e) { /* niets */ }
    S.queue = []; S.failed = []; dirty();
    await sb.auth.signOut({ scope: 'local' }).catch(() => {});
    showLogin();
  };
  if (S.queue.length) ask(`Er ${S.queue.length === 1 ? 'is nog 1 turf' : `zijn nog ${S.queue.length} turven`} niet gesynchroniseerd. Als je nu uitlogt, gaan ze verloren.`, 'Toch uitloggen', doIt);
  else doIt();
}

/* ------------------------------------------------------------------ opstarten */
async function start(user) {
  if (S.user && S.user.id === user.id) return;
  S.user = user;
  // Vraag de browser om de lokale opslag (met de wachtrij) niet zomaar op te ruimen.
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  $$('.meEmail').forEach(el => { el.textContent = user.email || ''; });
  try {
    S.queue = (await DB.queue()).filter(o => o.user === user.id).sort((a, b) => a.seq - b.seq);
    const c = await DB.get(cacheKey());
    if (c) applyCache(c);
  } catch (e) { storeFail(e); }
  dirty();
  if (S.rol) renderApp(); else showView('laden');
  renderStatus();
  await refresh();
  sync();
}

/* ------------------------------------------------------------------ navigatie */
let curView = null;
function showView(v) {
  curView = v;
  $$('.view').forEach(s => s.classList.toggle('on', s.id === 'v-' + v));
  $$('#nav button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
}
function go(v) {
  showView(v);
  if (v === 'over') { renderOver(); loadHist(); }
  if (v === 'set') renderSet();
  if (v === 'turf') renderGrid();
  if (v === 'mijn') renderMijn();
  scrollTo(0, 0);
}
function renderApp() {
  if (!S.user) return;
  if (!S.rol) { // nog nooit gegevens kunnen ophalen op dit toestel
    $('#v-laden').innerHTML = `<p class="empty">${S.online && navigator.onLine ? 'Laden…' : 'Geen internet. Open de app één keer met internet; daarna werkt ze ook offline.'}</p>`;
    showView('laden'); renderStatus(); return;
  }
  const beh = S.rol === 'beheerder';
  const mine = S.mine.players.length > 0;
  const tabs = beh
    ? [['turf', 'turf', 'Turven'], ['over', 'over', 'Overzicht'], ...(mine ? [['mijn', 'mijn', 'Rekening']] : []), ['set', 'set', 'Beheer']]
    : [];
  const nav = $('#nav');
  // Met 4 tabs is er op 360px geen plaats voor icoon + tekst: dan enkel tekst.
  nav.innerHTML = tabs.map(([v, ic, t]) => `<button data-v="${v}">${tabs.length < 4 ? ICONS[ic] : ''}${t}</button>`).join('');
  nav.hidden = !tabs.length; document.body.classList.toggle('nonav', !tabs.length);
  $$('#nav button').forEach(b => { b.onclick = () => go(b.dataset.v); });
  $('#mijnAcc').hidden = beh;
  let v = curView;
  if (beh) { if (!tabs.some(t => t[0] === v)) v = 'turf'; }
  else v = S.mine.players.length ? 'mijn' : 'wacht';
  if (v !== curView) go(v); else { showView(v); renderCurrent(); }
  renderSub(); renderStatus();
}
function renderCurrent() {
  if (curView === 'turf') renderGrid();
  if (curView === 'over') renderOver();
  if (curView === 'set') renderSet();
  if (curView === 'mijn') renderMijn();
  if (cur) renderSheet();
}
/* na een sync: enkel tellers bijwerken, niet de hele pagina (invoervelden blijven staan) */
function renderLight() {
  renderSub();
  if (curView === 'turf') renderGrid();
  if (curView === 'over') renderOver();
  if (curView === 'mijn') renderMijn();
  if (cur) renderSheet();
}
document.addEventListener('click', ev => {
  const a = ev.target.closest('[data-act]');
  if (!a) return;
  if (a.dataset.act === 'logout') logout();
  if (a.dataset.act === 'refresh') refresh();
});

function renderSub() {
  if (S.rol === 'beheerder') {
    const n = eff().length;
    $('#sub').textContent = n ? `${plural(n, 'drankje', 'drankjes')} open` : 'Alles afgerekend';
  } else $('#sub').textContent = 'Mijn rekening';
}

/* ------------------------------------------------------------------ hulp: datums */
function fmtDate(ts, withTime = true) {
  const d = new Date(ts), now = new Date();
  const o = { day: 'numeric', month: 'short' };
  if (d.getFullYear() !== now.getFullYear()) o.year = 'numeric';
  if (withTime) { o.hour = '2-digit'; o.minute = '2-digit'; }
  return d.toLocaleString('nl-BE', o);
}

/* lijn-iconen voor de onderbalk (scherper dan emoji in fel licht) */
const svg = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICONS = {
  turf: svg('<path d="M5 4v16M9.5 4v16M14 4v16M18.5 4v16M3 15l18-6"/>'),
  over: svg('<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>'),
  mijn: svg('<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>'),
  set: svg('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>'),
};

/* ------------------------------------------------------------------ turven */
$('#q').oninput = renderGrid;
const GROUP_KEY = 'turflijst-groep';
let curGroup = (() => { try { return localStorage.getItem(GROUP_KEY); } catch (e) { return null; } })();
function groupedPlayers(list) {
  const gs = [...S.groups].sort(byVolgorde);
  const out = gs.map(g => ({ g, ps: list.filter(p => p.group_id === g.id).sort(byNaam) }));
  const rest = list.filter(p => !gs.some(g => g.id === p.group_id));
  if (rest.length) out.push({ g: { id: null, naam: 'Zonder groep' }, ps: rest.sort(byNaam) });
  return out;
}
/* Turven: groepen als pillen, één groep tegelijk. Bij zoeken: resultaten uit alle groepen. */
function renderGrid() {
  const q = $('#q').value.trim().toLowerCase();
  const gs = [...S.groups].sort(byVolgorde);
  if (!gs.some(g => g.id === curGroup)) curGroup = gs.length ? gs[0].id : null;
  const cnt = countsBy(eff(), 'player_id');
  const gg = guestGroup();

  $('#gpills').innerHTML = gs.map(g => `<button class="pill${!q && g.id === curGroup ? ' on' : ''}" role="tab"
      aria-selected="${!q && g.id === curGroup}" data-g="${g.id}">${esc(g.naam)}</button>`).join('');
  $$('#gpills .pill').forEach(b => {
    b.onclick = () => {
      curGroup = b.dataset.g;
      try { localStorage.setItem(GROUP_KEY, curGroup); } catch (e) { /* niets */ }
      $('#q').value = ''; renderGrid();
    };
  });

  const card = p => {
    const t = cnt[p.id] || 0;
    return `<button class="pcard${t ? ' has' : ''}" data-p="${p.id}"><span class="nm">${esc(p.naam)}</span>${t ? `<span class="cnt" aria-label="${t} open">${t}</span>` : ''}</button>`;
  };
  const section = (g, ps, extra = '') => {
    const open = ps.reduce((n, p) => n + (cnt[p.id] || 0), 0);
    return `<div class="ghead">${esc(g.naam)}<span class="c">${open} open</span></div>
      <div class="pgrid">${ps.map(card).join('')}${extra}</div>`;
  };

  let h = '';
  if (q) {
    const list = S.players.filter(p => p.actief && p.naam.toLowerCase().includes(q));
    for (const { g, ps } of groupedPlayers(list)) if (ps.length) h += section(g, ps);
    if (!h) h = '<div class="empty">Geen speler gevonden.</div>';
  } else if (curGroup) {
    const g = gs.find(x => x.id === curGroup);
    const ps = S.players.filter(p => p.actief && p.group_id === g.id).sort(byNaam);
    const isGuest = gg && g.id === gg.id;
    h = section(g, ps, isGuest ? '<button class="pcard addguest" id="addGuest">+ Gast toevoegen</button>' : '');
    if (!ps.length && !isGuest) {
      h += `<div class="empty">${S.players.length ? 'Nog geen spelers in deze groep.' : 'Nog geen spelers. Voeg ze toe bij <b>Beheer</b>.'}</div>`;
    }
  } else {
    h = '<div class="empty">Nog geen groepen. Voeg ze toe bij <b>Beheer</b>.</div>';
  }
  $('#pgrid').innerHTML = h;
  $$('#pgrid .pcard[data-p]').forEach(b => { b.onclick = () => openSheet(b.dataset.p); });
  const ag = $('#addGuest'); if (ag) ag.onclick = addGuest;
  renderSub();
}
function needOnline(what) {
  if (navigator.onLine && S.online) return false;
  toast(`${what} kan enkel met internet`);
  return true;
}
function addGuest() {
  if (needOnline('Een gast toevoegen')) return;
  dialog(`<h3>Gast toevoegen</h3><label class="f" for="gName">Naam van de gast</label>
    <input type="text" id="gName" maxlength="60" placeholder="bv. Papa van …">`, 'Toevoegen', async () => {
    const naam = $('#gName').value.trim();
    if (!naam) return false;
    const { data, error } = await sb.from('players').insert({ naam, group_id: guestGroup().id }).select('id,naam,group_id,email,user_id,actief').single();
    if (error) { toast('Toevoegen mislukt: ' + error.message); return false; }
    S.players.push(data); persistCache(); renderGrid(); openSheet(data.id);
  }, '#gName');
}

let cur = null;
function openSheet(pid) {
  cur = pid; renderSheet();
  $('#sheet').classList.add('on'); document.body.classList.add('lock');
  $('#sheet .sbody').scrollTop = 0;
}
function closeSheet() {
  cur = null; $('#sheet').classList.remove('on'); document.body.classList.remove('lock');
  renderLight();
}
$('#sClose').onclick = closeSheet;
document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && cur && !$('#dlg').classList.contains('on')) closeSheet(); });

function renderSheet() {
  const p = pById(cur); if (!p) return closeSheet();
  $('#sName').textContent = p.naam + (p.actief ? '' : ' (archief)');
  const g = S.groups.find(x => x.id === p.group_id);
  $('#sGrp').textContent = g ? g.naam : '';
  const open = playerOpen(cur), c = countsBy(open, 'drink_id');
  $('#sTot').textContent = open.length;
  const ds = S.drinks.filter(d => d.actief || c[d.id]).sort(byVolgorde);
  $('#dgrid').innerHTML = ds.map(d => `<div class="dbtn${c[d.id] ? ' has' : ''}${d.actief ? '' : ' arch'}" data-d="${d.id}" role="button" tabindex="0">
      <span class="nm">${esc(d.naam)}</span>
      <span class="ct"><span class="num">${c[d.id] || 0}</span>
      <button class="minus" data-m="${d.id}" ${c[d.id] ? '' : 'disabled'} aria-label="Eén minder">−</button></span></div>`).join('')
    || '<div class="empty" style="grid-column:1/-1">Nog geen drankjes. Voeg ze toe bij Beheer.</div>';
  $$('#dgrid .dbtn').forEach(el => {
    el.onclick = ev => { if (ev.target.closest('.minus')) return; if (dById(el.dataset.d).actief) addTurf(cur, el.dataset.d); };
  });
  $$('#dgrid .minus').forEach(b => { b.onclick = () => removeLast(cur, b.dataset.m); });
  const t = open.length, pend = open.filter(e => e.pending).length;
  const items = ds.filter(d => c[d.id]).map(d => `<span class="chip">${c[d.id]}× ${esc(d.naam)}</span>`).join('');
  $('#sSum').innerHTML = t ? `<div class="chips">${items}</div>
    ${pend ? `<p class="pend">${pend} nog niet gesynchroniseerd.</p>` : ''}
    <button class="settle" id="sSettle">Afrekenen (${t})</button>`
    : `<p class="muted" style="margin:4px auto;text-align:center">Niets open voor ${esc(p.naam)}. Tik op een drankje om te turven.</p>`;
  const sbtn = $('#sSettle'); if (sbtn) sbtn.onclick = () => settle(cur);
}

let lastAdd = null, toastT = null;
async function addTurf(pid, did) {
  const e = { id: uuid(), player_id: pid, drink_id: did, created_at: new Date().toISOString() };
  lastAdd = e.id;
  if (navigator.vibrate) try { navigator.vibrate(15); } catch (_) { /* niets */ }
  const pr = enqueue('add', e);
  renderSheet(); renderSub();
  toast(`+1 ${dName(did)} voor ${pById(pid).naam}`, true);
  await pr;
}
async function removeEntry(id) {
  const qi = S.queue.findIndex(o => o.kind === 'add' && o.entry.id === id);
  if (qi >= 0 && !inFlight.has(S.queue[qi].seq)) {
    const [op] = S.queue.splice(qi, 1); dirty();
    DB.qDel(op.seq).catch(storeFail);
    renderStatus();
  } else {
    const e = eff().find(x => x.id === id);
    if (!e) return;
    await enqueue('del', { id: e.id, player_id: e.player_id, drink_id: e.drink_id });
  }
}
function removeLast(pid, did) {
  const list = playerOpen(pid).filter(e => e.drink_id === did).sort((a, b) => a.created_at < b.created_at ? -1 : 1);
  const e = list[list.length - 1]; if (!e) return;
  removeEntry(e.id);
  renderSheet(); renderSub(); toast(`−1 ${dName(did)}`);
}
$('#tUndo').onclick = () => {
  if (!lastAdd) return;
  removeEntry(lastAdd); lastAdd = null;
  renderLight(); hideToast();
};
function toast(msg, undo) {
  $('#tMsg').textContent = msg; $('#tUndo').style.display = undo ? '' : 'none';
  $('#toast').classList.add('on'); clearTimeout(toastT); toastT = setTimeout(hideToast, 3500);
}
function hideToast() { $('#toast').classList.remove('on'); }

/* ------------------------------------------------------------------ dialogen */
// onOk mag false teruggeven (of een promise die false geeft) om de dialoog open te houden.
function dialog(html, yesLabel, onOk, focusSel, noLabel = 'Annuleer') {
  $('#dBody').innerHTML = html;
  $('#dYes').textContent = yesLabel || 'OK';
  $('#dNo').textContent = noLabel;
  $('#dNo').hidden = noLabel === null;
  $('#dlg').classList.add('on');
  if (focusSel) setTimeout(() => { const f = $(focusSel); if (f) f.focus(); }, 50);
  const close = () => $('#dlg').classList.remove('on');
  $('#dNo').onclick = close;
  $('#dYes').disabled = false;
  $('#dYes').onclick = async () => {
    $('#dYes').disabled = true;
    try { const r = onOk ? await onOk() : undefined; if (r !== false) close(); }
    finally { $('#dYes').disabled = false; }
  };
  $('#dBody').onkeydown = ev => { if (ev.key === 'Enter' && ev.target.tagName === 'INPUT') { ev.preventDefault(); $('#dYes').click(); } };
}
const ask = (msg, yes, cb) => dialog(`<p>${msg}</p>`, yes, cb);

/* ------------------------------------------------------------------ afrekenen */
async function settle(pid) {
  if (needOnline('Afrekenen')) return;
  await sync();
  if (S.queue.some(o => o.entry.player_id === pid)) return toast('Turven worden nog gesynchroniseerd, probeer zo opnieuw');
  const p = pById(pid), open = playerOpen(pid), c = countsBy(open, 'drink_id');
  if (!open.length) return;
  const txt = S.drinks.filter(d => c[d.id]).sort(byVolgorde).map(d => `${c[d.id]}× ${esc(d.naam)}`).join(', ');
  dialog(`<h3>${esc(p.naam)} afrekenen?</h3><p class="muted">${txt} (${open.length} in totaal). De teller gaat terug naar 0.</p>
    <label class="f" for="sOpm">Opmerking (optioneel)</label><input type="text" id="sOpm" maxlength="200" placeholder="bv. betaald cash">`,
  'Afgerekend', async () => {
    const ids = open.map(e => e.id);
    const { error } = await sb.rpc('afrekenen', { p_player_id: pid, p_entry_ids: ids, p_opmerking: $('#sOpm').value.trim() || null });
    if (error) { toast('Afrekenen mislukt: ' + error.message); refresh(); return; }
    const set = new Set(ids);
    S.open = S.open.filter(e => !set.has(e.id)); syncGen++; dirty(); persistCache();
    renderLight(); toast(`${p.naam} afgerekend`);
    if (curView === 'over') loadHist();
    refresh();
  });
}

/* ------------------------------------------------------------------ overzicht */
function renderOver() {
  const open = eff(), cnt = countsBy(open, 'player_id');
  const ps = S.players.filter(p => cnt[p.id]);
  const ds = S.drinks.filter(d => open.some(e => e.drink_id === d.id)).sort(byVolgorde);
  if (!ps.length) $('#tbl').innerHTML = '<tr><td class="empty" style="position:static">Niets open. 🎉</td></tr>';
  else {
    let h = '<thead><tr><th>Speler</th>' + ds.map(d => `<th>${esc(d.naam)}</th>`).join('') + '<th class="tot">Totaal</th></tr></thead><tbody>';
    for (const { g, ps: gp } of groupedPlayers(ps)) {
      if (!gp.length) continue;
      h += `<tr class="gh"><td colspan="${ds.length + 2}">${esc(g.naam)}</td></tr>`;
      for (const p of gp) {
        const c = countsBy(playerOpen(p.id), 'drink_id');
        h += `<tr class="click" data-p="${p.id}"><td>${esc(p.naam)}</td>` +
          ds.map(d => c[d.id] ? `<td>${c[d.id]}</td>` : '<td class="z">·</td>').join('') + `<td class="tot">${cnt[p.id]}</td></tr>`;
      }
    }
    const all = countsBy(open, 'drink_id');
    h += `<tr><td>Alle spelers</td>${ds.map(d => `<td class="tot">${all[d.id]}</td>`).join('')}<td class="tot">${open.length}</td></tr></tbody>`;
    $('#tbl').innerHTML = h;
    $$('#tbl tr.click').forEach(r => { r.onclick = () => openSheet(r.dataset.p); });
  }
  // spelerfilter vullen (alle spelers, ook gearchiveerde: geschiedenis)
  const sel = $('#hSpeler'), keep = sel.value;
  sel.innerHTML = '<option value="">Alle spelers</option>' +
    [...S.players].sort(byNaam).map(p => `<option value="${p.id}">${esc(p.naam)}${p.actief ? '' : ' (archief)'}</option>`).join('');
  sel.value = keep;
}

const ym = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
$('#hMaand').value = ym(new Date());
$('#hPer').onchange = () => {
  const v = $('#hPer').value;
  $('#hMaand').hidden = v !== 'maand'; $('#hVan').hidden = v !== 'periode'; $('#hTot').hidden = v !== 'periode';
  if (v === 'periode' && !$('#hVan').value) {
    const n = new Date();
    $('#hVan').value = `${ym(n)}-01`;
    $('#hTot').value = n.toISOString().slice(0, 10);
  }
  loadHist();
};
['#hMaand', '#hVan', '#hTot', '#hSpeler'].forEach(s => { $(s).onchange = loadHist; });

let histReq = 0;
async function loadHist() {
  const req = ++histReq;
  const per = $('#hPer').value, pid = $('#hSpeler').value;
  let from = null, to = null;
  if (per === 'maand' && $('#hMaand').value) {
    const [y, m] = $('#hMaand').value.split('-').map(Number);
    from = new Date(y, m - 1, 1); to = new Date(y, m, 1);
  } else if (per === 'periode') {
    if ($('#hVan').value) from = new Date($('#hVan').value + 'T00:00');
    if ($('#hTot').value) { to = new Date($('#hTot').value + 'T00:00'); to.setDate(to.getDate() + 1); }
  }
  if (!navigator.onLine) { $('#histSum').innerHTML = ''; $('#hist').innerHTML = '<p class="muted">Afrekeningen bekijken kan enkel met internet.</p>'; return; }
  $('#hist').innerHTML = '<p class="muted">Laden…</p>';
  try {
    const rows = await fetchAll(() => {
      let q = sb.from('settlements').select('id,player_id,settled_at,opmerking,entries(drink_id)')
        .order('settled_at', { ascending: false }).order('id');
      if (from) q = q.gte('settled_at', from.toISOString());
      if (to) q = q.lt('settled_at', to.toISOString());
      if (pid) q = q.eq('player_id', pid);
      return q;
    });
    if (req !== histReq) return;
    renderHist(rows, $('#histSum'), $('#hist'), true);
  } catch (e) {
    if (req !== histReq) return;
    $('#hist').innerHTML = `<p class="muted">Laden mislukt: ${esc(e.message || e)}</p>`;
  }
}
function settlementItems(s) {
  const c = countsBy(s.entries || [], 'drink_id');
  return S.drinks.filter(d => c[d.id]).sort(byVolgorde).map(d => ({ naam: d.naam, n: c[d.id] }))
    .concat(Object.keys(c).filter(id => !dById(id)).map(id => ({ naam: '?', n: c[id] })));
}
function renderHist(rows, sumEl, listEl, withName) {
  if (!rows.length) { sumEl.innerHTML = ''; listEl.innerHTML = '<p class="muted">Geen afrekeningen in deze periode.</p>'; return; }
  const all = rows.flatMap(s => s.entries || []);
  const c = countsBy(all, 'drink_id');
  sumEl.innerHTML = `<div class="card"><b>${plural(rows.length, 'afrekening', 'afrekeningen')} · ${plural(all.length, 'drankje', 'drankjes')}</b>
    <div class="chips">${S.drinks.filter(d => c[d.id]).sort(byVolgorde).map(d => `<span class="chip">${c[d.id]}× ${esc(d.naam)}</span>`).join('')}</div></div>`;
  listEl.innerHTML = rows.map(s => {
    const items = settlementItems(s), n = (s.entries || []).length;
    return `<div class="card"><div class="row sb">
      <b>${withName ? esc((pById(s.player_id) || { naam: '?' }).naam) : plural(n, 'drankje', 'drankjes')}</b><span class="muted">${fmtDate(s.settled_at)}</span></div>
      <div class="muted">${items.map(i => `${i.n}× ${esc(i.naam)}`).join(', ')}${withName ? ` <b>(${n})</b>` : ''}</div>
      ${s.opmerking ? `<div class="muted" style="margin-top:4px">💬 ${esc(s.opmerking)}</div>` : ''}</div>`;
  }).join('');
}

/* ------------------------------------------------------------------ mijn rekening */
function renderMijn() {
  const beh = S.rol === 'beheerder';
  const h = S.mine.players.map(p => {
    const open = beh ? playerOpen(p.id) : S.mine.open.filter(e => e.player_id === p.id);
    const c = countsBy(open, 'drink_id');
    const items = S.drinks.filter(d => c[d.id]).sort(byVolgorde).map(d => `<span class="chip">${c[d.id]}× ${esc(d.naam)}</span>`).join('');
    const sets = S.mine.settlements.filter(s => s.player_id === p.id);
    return `<div class="card"><div class="muted">${esc(p.naam)} · openstaand</div>
        <div class="big">${plural(open.length, 'drankje', 'drankjes')}</div>
        ${items ? `<div class="chips">${items}</div>` : '<p class="muted" style="margin:6px 0 0">Alles is afgerekend. 🎉</p>'}</div>
      <h2>Vorige afrekeningen</h2><div class="hist" data-hist="${p.id}">${sets.length ? '' : '<p class="muted">Nog geen afrekeningen.</p>'}</div>`;
  }).join('');
  $('#mijn').innerHTML = h || '<p class="muted">Geen speler gekoppeld aan jouw login.</p>';
  for (const p of S.mine.players) {
    const sets = S.mine.settlements.filter(s => s.player_id === p.id);
    if (sets.length) renderHist(sets, document.createElement('div'), $(`[data-hist="${p.id}"]`), false);
  }
  if (S.lastFetch && !(S.online && navigator.onLine)) {
    $('#mijn').insertAdjacentHTML('afterbegin', `<p class="muted">Offline – gegevens van ${fmtDate(S.lastFetch)}.</p>`);
  }
}

/* ------------------------------------------------------------------ beheer */
$('#showArchP').onchange = renderSet;
function renderSet() {
  if (S.rol !== 'beheerder') return;
  // spelers
  const showArch = $('#showArchP').checked;
  const ps = S.players.filter(p => showArch || p.actief);
  let h = '';
  for (const { g, ps: gp } of groupedPlayers(ps)) {
    if (!gp.length) continue;
    h += `<li class="sub">${esc(g.naam)}</li>` + gp.map(p => `<li class="${p.actief ? '' : 'arch'}"><span class="nm" data-edit-p="${p.id}">${esc(p.naam)}
      <small>${p.actief ? '' : 'gearchiveerd · '}${p.email ? esc(p.email) + (p.user_id ? ' · gekoppeld ✓' : ' · nog niet ingelogd') : 'geen e-mail'}</small></span>
      <button class="btn sec small" data-edit-p="${p.id}">Wijzig</button></li>`).join('');
  }
  $('#lPlayers').innerHTML = h || '<li class="muted">Nog geen spelers.</li>';
  $$('#lPlayers [data-edit-p]').forEach(b => { b.onclick = () => editPlayer(b.dataset.editP); });

  // drankjes
  const ds = [...S.drinks].sort((a, b) => (b.actief - a.actief) || byVolgorde(a, b));
  const act = ds.filter(d => d.actief);
  $('#lDrinks').innerHTML = ds.map(d => {
    const i = act.indexOf(d);
    return `<li class="${d.actief ? '' : 'arch'}"><span class="nm" data-edit-d="${d.id}">${esc(d.naam)}${d.actief ? '' : '<small>gearchiveerd</small>'}</span>
      ${d.actief ? `<button class="mv" data-mv-d="${d.id}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="Hoger">▲</button>
      <button class="mv" data-mv-d="${d.id}" data-dir="1" ${i === act.length - 1 ? 'disabled' : ''} aria-label="Lager">▼</button>` : ''}
      <button class="btn sec small" data-edit-d="${d.id}">Wijzig</button></li>`;
  }).join('') || '<li class="muted">Nog geen drankjes.</li>';
  $$('#lDrinks [data-edit-d]').forEach(b => { b.onclick = () => editDrink(b.dataset.editD); });
  $$('#lDrinks [data-mv-d]').forEach(b => { b.onclick = () => move('drinks', act, b.dataset.mvD, +b.dataset.dir); });

  // groepen
  const gs = [...S.groups].sort(byVolgorde);
  $('#lGroups').innerHTML = gs.map((g, i) => {
    const n = S.players.filter(p => p.group_id === g.id).length;
    return `<li><span class="nm" data-edit-g="${g.id}">${esc(g.naam)}<small>${plural(n, 'speler', 'spelers')}</small></span>
      <button class="mv" data-mv-g="${g.id}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="Hoger">▲</button>
      <button class="mv" data-mv-g="${g.id}" data-dir="1" ${i === gs.length - 1 ? 'disabled' : ''} aria-label="Lager">▼</button>
      <button class="btn sec small" data-edit-g="${g.id}">Wijzig</button></li>`;
  }).join('') || '<li class="muted">Nog geen groepen.</li>';
  $$('#lGroups [data-edit-g]').forEach(b => { b.onclick = () => editGroup(b.dataset.editG); });
  $$('#lGroups [data-mv-g]').forEach(b => { b.onclick = () => move('groups', gs, b.dataset.mvG, +b.dataset.dir); });

  renderV1Card();
}

async function move(table, list, id, dir) {
  if (needOnline('Volgorde wijzigen')) return;
  const arr = [...list], i = arr.findIndex(x => x.id === id), j = i + dir;
  if (j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  const changes = arr.map((x, k) => ({ x, v: k + 1 })).filter(({ x, v }) => x.volgorde !== v);
  changes.forEach(({ x, v }) => { x.volgorde = v; });
  renderSet();
  const res = await Promise.all(changes.map(({ x, v }) => sb.from(table).update({ volgorde: v }).eq('id', x.id)));
  const err = res.find(r => r.error);
  if (err) toast('Opslaan mislukt: ' + err.error.message);
  persistCache(); refresh();
}

function groupOptions(sel) {
  return [...S.groups].sort(byVolgorde).map(g => `<option value="${g.id}" ${g.id === sel ? 'selected' : ''}>${esc(g.naam)}</option>`).join('');
}
function editPlayer(id) {
  if (needOnline('Spelers wijzigen')) return;
  if (!S.groups.length) return toast('Maak eerst een groep aan');
  const p = id ? S.players.find(x => x.id === id) : { naam: '', group_id: (S.groups.slice().sort(byVolgorde)[0] || {}).id, email: '', actief: true };
  dialog(`<h3>${id ? 'Speler wijzigen' : 'Speler toevoegen'}</h3>
    <label class="f" for="ePn">Naam</label><input type="text" id="ePn" maxlength="60" value="${esc(p.naam)}">
    <label class="f" for="ePg">Groep</label><select id="ePg">${groupOptions(p.group_id)}</select>
    <label class="f" for="ePe">E-mail (optioneel, om "Mijn rekening" te kunnen zien)</label>
    <input type="email" id="ePe" maxlength="120" value="${esc(p.email || '')}" placeholder="naam@voorbeeld.be">
    ${id ? `<label class="chk"><input type="checkbox" id="ePa" ${p.actief ? 'checked' : ''}> Actief (uitvinken = archiveren)</label>
      <p class="muted" style="margin:6px 0 0">Gearchiveerde spelers verdwijnen uit de turflijst; hun geschiedenis blijft bewaard.</p>` : ''}`,
  id ? 'Opslaan' : 'Toevoegen', async () => {
    const row = { naam: $('#ePn').value.trim(), group_id: $('#ePg').value, email: $('#ePe').value.trim() || null };
    if (id) row.actief = $('#ePa').checked;
    if (!row.naam) { toast('Vul een naam in'); return false; }
    if (row.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(row.email)) { toast('Dat e-mailadres klopt niet'); return false; }
    if (id && !row.actief && playerOpen(id).length) {
      toast(`Let op: ${p.naam} heeft nog ${playerOpen(id).length} open drankjes`);
    }
    const q = id ? sb.from('players').update(row).eq('id', id) : sb.from('players').insert(row);
    const { error } = await q;
    if (error) { toast(/players_email_uniek|duplicate/.test(error.message) ? 'Dat e-mailadres hoort al bij een andere speler' : 'Opslaan mislukt: ' + error.message); return false; }
    toast(id ? 'Speler opgeslagen' : 'Speler toegevoegd');
    await refresh();
  }, '#ePn');
}
function editDrink(id) {
  if (needOnline('Drankjes wijzigen')) return;
  const d = id ? S.drinks.find(x => x.id === id) : { naam: '', actief: true };
  dialog(`<h3>${id ? 'Drankje wijzigen' : 'Drankje toevoegen'}</h3>
    <label class="f" for="eDn">Naam</label><input type="text" id="eDn" maxlength="40" value="${esc(d.naam)}">
    ${id ? `<label class="chk"><input type="checkbox" id="eDa" ${d.actief ? 'checked' : ''}> Actief (uitvinken = archiveren)</label>` : ''}`,
  id ? 'Opslaan' : 'Toevoegen', async () => {
    const row = { naam: $('#eDn').value.trim() };
    if (!row.naam) { toast('Vul een naam in'); return false; }
    if (id) row.actief = $('#eDa').checked;
    else row.volgorde = Math.max(0, ...S.drinks.map(x => x.volgorde)) + 1;
    const { error } = id ? await sb.from('drinks').update(row).eq('id', id) : await sb.from('drinks').insert(row);
    if (error) { toast(/duplicate|uniek/.test(error.message) ? 'Dat drankje bestaat al' : 'Opslaan mislukt: ' + error.message); return false; }
    toast('Drankje opgeslagen');
    await refresh();
  }, '#eDn');
}
function editGroup(id) {
  if (needOnline('Groepen wijzigen')) return;
  const g = id ? S.groups.find(x => x.id === id) : { naam: '' };
  const n = id ? S.players.filter(p => p.group_id === id).length : 0;
  dialog(`<h3>${id ? 'Groep wijzigen' : 'Groep toevoegen'}</h3>
    <label class="f" for="eGn">Naam</label><input type="text" id="eGn" maxlength="40" value="${esc(g.naam)}">
    ${id ? (n ? `<p class="muted" style="margin:10px 0 0">Deze groep heeft ${plural(n, 'speler', 'spelers')} (ook gearchiveerde) en kan dus niet verwijderd worden.</p>`
      : '<button class="btn warn small" id="eGdel" style="margin-top:12px">Groep verwijderen</button>') : ''}`,
  id ? 'Opslaan' : 'Toevoegen', async () => {
    const naam = $('#eGn').value.trim();
    if (!naam) { toast('Vul een naam in'); return false; }
    const { error } = id ? await sb.from('groups').update({ naam }).eq('id', id)
      : await sb.from('groups').insert({ naam, volgorde: Math.max(0, ...S.groups.map(x => x.volgorde)) + 1 });
    if (error) { toast(/duplicate|uniek/.test(error.message) ? 'Die groep bestaat al' : 'Opslaan mislukt: ' + error.message); return false; }
    await refresh();
  }, '#eGn');
  const del = $('#eGdel');
  if (del) del.onclick = async () => {
    const { error } = await sb.from('groups').delete().eq('id', id);
    if (error) return toast('Verwijderen mislukt: ' + error.message);
    $('#dlg').classList.remove('on'); toast('Groep verwijderd'); refresh();
  };
}
$('#addPlayer').onclick = () => editPlayer(null);
$('#addDrink').onclick = () => editDrink(null);
$('#addGroup').onclick = () => editGroup(null);

/* back-up: alles downloaden als JSON */
$('#bDl').onclick = async () => {
  if (needOnline('Een back-up maken')) return;
  try {
    const t = ['groups', 'players', 'drinks', 'settlements', 'entries', 'profiles'];
    const res = await Promise.all(t.map(n => fetchAll(() => sb.from(n).select('*').order(n === 'profiles' ? 'user_id' : 'id'))));
    const out = { exported: new Date().toISOString() };
    t.forEach((n, i) => { out[n] = res[i]; });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' }));
    a.download = 'turflijst-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a); a.click(); a.remove();
  } catch (e) { toast('Back-up mislukt: ' + (e.message || e)); }
};

/* ------------------------------------------------------------------ import uit versie 1 (localStorage op dit toestel) */
function readV1() {
  try {
    if (localStorage.getItem(V1_KEY + '-geimporteerd')) return null;
    const d = JSON.parse(localStorage.getItem(V1_KEY) || 'null');
    return d && Array.isArray(d.players) && Array.isArray(d.drinks) ? d : null;
  } catch (e) { return null; }
}
function renderV1Card() {
  const d = readV1();
  $('#v1Card').hidden = !d;
  if (!d) return;
  $('#v1Txt').textContent = `Op dit toestel staan nog gegevens van de oude versie: ${plural(d.players.length, 'speler', 'spelers')}, ` +
    `${plural(d.drinks.length, 'drankje', 'drankjes')} en ${plural((d.entries || []).length, 'open turf', 'open turven')}. ` +
    'Importeren voegt ontbrekende groepen, drankjes en spelers toe (op naam) en zet de open turven online. Doe dit maar één keer.';
}
$('#v1Imp').onclick = () => {
  if (needOnline('Importeren')) return;
  const d = readV1(); if (!d) return;
  ask('Gegevens van versie 1 importeren? Doe dit maar op één toestel en maar één keer, anders tellen turven dubbel.', 'Importeren', async () => {
    try {
      await importV1(d);
      localStorage.setItem(V1_KEY + '-geimporteerd', new Date().toISOString());
      toast('Versie 1 geïmporteerd');
    } catch (e) { toast('Importeren mislukt: ' + (e.message || e)); }
    await refresh();
  });
};
async function importV1(d) {
  const low = s => String(s).trim().toLowerCase();
  const must = r => { if (r.error) throw r.error; return r.data; };
  // groepen
  const gNames = [...new Set([...(d.groups || []), ...d.players.map(p => p.group || 'Spelers')])];
  let maxG = Math.max(0, ...S.groups.map(g => g.volgorde));
  const newG = gNames.filter(n => !S.groups.some(g => low(g.naam) === low(n))).map(n => ({ naam: n, volgorde: ++maxG }));
  if (newG.length) S.groups.push(...must(await sb.from('groups').insert(newG).select('id,naam,volgorde')));
  const gid = n => S.groups.find(g => low(g.naam) === low(n || 'Spelers')).id;
  // drankjes
  let maxD = Math.max(0, ...S.drinks.map(x => x.volgorde));
  const newD = d.drinks.filter(x => !S.drinks.some(y => low(y.naam) === low(x.name))).map(x => ({ naam: x.name, volgorde: ++maxD }));
  if (newD.length) S.drinks.push(...must(await sb.from('drinks').insert(newD).select('id,naam,volgorde,actief')));
  const dmap = {}; d.drinks.forEach(x => { dmap[x.id] = S.drinks.find(y => low(y.naam) === low(x.name)).id; });
  // spelers
  const newP = d.players.filter(x => !S.players.some(y => low(y.naam) === low(x.name))).map(x => ({ naam: x.name, group_id: gid(x.group) }));
  if (newP.length) S.players.push(...must(await sb.from('players').insert(newP).select('id,naam,group_id,email,user_id,actief')));
  const pmap = {}; d.players.forEach(x => { pmap[x.id] = S.players.find(y => low(y.naam) === low(x.name)).id; });
  // open turven
  const rows = (d.entries || []).filter(e => pmap[e.pid] && dmap[e.did])
    .map(e => ({ id: uuid(), player_id: pmap[e.pid], drink_id: dmap[e.did], created_at: new Date(e.ts || Date.now()).toISOString() }));
  for (let i = 0; i < rows.length; i += 500) must(await sb.from('entries').insert(rows.slice(i, i + 500)));
}

/* ------------------------------------------------------------------ logo */
/* Altijd het clublogo (logo.png). Lukt laden niet: "RM". */
function renderLogo() {
  $$('#logo, #sLogo, .loginlogo .logo').forEach(el => {
    const img = new Image();
    img.alt = el.id === 'sLogo' ? '' : 'Racing Mechelen';
    img.onerror = () => { el.innerHTML = '<span>RM</span>'; };
    img.src = 'logo.png';
    el.replaceChildren(img);
  });
}
// Vroeger kon je per toestel een eigen logo kiezen; die opgeslagen afbeelding ruimen we op.
try { localStorage.removeItem('turflijst-logo'); } catch (e) { /* niets */ }

/* ------------------------------------------------------------------ start */
renderLogo();
sb.auth.onAuthStateChange((ev, session) => {
  // Geen Supabase-calls rechtstreeks in deze callback (kan vastlopen); daarom setTimeout.
  setTimeout(() => {
    if (session && session.user) start(session.user);
    else if (ev === 'SIGNED_OUT' || ev === 'INITIAL_SESSION') { if (S.user || curView !== 'login') showLogin(); }
  }, 0);
});

window.__turflijst = { S, sync, refresh, eff }; // voor testen in de console
})();
