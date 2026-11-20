/* SXM Archive — interface */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const api = window.sxm;
const icon = (n) => ICONS[n] || ICONS.file;
const hydrate = (root = document) => $$('[data-i]', root).forEach(el => { if (!el.dataset.done) { el.insertAdjacentHTML('afterbegin', icon(el.dataset.i)); el.dataset.done = 1; } });
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const SEP = api.sep;
const basename = (p) => p.split(/[\\/]/).pop();
const dirname = (p) => p.slice(0, Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/')));
const join = (...a) => a.join(SEP);
const ARC_RE = /\.(zip|7z|rar|tar\.gz|tgz|tar|gz)$/i;
const stripExt = (n) => n.replace(ARC_RE, '').replace(/\.[^.]+$/, (m) => (n.match(ARC_RE) ? m : ''));

function human(n) {
  if (!n) return '0 o';
  const u = ['o', 'Ko', 'Mo', 'Go', 'To']; let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return (i ? n.toFixed(1).replace('.', ',') : n) + ' ' + u[i];
}

const TYPES = [
  [/\.(jpe?g|png|gif|bmp|webp|svg|heic|tiff?)$/i, 'Image', 'file-image', 'ic-img'],
  [/\.(mp3|wav|flac|ogg|m4a|aac|wma)$/i, 'Audio', 'file-music', 'ic-audio'],
  [/\.(mp4|mkv|avi|mov|wmv|webm)$/i, 'Vidéo', 'file-video', 'ic-video'],
  [/\.(pdf)$/i, 'Document PDF', 'file-text', 'ic-arc'],
  [/\.(docx?|odt|rtf|txt|md|xlsx?|csv|pptx?)$/i, 'Document', 'file-text', 'ic-doc'],
  [/\.(js|ts|py|sh|bat|ps1|html?|css|json|xml|c|cpp|java|rs|go|php|exe|dll|msi)$/i, 'Code / programme', 'file-code', 'ic-code'],
  [/\.(zip|7z|rar|gz|tgz|tar|xz|bz2)$/i, 'Archive', 'file-archive', 'ic-arc'],
];
function typeOf(name, dir) {
  if (dir) return ['Dossier', 'folder', 'ic-folder'];
  for (const [re, t, i, c] of TYPES) if (re.test(name)) return [t, i, c];
  const ext = name.includes('.') ? name.split('.').pop().toUpperCase() : '';
  return [ext ? `Fichier ${ext}` : 'Fichier', 'file', 'ic-file'];
}

// ================= état =================
const S = { arc: null, cwd: '', sel: new Set(), sort: { key: 'name', desc: false }, filter: '', tab: 'home', view: 'home', pinned: false };

// ================= vues & ruban =================
function setView(v) {
  S.view = v;
  $('#view-home').classList.toggle('hidden', v !== 'home');
  $('#view-archive').classList.toggle('hidden', v !== 'archive');
  $$('.nav-item[data-view]').forEach(b => b.classList.toggle('active', v === 'home'));
  renderTools();
}

const T = (act, ic, lbl, cls = '', title = '') => ({ act, ic, lbl, cls, title });
const SEPT = { sep: true };
const TOOLSETS = {
  home: [T('open', 'folder-open', '', '', 'Ouvrir une archive (Ctrl+O)'), T('compress', 'package-plus', '', 't-teal', 'Nouvelle archive (Ctrl+N)'), T('home', 'house', '', 't-muted', 'Accueil'), SEPT,
    T('extract', 'folder-output', '', 't-purple', 'Extraire vers… (Ctrl+E)'), T('extractHere', 'hard-drive', '', 't-purple', 'Extraire ici'), T('test', 'shield-check', '', 't-orange', 'Tester'), T('info', 'info', '', 't-muted', 'Informations'), SEPT,
    T('compress', 'package-plus', 'Compresser', 'accent')],
  archive: [T('up', 'arrow-up', 'Dossier parent', 't-muted'), T('view', 'eye', 'Afficher', ''), T('selectAll', 'check', 'Tout sélectionner', 't-muted'), SEPT,
    T('extract', 'folder-output', 'Extraire la sélection', 't-purple'), T('extractHere', 'hard-drive', 'Extraire ici', 't-purple'), SEPT, T('info', 'info', 'Infos', 't-muted')],
  security: [T('protect', 'lock', 'Créer une archive protégée', 't-green'), T('test', 'shield-check', 'Tester l\'intégrité', 't-orange'), SEPT,
    T('forget', 'key-round', 'Oublier le mot de passe', 't-muted')],
  tools: [T('convert', 'repeat', 'Convertir une archive', 't-cyan'), T('compressFolder', 'folder-plus', 'Compresser un dossier', 't-teal'), SEPT,
    T('theme', 'sun-moon', 'Thème', 't-muted'), T('about', 'info', 'À propos', 't-muted')],
};
const NEEDS_ARC = new Set(['extractHere', 'test', 'info', 'up', 'view', 'selectAll']);

function renderTools() {
  const box = $('#tools');
  box.innerHTML = TOOLSETS[S.tab].map(t => t.sep ? '<span class="tool-sep"></span>'
    : `<button class="tool ${t.cls}" data-act="${t.act}" title="${esc(t.title || t.lbl)}" ${(!S.arc && NEEDS_ARC.has(t.act)) || (t.act === 'up' && !S.cwd) || (t.act === 'forget' && !S.arc?.password) ? 'disabled' : ''}><span data-i="${t.ic}"></span>${t.lbl ? `<span class="lbl">${t.lbl}</span>` : ''}</button>`).join('');
  hydrate(box);
}

// ================= statut, progression, toasts =================
const status = (t) => { $('#status').textContent = t; };
let busy = false;
function progress(on, p = 0) {
  $('#progress').classList.toggle('hidden', !on);
  $('#bar').style.setProperty('--p', p + '%'); $('#pct').textContent = p + ' %';
}
api.onProgress(p => progress(true, p));
async function task(label, fn) {
  if (busy) { toast(ERR.BUSY, false); return null; }
  busy = true; status(label); progress(true, 0);
  try { return await fn(); }
  catch (e) { return { error: 'ENGINE_ERROR', detail: String(e) }; }
  finally { busy = false; progress(false); }
}
$('#cancelBtn').onclick = () => { api.cancel(); status('Annulation…'); };
function toast(msg, ok = true, link) {
  const el = document.createElement('div');
  el.className = 'toast' + (ok ? '' : ' err');
  el.innerHTML = `<span class="${ok ? 't-ok' : 't-err'}" data-i="${ok ? 'check' : 'circle-alert'}"></span><span>${esc(msg)}</span>${link ? `<a>${esc(link.label)}</a>` : ''}`;
  if (link) el.querySelector('a').onclick = link.fn;
  hydrate(el); $('#toasts').append(el);
  setTimeout(() => el.remove(), ok ? 6000 : 9000);
}

// ================= modales =================
function modal(html, onReady) {
  return new Promise(resolve => {
    const m = $('#modal'); m.innerHTML = html; hydrate(m);
    $('#overlay').classList.remove('hidden');
    const close = (v) => { $('#overlay').classList.add('hidden'); m.innerHTML = ''; document.removeEventListener('keydown', key); resolve(v); };
    const key = (e) => { if (e.key === 'Escape') close(null); };
    document.addEventListener('keydown', key);
    $$('[data-close]', m).forEach(b => b.onclick = () => close(null));
    onReady && onReady(m, close);
    const f = $('input:not([type=checkbox])', m); f && setTimeout(() => { f.focus(); f.select?.(); }, 30);
  });
}
const head = (ic, cls, title, sub) => `<div class="m-head"><div class="card-ic ${cls}" data-i="${ic}"></div><div><h2>${title}</h2>${sub ? `<p>${sub}</p>` : ''}</div></div>`;

function askPassword(name, wrong) {
  return modal(`${head('lock', 'b-green', 'Mot de passe requis', esc(name))}
    <div class="field"><label>Mot de passe</label><input class="input" type="password" id="pw"></div>
    ${wrong ? '<div class="warn">Mot de passe incorrect, réessayez.</div>' : ''}
    <label class="check"><input type="checkbox" id="show"> Afficher le mot de passe</label>
    <div class="m-actions"><button class="btn" data-close>Annuler</button><button class="btn primary" id="ok">Valider</button></div>`,
  (m, close) => {
    $('#show', m).onchange = (e) => { $('#pw', m).type = e.target.checked ? 'text' : 'password'; };
    const ok = () => close($('#pw', m).value);
    $('#ok', m).onclick = ok; $('#pw', m).onkeydown = (e) => e.key === 'Enter' && ok();
  });
}

const ERR = {
  PASSWORD_REQUIRED: 'Cette archive est protégée : un mot de passe est nécessaire.',
  PASSWORD_WRONG: 'Mot de passe incorrect.',
  PASSWORD_CHARS: 'Ce mot de passe contient un caractère non pris en charge par 7-Zip sous Windows (guillemet « " »). Choisissez-en un autre.',
  PASSWORD_UNSUPPORTED: 'Le format tar.gz ne permet pas de mot de passe. Choisissez ZIP ou 7z.',
  EXISTS: 'Un fichier portant ce nom existe déjà.',
  DUPLICATE_NAME: 'Deux éléments sélectionnés portent le même nom ; renommez l\'un des deux ou compressez-les séparément',
  OUTPUT_INSIDE_INPUT: 'L\'archive ne peut pas être enregistrée à l\'intérieur du dossier compressé.',
  NOT_ARCHIVE: 'Ce fichier n\'est pas une archive reconnue, ou il est endommagé.',
  CORRUPT: 'L\'archive est endommagée ou incomplète.',
  UNSUPPORTED: 'Méthode de compression non prise en charge.',
  DISK_FULL: 'Espace disque insuffisant.',
  ACCESS_DENIED: 'Accès refusé : vérifiez les droits sur le dossier ou que le fichier n\'est pas ouvert ailleurs.',
  OUT_OF_MEMORY: 'Mémoire insuffisante pour cette opération.',
  NOT_FOUND: 'Fichier introuvable',
  UNSAFE_PATH: 'Chemin dangereux refusé',
  IS_DIR: 'C\'est un dossier.',
  EMPTY: 'L\'archive est vide.',
  SAME_FILE: 'La destination est l\'archive d\'origine.',
  BUSY: 'Une opération est déjà en cours.',
  CANCELLED: 'Opération annulée.',
  ENGINE_MISSING: 'Moteur 7-Zip introuvable : réinstallez SXM Archive.',
  OPEN_FAILED: 'Impossible d\'ouvrir le fichier',
  NO_INPUT: 'Aucun fichier sélectionné.',
};
function errText(r) {
  const base = ERR[r.error] || 'Erreur 7-Zip';
  const withDetail = ['NOT_FOUND', 'UNSAFE_PATH', 'DUPLICATE_NAME', 'OPEN_FAILED', 'ENGINE_ERROR', 'UNSUPPORTED'].includes(r.error) || !ERR[r.error];
  return withDetail && r.detail ? `${base} : ${r.detail}` : base;
}
function showError(r, what) {
  if (r.error === 'CANCELLED') { status('Opération annulée'); return toast('Opération annulée', false); }
  status(what);
  toast(errText(r), false);
}
function showWarnings(r) {
  if (r?.warnings?.length) {
    alertBox('circle-alert', 'b-orange', 'Terminé avec des avertissements',
      `<ul style="margin:0;padding-left:18px;max-height:220px;overflow:auto">${r.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>`);
  }
}
function confirmBox(ic, cls, title, body, okLabel = 'Continuer') {
  return modal(`${head(ic, cls, title)}<div>${body}</div><div class="m-actions"><button class="btn" data-close>Annuler</button><button class="btn primary" id="ok">${okLabel}</button></div>`,
    (m, close) => { $('#ok', m).onclick = () => close(true); });
}
const isPwErr = (r) => r?.error === 'PASSWORD_REQUIRED' || r?.error === 'PASSWORD_WRONG';

function alertBox(ic, cls, title, body, onReady) {
  return modal(`${head(ic, cls, title)}<div>${body}</div><div class="m-actions"><button class="btn primary" data-close>OK</button></div>`, onReady);
}

// ================= ouverture d'archive =================
async function loadArchive(file, password, wrong) {
  if (password === undefined && wrong) return;
  const r = await task('Lecture de l\'archive…', () => api.list(file, password));
  if (!r) return;
  if (isPwErr(r)) {
    const pw = await askPassword(basename(file), r.error === 'PASSWORD_WRONG');
    if (pw === null) return status('Ouverture annulée');
    return loadArchive(file, pw);
  }
  if (r.error) return showError(r, 'Échec de l\'ouverture');
  if (r.unsafeCount) toast(`Attention : ${r.unsafeCount} élément(s) de cette archive ont un chemin dangereux. Ils seront ramenés dans le dossier de destination à l'extraction.`, false);
  // dossiers implicites
  const seen = new Set(r.entries.map(e => e.path));
  for (const e of [...r.entries]) {
    if (e.unsafe_path) continue; // affiché tel quel à la racine, sans créer de faux dossiers « .. »
    const parts = e.path.split('/');
    for (let i = 1; i < parts.length; i++) {
      const d = parts.slice(0, i).join('/');
      if (!seen.has(d)) { seen.add(d); r.entries.push({ path: d, size: 0, packed: 0, date: '', dir: true }); }
    }
  }
  // tailles des dossiers calculées une seule fois (rapide même avec des centaines de milliers d'éléments)
  const dirAgg = new Map();
  for (const e of r.entries) {
    if (e.dir) continue;
    let i = e.path.lastIndexOf('/');
    while (i > 0) {
      const d = e.path.slice(0, i), g = dirAgg.get(d) || { size: 0, packed: 0 };
      g.size += e.size; g.packed += e.packed; dirAgg.set(d, g);
      i = d.lastIndexOf('/');
    }
  }
  S.arc = { file, entries: r.entries, dirAgg, size: r.archiveSize, password: password || null, encrypted: r.entries.some(e => e.encrypted) || !!password };
  S.cwd = ''; S.sel.clear(); S.filter = ''; $('#filter').value = '';
  if (S.tab === 'home') { S.tab = 'archive'; $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'archive')); }
  setView('archive'); renderArchive();
}

function renderArchive() {
  const a = S.arc; if (!a) return;
  const files = a.entries.filter(e => !e.dir);
  const total = files.reduce((s, e) => s + e.size, 0);
  $('#arcName').textContent = basename(a.file);
  $('#arcSub').textContent = `${files.length} fichier(s) · ${human(total)} décompressé · ${human(a.size)} sur le disque${a.encrypted ? ' · 🔒 protégée' : ''}`;
  // fil d'Ariane
  const parts = S.cwd ? S.cwd.split('/') : [];
  const cr = $('#crumbs');
  cr.innerHTML = `<button class="crumb" data-p="">${esc(basename(a.file))}</button>` + parts.map((p, i) =>
    `<span data-i="chevron-right"></span><button class="crumb" data-p="${esc(parts.slice(0, i + 1).join('/'))}">${esc(p)}</button>`).join('');
  hydrate(cr);
  $$('.crumb', cr).forEach(b => b.onclick = () => go(b.dataset.p));
  $('#upBtn').disabled = !S.cwd;

  // lignes
  const prefix = S.cwd ? S.cwd + '/' : '';
  const q = S.filter.toLowerCase();
  let rows;
  if (q) rows = a.entries.filter(e => basename(e.path).toLowerCase().includes(q)).map(e => ({ ...e, name: e.path }));
  else rows = a.entries.filter(e => e.unsafe_path ? !prefix : (e.path.startsWith(prefix) && e.path.length > prefix.length && !e.path.slice(prefix.length).includes('/')))
    .map(e => ({ ...e, name: e.unsafe_path ? e.path : e.path.slice(prefix.length) }));
  for (const r of rows) if (r.dir) { const g = a.dirAgg.get(r.path); r.size = g?.size || 0; r.packed = g?.packed || 0; }
  const { key, desc } = S.sort;
  rows.sort((x, y) => {
    if (x.dir !== y.dir) return x.dir ? -1 : 1;
    let v = key === 'type' ? typeOf(x.name, x.dir)[0].localeCompare(typeOf(y.name, y.dir)[0])
      : key === 'name' || key === 'date' ? String(x[key]).localeCompare(String(y[key]), 'fr', { numeric: true })
      : x[key] - y[key];
    return desc ? -v : v;
  });
  $('#rows').innerHTML = rows.map(r => {
    const [t, ic, cls] = typeOf(r.name, r.dir);
    return `<tr data-p="${esc(r.path)}" data-dir="${r.dir ? 1 : ''}" class="${S.sel.has(r.path) ? 'sel' : ''}">
      <td class="name"><span class="${cls}" data-i="${ic}"></span><span>${esc(r.name)}</span>${r.encrypted ? '<span class="lock" data-i="lock"></span>' : ''}${r.unsafe_path ? '<span class="lock" title="Chemin dangereux neutralisé" data-i="circle-alert"></span>' : ''}</td>
      <td class="r">${r.dir && !r.size ? '' : human(r.size)}</td><td class="r muted">${r.packed ? human(r.packed) : '—'}</td>
      <td class="muted">${t}</td><td class="muted">${esc(fmtDate(r.date))}</td></tr>`;
  }).join('');
  hydrate($('#rows'));
  $('#emptyDir').classList.toggle('hidden', rows.length > 0);
  $$('th[data-sort]').forEach(th => { th.classList.toggle('sorted', th.dataset.sort === key); th.classList.toggle('desc', th.dataset.sort === key && desc); });
  const dirs = a.entries.length - files.length;
  status(`Total : ${dirs} dossier(s) et ${files.length} fichier(s), ${human(total)}${S.sel.size ? ` — ${S.sel.size} sélectionné(s)` : ''}`);
  renderTools();
}
function fmtDate(d) {
  const m = /^(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d)/.exec(d || '');
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : '';
}
function go(p) { S.cwd = p; S.sel.clear(); renderArchive(); }

// sélection & navigation dans le tableau
let lastClick = null;
$('#rows').addEventListener('click', (e) => {
  const tr = e.target.closest('tr'); if (!tr) return;
  const p = tr.dataset.p, all = $$('#rows tr').map(r => r.dataset.p);
  if (e.shiftKey && lastClick) {
    const [a, b] = [all.indexOf(lastClick), all.indexOf(p)].sort((x, y) => x - y);
    if (!e.ctrlKey) S.sel.clear(); all.slice(a, b + 1).forEach(x => S.sel.add(x));
  } else if (e.ctrlKey) { S.sel.has(p) ? S.sel.delete(p) : S.sel.add(p); lastClick = p; }
  else { S.sel.clear(); S.sel.add(p); lastClick = p; }
  $$('#rows tr').forEach(r => r.classList.toggle('sel', S.sel.has(r.dataset.p)));
  renderToolsAndStatus();
});
function renderToolsAndStatus() {
  const files = S.arc.entries.filter(e => !e.dir);
  status(`Total : ${S.arc.entries.length - files.length} dossier(s) et ${files.length} fichier(s), ${human(files.reduce((s, e) => s + e.size, 0))}${S.sel.size ? ` — ${S.sel.size} sélectionné(s)` : ''}`);
}
$('#rows').addEventListener('dblclick', (e) => {
  const tr = e.target.closest('tr'); if (!tr) return;
  if (tr.dataset.dir) go(tr.dataset.p); else viewMember(tr.dataset.p);
});
$$('th[data-sort]').forEach(th => th.onclick = () => {
  const k = th.dataset.sort; S.sort = { key: k, desc: S.sort.key === k ? !S.sort.desc : false }; renderArchive();
});
$('#upBtn').onclick = () => actions.up();
$('#filter').oninput = (e) => { S.filter = e.target.value; renderArchive(); };

async function needPassword() {
  if (S.arc.encrypted && !S.arc.password) {
    const pw = await askPassword(basename(S.arc.file));
    if (pw === null) return false;
    S.arc.password = pw;
  }
  return true;
}
async function viewMember(member, allowDangerous = false) {
  if (!(await needPassword())) return;
  const r = await task('Ouverture du fichier…', () => api.openMember({ file: S.arc.file, member, password: S.arc.password, allowDangerous }));
  if (!r) return;
  if (r.error === 'DANGEROUS') {
    const ok = await confirmBox('circle-alert', 'b-orange', 'Fichier potentiellement dangereux',
      `<p><b>${esc(basename(member))}</b> est un programme ou un script. Ne l'ouvrez que si vous connaissez sa provenance.</p>`, 'Ouvrir quand même');
    return ok ? viewMember(member, true) : status('Ouverture annulée');
  }
  if (isPwErr(r)) { S.arc.password = null; toast(errText(r), false); return viewMember(member, allowDangerous); }
  if (r.error) return showError(r, 'Échec de l\'ouverture');
  status('Ouvert : ' + basename(member));
}

// ================= compression =================
const FMT = { zip: '.zip', '7z': '.7z', 'tar.gz': '.tar.gz' };
const LEVELS = [['Stockage (aucune)', 0], ['Très rapide', 1], ['Rapide', 3], ['Normale', 5], ['Maximale', 7], ['Ultra', 9]];

async function compressFlow(files, opts = {}) {
  if (!files) files = await api.pickFiles();
  if (!files || !files.length) return;
  const def = files.length === 1 ? stripExt(basename(files[0])) || basename(files[0]) : basename(dirname(files[0])) || 'archive';
  let fmt = opts.format || (opts.protect ? '7z' : 'zip');
  const res = await modal(`${head(opts.protect ? 'lock' : 'package-plus', opts.protect ? 'b-green' : 'b-teal', opts.protect ? 'Créer une archive protégée' : 'Créer une archive', `${files.length} élément(s) sélectionné(s)`)}
    <div class="m-files">${files.slice(0, 30).map(f => `<div>${icon(/\./.test(basename(f)) ? 'file' : 'folder')}${esc(basename(f))}</div>`).join('')}${files.length > 30 ? `<div>… et ${files.length - 30} autre(s)</div>` : ''}</div>
    <div class="field" style="margin-top:14px"><label>Nom de l'archive</label><input class="input" id="nm" value="${esc(def)}"></div>
    <div class="field"><label>Format</label><div class="seg" id="seg">${Object.keys(FMT).map(f => `<button data-f="${f}" class="${f === fmt ? 'on' : ''}">${f.toUpperCase().replace('TAR.GZ', 'tar.gz')}</button>`).join('')}</div></div>
    <div class="field"><label>Niveau de compression</label><select class="input" id="lv">${LEVELS.map(([l, v]) => `<option value="${v}" ${v === 5 ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    <div id="pwBox">
      <label class="check"><input type="checkbox" id="usePw" ${opts.protect ? 'checked' : ''}> Protéger par mot de passe (AES-256)</label>
      <div id="pwFields" class="${opts.protect ? '' : 'hidden'}" style="margin-top:10px">
        <div class="row"><input class="input" type="password" id="pw1" placeholder="Mot de passe"><input class="input" type="password" id="pw2" placeholder="Confirmer"></div>
        <label class="check" id="encBox"><input type="checkbox" id="enc" checked> Chiffrer aussi les noms de fichiers (7z uniquement)</label>
      </div>
    </div>
    <div class="hint" id="tgzHint">Le format tar.gz ne prend pas en charge les mots de passe.</div>
    <div class="warn hidden" id="err"></div>
    <div class="m-actions"><button class="btn" data-close>Annuler</button><button class="btn primary" id="go">Créer l'archive</button></div>`,
  (m, close) => {
    const sync = () => {
      $$('#seg button', m).forEach(b => b.classList.toggle('on', b.dataset.f === fmt));
      $('#pwBox', m).classList.toggle('hidden', fmt === 'tar.gz'); $('#tgzHint', m).classList.toggle('hidden', fmt !== 'tar.gz');
      $('#encBox', m).classList.toggle('hidden', fmt !== '7z');
      $('#pwFields', m).classList.toggle('hidden', !$('#usePw', m).checked);
    };
    $$('#seg button', m).forEach(b => b.onclick = () => { fmt = b.dataset.f; sync(); });
    $('#usePw', m).onchange = sync; sync();
    $('#go', m).onclick = () => {
      const name = $('#nm', m).value.trim().replace(/[\\/:*?"<>|]/g, '_');
      const usePw = fmt !== 'tar.gz' && $('#usePw', m).checked;
      const p1 = $('#pw1', m).value, p2 = $('#pw2', m).value;
      const err = (t) => { $('#err', m).textContent = t; $('#err', m).classList.remove('hidden'); };
      if (!name) return err('Indiquez un nom d\'archive.');
      if (usePw && !p1) return err('Saisissez un mot de passe.');
      if (usePw && p1 !== p2) return err('Les mots de passe ne correspondent pas.');
      if (usePw && p1.includes('"')) return err('Le guillemet « " » n\'est pas accepté dans un mot de passe (limite de 7-Zip sous Windows).');
      close({ name, format: fmt, level: +$('#lv', m).value, password: usePw ? p1 : null, encryptNames: $('#enc', m).checked });
    };
  });
  if (!res) return;
  const out = join(dirname(files[0]), res.name + FMT[res.format]);
  let overwrite = false;
  if ((await api.stat(out)).exists) {
    overwrite = await confirmBox('circle-alert', 'b-orange', 'Le fichier existe déjà',
      `<p><b>${esc(basename(out))}</b> existe déjà dans ce dossier. Voulez-vous le remplacer ?</p>`, 'Remplacer');
    if (!overwrite) return status('Compression annulée');
  }
  const r = await task(`Création de ${basename(out)}…`, () => api.compress({ files, out, ...res, overwrite }));
  if (!r) return;
  if (r.error) return showError(r, 'Échec de la compression');
  toast(`Archive créée : ${basename(out)}`, true, { label: 'Afficher', fn: () => api.showInFolder(out) });
  showWarnings(r);
  await loadArchive(out, res.password || undefined);
}

// ================= actions =================
async function ensureArchive() {
  if (S.arc) return true;
  const f = await api.pickArchive(); if (!f) return false;
  await loadArchive(f); return !!S.arc;
}
async function doExtract(dest, uniqueDest = false) {
  if (!(await needPassword())) return;
  const members = [...S.sel];
  const r = await task(members.length ? `Extraction de ${members.length} élément(s)…` : 'Extraction…',
    () => api.extract({ file: S.arc.file, dest, members, password: S.arc.password, uniqueDest }));
  if (!r) return;
  if (isPwErr(r)) {
    S.arc.password = null;
    const pw = await askPassword(basename(S.arc.file), r.error === 'PASSWORD_WRONG');
    if (pw === null) return status('Extraction annulée');
    S.arc.password = pw; return doExtract(dest, uniqueDest);
  }
  if (r.error) return showError(r, 'Échec de l\'extraction');
  const where = r.out || dest;
  status('Extrait dans ' + where);
  toast('Extraction terminée. Les fichiers déjà présents ont été conservés.', true, { label: 'Ouvrir le dossier', fn: () => api.openPath(where) });
  showWarnings(r);
}

const actions = {
  home: () => setView('home'),
  open: async () => { const f = await api.pickArchive(); if (f) loadArchive(f); },
  compress: () => compressFlow(),
  compressFolder: async () => { const f = await api.pickFolderToAdd(); if (f) compressFlow(f); },
  protect: () => compressFlow(null, { protect: true }),
  extract: async () => {
    if (!(await ensureArchive())) return;
    const dest = await api.pickDest(dirname(S.arc.file)); if (dest) doExtract(dest);
  },
  extractHere: async () => {
    if (!(await ensureArchive())) return;
    doExtract(join(dirname(S.arc.file), stripExt(basename(S.arc.file))), true);
  },
  test: async () => {
    if (!(await ensureArchive())) return;
    if (!(await needPassword())) return;
    const r = await task('Test de l\'archive…', () => api.test({ file: S.arc.file, password: S.arc.password }));
    if (!r) return;
    if (r.ok && r.warnings?.length) { status('Test terminé avec des avertissements'); showWarnings(r); }
    else if (r.ok) { status('Aucune erreur trouvée'); alertBox('shield-check', 'b-green', 'Test réussi', `<p>Aucune erreur n'a été trouvée dans <b>${esc(basename(S.arc.file))}</b>.</p>`); }
    else if (isPwErr(r)) { S.arc.password = null; toast(errText(r), false); }
    else if (r.error === 'CANCELLED') showError(r, '');
    else { status('Archive endommagée'); alertBox('circle-alert', 'b-orange', 'Problème détecté', `<p>${esc(errText(r))}</p>`); }
  },
  info: () => {
    if (!S.arc) return;
    const files = S.arc.entries.filter(e => !e.dir);
    const total = files.reduce((s, e) => s + e.size, 0);
    const ratio = total ? Math.min(100, Math.round(S.arc.size / total * 100)) : 100;
    alertBox('info', 'b-blue', esc(basename(S.arc.file)), `<dl class="info-grid">
      <dt>Emplacement</dt><dd>${esc(dirname(S.arc.file))}</dd>
      <dt>Fichiers</dt><dd>${files.length}</dd><dt>Dossiers</dt><dd>${S.arc.entries.length - files.length}</dd>
      <dt>Taille d'origine</dt><dd>${human(total)}</dd><dt>Taille de l'archive</dt><dd>${human(S.arc.size)}</dd>
      <dt>Taux de compression</dt><dd>${ratio} %<div class="ratio"><div style="width:${ratio}%"></div></div></dd>
      <dt>Protection</dt><dd>${S.arc.encrypted ? 'Mot de passe (AES)' : 'Aucune'}</dd></dl>`);
  },
  up: () => { if (S.cwd) go(S.cwd.includes('/') ? S.cwd.slice(0, S.cwd.lastIndexOf('/')) : ''); },
  view: () => { const f = [...S.sel].find(p => !S.arc.entries.find(e => e.path === p)?.dir); if (f) viewMember(f); else toast('Sélectionnez un fichier à afficher', false); },
  selectAll: () => { $$('#rows tr').forEach(r => S.sel.add(r.dataset.p)); renderArchive(); },
  forget: () => { if (S.arc) { S.arc.password = null; toast('Mot de passe oublié pour cette session'); renderTools(); } },
  convert: async () => {
    if (!(await ensureArchive())) return;
    if (!(await needPassword())) return;
    let fmt = /\.zip$/i.test(S.arc.file) ? '7z' : 'zip';
    const res = await modal(`${head('repeat', 'b-cyan', 'Convertir l\'archive', esc(basename(S.arc.file)))}
      <div class="field"><label>Nouveau format</label><div class="seg" id="seg">${Object.keys(FMT).map(f => `<button data-f="${f}" class="${f === fmt ? 'on' : ''}">${f === 'tar.gz' ? 'tar.gz' : f.toUpperCase()}</button>`).join('')}</div></div>
      <div class="field"><label>Niveau de compression</label><select class="input" id="lv">${LEVELS.map(([l, v]) => `<option value="${v}" ${v === 5 ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div id="npBox" class="field"><label>Mot de passe de la nouvelle archive (facultatif)</label><input class="input" type="password" id="np" placeholder="Laisser vide pour ne pas protéger"></div>
      ${S.arc.encrypted ? '<div class="warn">L\'archive d\'origine est protégée : sans nouveau mot de passe, la nouvelle archive ne le sera pas.</div>' : ''}
      <div class="hint">L'archive d'origine est conservée. La nouvelle est créée dans le même dossier.</div>
      <div class="m-actions"><button class="btn" data-close>Annuler</button><button class="btn primary" id="go">Convertir</button></div>`,
    (m, close) => {
      const sync = () => $('#npBox', m).classList.toggle('hidden', fmt === 'tar.gz');
      $$('#seg button', m).forEach(b => b.onclick = () => { fmt = b.dataset.f; $$('#seg button', m).forEach(x => x.classList.toggle('on', x === b)); sync(); });
      sync();
      $('#go', m).onclick = () => close({ format: fmt, level: +$('#lv', m).value, newPassword: fmt === 'tar.gz' ? null : ($('#np', m).value || null) });
    });
    if (!res) return;
    const out = join(dirname(S.arc.file), stripExt(basename(S.arc.file)) + FMT[res.format]);
    if (out === S.arc.file) return toast('L\'archive est déjà dans ce format', false);
    let overwrite = false;
    if ((await api.stat(out)).exists) {
      overwrite = await confirmBox('circle-alert', 'b-orange', 'Le fichier existe déjà', `<p><b>${esc(basename(out))}</b> existe déjà. Voulez-vous le remplacer ?</p>`, 'Remplacer');
      if (!overwrite) return status('Conversion annulée');
    }
    const r = await task(`Conversion vers ${res.format}…`, () => api.convert({ file: S.arc.file, password: S.arc.password, out, ...res, overwrite }));
    if (!r) return;
    if (isPwErr(r)) { S.arc.password = null; return showError(r, 'Mot de passe incorrect'); }
    if (r.error) return showError(r, 'Échec de la conversion');
    toast(`Converti : ${basename(out)}`, true, { label: 'Afficher', fn: () => api.showInFolder(out) });
    showWarnings(r);
    loadArchive(out, res.newPassword || undefined);
  },
  theme: () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'),
  about: async () => {
    const i = await api.appInfo();
    alertBox('archive', 'b-teal', 'SXM Archive', `<p style="margin:0 0 10px">Version ${esc(i.version)} — moteur ${esc(i.engine)}</p>
      <p style="margin:0 0 10px;color:var(--muted)">Gestionnaire d'archives léger : RAR (extraction), ZIP, 7z et tar.gz. Chiffrement AES-256. 100 % hors ligne.</p>
      <p style="margin:0 0 6px;color:var(--soft);font-size:12px">Éditeur : ${esc(i.publisher)} · © 2026 ${esc(i.publisher)}</p>
      <p style="margin:0;color:var(--soft);font-size:12px">Moteur 7-Zip © 1999-2025 Igor Pavlov, licence GNU LGPL avec restriction unRAR (le code de décompression RAR ne peut pas servir à recréer l'algorithme de compression RAR). Texte complet : dossier « bin\\License.txt » de l'installation.</p>`);
  },
};

function setTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('theme', t); } catch {}
  api.setTheme(t);
}

// ================= événements globaux =================
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (b && !b.disabled) { closeMenu(); actions[b.dataset.act]?.(); }
  if (!e.target.closest('#menu') && !e.target.closest('#moreBtn')) closeMenu();
});
$$('.tab').forEach(t => t.onclick = () => { S.tab = t.dataset.tab; $$('.tab').forEach(x => x.classList.toggle('active', x === t)); renderTools(); });
$$('.nav-item[data-view]').forEach(b => b.onclick = () => setView('home'));
$('#themeBtn').onclick = actions.theme;
$('#aboutBtn').onclick = actions.about;
$('#pinBtn').onclick = async () => { S.pinned = await api.setPinned(!S.pinned); $('#pinLbl').textContent = S.pinned ? 'Désépingler l\'application' : 'Épingler l\'application'; };

function closeMenu() { $('#menu').classList.add('hidden'); }
$('#moreBtn').onclick = (e) => {
  const m = $('#menu'), r = e.currentTarget.getBoundingClientRect();
  m.innerHTML = `<button data-act="extractHere"><span data-i="hard-drive"></span>Extraire ici</button>
    <button data-act="test"><span data-i="shield-check"></span>Tester l'archive</button>
    <button data-act="info"><span data-i="info"></span>Informations</button><hr>
    <button data-act="convert"><span data-i="repeat"></span>Convertir…</button>
    <button data-act="protect"><span data-i="lock"></span>Archive protégée…</button><hr>
    <button data-act="theme"><span data-i="sun-moon"></span>Thème clair / sombre</button>
    <button data-act="about"><span data-i="archive"></span>À propos</button>`;
  hydrate(m); m.classList.remove('hidden');
  m.style.top = (r.bottom + 6) + 'px'; m.style.left = (r.right - m.offsetWidth) + 'px';
};

document.addEventListener('keydown', (e) => {
  if (!$('#overlay').classList.contains('hidden')) return;
  const k = e.key.toLowerCase();
  if (e.ctrlKey && k === 'o') { e.preventDefault(); actions.open(); }
  else if (e.ctrlKey && k === 'n') { e.preventDefault(); actions.compress(); }
  else if (e.ctrlKey && k === 'e') { e.preventDefault(); actions.extract(); }
  else if (e.ctrlKey && k === 'a' && S.view === 'archive' && document.activeElement !== $('#filter')) { e.preventDefault(); actions.selectAll(); }
  else if (e.key === 'Backspace' && S.view === 'archive' && document.activeElement !== $('#filter')) { e.preventDefault(); actions.up(); }
  else if (e.key === 'Enter' && S.view === 'archive' && S.sel.size === 1) {
    const p = [...S.sel][0], ent = S.arc.entries.find(x => x.path === p);
    ent?.dir ? go(p) : viewMember(p);
  }
});

// glisser-déposer (Tauri fournit directement les chemins)
api.onDragDrop((paths) => handleFiles(paths), (on) => document.body.classList.toggle('dragging', on));
async function handleFiles(files) {
  if (!files.length) return;
  if (files.length === 1 && ARC_RE.test(files[0])) {
    const st = await api.stat(files[0]);
    if (st?.exists && !st.dir) return loadArchive(files[0]);
  }
  compressFlow(files);
}
let pending = [], pendingTimer = null;
api.onOpenFiles((files) => {
  pending.push(...files);
  clearTimeout(pendingTimer);
  pendingTimer = setTimeout(() => { const f = [...new Set(pending)]; pending = []; handleFiles(f); }, 400);
});

// ================= mises à jour =================
const UPD_ERR = {
  NETWORK: 'Impossible de joindre le serveur de mises à jour. Vérifiez la connexion Internet.',
  SIGNATURE: 'La signature de la mise à jour est invalide : elle a été refusée par sécurité.',
  NO_PLATFORM: 'Aucune mise à jour n\'est encore publiée pour ce système.',
  NO_RELEASE: 'Aucune version publiée pour le moment.',
  NO_UPDATE: 'Aucune mise à jour en attente.',
  BUSY: 'Une installation est déjà en cours.',
};
const updErr = (e) => UPD_ERR[e] || `Erreur : ${e}`;
const getPref = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } };
const setPref = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
let lastUpdate = null;

async function checkUpdates(manual) {
  let info;
  try { info = await api.checkUpdate(); } catch (e) { info = { enabled: true, error: String(e) }; }
  setPref('lastUpdateCheck', String(Date.now()));
  if (!info.enabled) {
    if (manual) alertBox('refresh-cw', 'b-blue', 'Mises à jour', '<p>Les mises à jour intégrées ne sont pas activées dans cette version (version de développement ou non signée).</p>');
    return;
  }
  if (info.error) { if (manual) alertBox('circle-alert', 'b-orange', 'Mises à jour', `<p>${esc(updErr(info.error))}</p>`); return; }
  lastUpdate = info.available ? info : null;
  $('#updBadge').classList.toggle('hidden', !info.available);
  if (!info.available) {
    if (manual) alertBox('shield-check', 'b-green', 'SXM Archive est à jour', `<p>Vous utilisez la dernière version (${esc(info.current)}).</p>${autoToggleHtml()}`, bindAutoToggle);
    return;
  }
  if (manual) showUpdate(info);
  else toast(`SXM Archive ${info.version} est disponible`, true, { label: 'Voir', fn: () => showUpdate(info) });
}

function autoToggleHtml() {
  return `<label class="check" style="margin-top:12px"><input type="checkbox" id="autoUpd" ${getPref('autoUpdate', '1') === '1' ? 'checked' : ''}> Rechercher les mises à jour au démarrage</label>`;
}
function bindAutoToggle(m) { const c = $('#autoUpd', m); if (c) c.onchange = () => setPref('autoUpdate', c.checked ? '1' : '0'); }

async function showUpdate(info) {
  const linux = navigator.userAgent.includes('Linux');
  const go = await modal(`${head('refresh-cw', 'b-blue', `Nouvelle version : ${esc(info.version)}`, `Version installée : ${esc(info.current)}`)}
    ${info.notes ? `<div class="upd-notes">${esc(info.notes)}</div>` : ''}
    <p class="hint">La mise à jour est téléchargée depuis GitHub et sa signature est vérifiée avant installation.${linux ? ' Fedora vous demandera votre mot de passe administrateur.' : ''} SXM Archive redémarrera ensuite.</p>
    ${autoToggleHtml()}
    <div class="m-actions"><button class="btn" data-close>Plus tard</button><button class="btn primary" id="ok">Installer et redémarrer</button></div>`,
  (m, close) => { bindAutoToggle(m); $('#ok', m).onclick = () => close(true); });
  if (!go) return;
  if (busy) return toast(ERR.BUSY, false);
  modal(`${head('refresh-cw', 'b-blue', `Installation de la version ${esc(info.version)}`, 'Téléchargement et vérification…')}
    <div class="upd-bar"><div id="updBar"></div></div><p class="hint" id="updPct">0 %</p>`);
  try {
    await api.installUpdate();
  } catch (e) {
    $('#overlay').classList.add('hidden');
    alertBox('circle-alert', 'b-orange', 'Mise à jour impossible', `<p>${esc(updErr(String(e)))}</p>`);
  }
}
api.onUpdateProgress((p) => { const b = $('#updBar'); if (b) { b.style.width = p + '%'; $('#updPct').textContent = p + ' %'; } });
$('#updateBtn').onclick = () => (lastUpdate ? showUpdate(lastUpdate) : checkUpdates(true));

// ================= démarrage =================
(async () => {
  hydrate();
  let t = 'light'; try { t = localStorage.getItem('theme') || 'light'; } catch {}
  setTheme(t);
  const i = await api.appInfo();
  $('#ver').textContent = 'v' + i.version;
  $('#engine').textContent = 'Moteur ' + i.engine;
  setView('home');
  status('Prêt — ouvrez une archive ou glissez des fichiers');
  // vérification automatique : au plus une fois par jour, en arrière-plan
  const last = +getPref('lastUpdateCheck', '0');
  if (getPref('autoUpdate', '1') === '1' && Date.now() - last > 24 * 3600 * 1000) setTimeout(() => checkUpdates(false), 4000);
})();
