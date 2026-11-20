// Archive ouverte : chargement, affichage du contenu, navigation, sélection, ouverture d'un fichier.
import * as api from "./api.js";
import { $, $$, state, ico } from "./core.js";
import { toast, el, confirmBox } from "./ui.js";
import { basename, fmtDate, human, indexEntries, rowsFor, stats, typeOf } from "./util.js";
import { askPassword, setStatus, task } from "./ops.js";

/** Accueil ou archive ouverte (le ruban et la barre latérale s'adaptent). */
export function showHome(home) {
  document.body.classList.toggle("at-home", home);
  $("#empty").classList.toggle("hidden", !home);
  $("#view-archive").classList.toggle("hidden", home);
  refreshButtons();
}

/** Active ou grise les boutons selon le contexte (archive ouverte, sous-dossier, mot de passe). */
export function refreshButtons() {
  const a = state.arc;
  $$("[data-need]").forEach((b) => {
    const need = b.dataset.need;
    b.disabled = !a || (need === "sub" && !state.cwd) || (need === "pw" && !a.password);
  });
  $("#doc-pill").classList.toggle("hidden", !a);
  if (a) $("#doc-name").textContent = basename(a.file);
}

/** Ouvre une archive ; demande le mot de passe si les noms de fichiers sont chiffrés. */
export async function loadArchive(file, password, wrong = false) {
  const r = await task("Lecture de l'archive…", () => api.list(file, password));
  if (!r) return false;
  if (api.isPwErr(r)) {
    const pw = await askPassword(basename(file), r.error === "PASSWORD_WRONG" || wrong);
    if (pw === null) { setStatus("Ouverture annulée"); return false; }
    return loadArchive(file, pw);
  }
  if (r.error) { setStatus("Échec de l'ouverture"); toast(api.errText(r), true); return false; }
  state.arc = {
    file, size: r.archiveSize, password: password || null, unsafeCount: r.unsafeCount,
    entries: indexEntries(r.entries),
    encrypted: !!password || r.entries.some((e) => e.encrypted),
  };
  state.cwd = ""; state.sel.clear(); state.filter = ""; $("#filter").value = "";
  showHome(false);
  render();
  if (r.unsafeCount) {
    toast(`Attention : ${r.unsafeCount} élément(s) de cette archive ont un chemin dangereux. Ils seront ramenés dans le dossier de destination à l'extraction.`, true);
  }
  return true;
}

export function closeArchive() {
  state.arc = null; state.cwd = ""; state.sel.clear();
  showHome(true);
  setStatus("Prêt — ouvrez une archive ou glissez des fichiers");
}

function statusLine() {
  const s = stats(state.arc.entries);
  setStatus(`Total : ${s.dirs} dossier(s) et ${s.files} fichier(s), ${human(s.size)}` + (state.sel.size ? ` — ${state.sel.size} sélectionné(s)` : ""));
}

export function render() {
  const a = state.arc;
  if (!a) return;
  const s = stats(a.entries);
  $("#arc-name").textContent = basename(a.file);
  $("#arc-sub").textContent = `${s.files} fichier(s) · ${human(s.size)} décompressé · ${human(a.size)} sur le disque` + (a.encrypted ? " · protégée par mot de passe" : "");

  // Fil d'Ariane
  const crumbs = $("#crumbs");
  crumbs.replaceChildren();
  const parts = state.cwd ? state.cwd.split("/") : [];
  const crumb = (label, path) => {
    const b = el("button", { "data-no-tr": "" }, label);
    b.addEventListener("click", () => go(path));
    return b;
  };
  crumbs.append(crumb(basename(a.file), ""));
  parts.forEach((p, i) => crumbs.append(ico("chevron-right"), crumb(p, parts.slice(0, i + 1).join("/"))));

  // Lignes
  const rows = rowsFor(a.entries, state.cwd, state.filter, state.sort);
  const body = $("#rows");
  body.replaceChildren(...rows.map((r) => {
    const [type, icon, cls] = typeOf(r.name, r.dir);
    const svg = ico(icon); svg.classList.add(cls);
    const name = el("td", { class: "name" }, svg, el("span", { "data-no-tr": "" }, r.name));
    if (r.encrypted) name.append(el("span", { class: "flag", title: "Fichier chiffré" }, ico("lock")));
    if (r.unsafe_path) name.append(el("span", { class: "flag", title: "Chemin dangereux neutralisé" }, ico("circle-alert")));
    const tr = el("tr", { "data-p": r.path, class: state.sel.has(r.path) ? "sel" : "" },
      name,
      el("td", { class: "r" }, r.dir && !r.size ? "" : human(r.size)),
      el("td", { class: "r muted" }, r.packed ? human(r.packed) : "—"),
      el("td", { class: "muted" }, type),
      el("td", { class: "muted" }, fmtDate(r.date)));
    if (r.dir) tr.dataset.dir = "1";
    return tr;
  }));
  $("#empty-dir").classList.toggle("hidden", rows.length > 0);
  $$("th[data-sort]").forEach((th) => {
    th.classList.toggle("sorted", th.dataset.sort === state.sort.key);
    th.classList.toggle("desc", th.dataset.sort === state.sort.key && state.sort.desc);
  });
  statusLine();
  refreshButtons();
}

export function go(path) { state.cwd = path; state.sel.clear(); render(); }
export function up() { if (state.cwd) go(state.cwd.includes("/") ? state.cwd.slice(0, state.cwd.lastIndexOf("/")) : ""); }
export function selectAll() { $$("#rows tr").forEach((r) => state.sel.add(r.dataset.p)); render(); }

const entry = (p) => state.arc?.entries.find((e) => e.path === p);

/** Saisit le mot de passe si l'archive contient des fichiers chiffrés. */
export async function ensurePassword() {
  const a = state.arc;
  if (a.encrypted && !a.password) {
    const pw = await askPassword(basename(a.file));
    if (pw === null) return false;
    a.password = pw;
    refreshButtons();
  }
  return true;
}

/** Ouvre un fichier de l'archive avec l'application par défaut (copie temporaire privée). */
export async function viewMember(member, allowDangerous = false) {
  if (!(await ensurePassword())) return;
  const r = await task("Ouverture du fichier…", () => api.openMember({ file: state.arc.file, member, password: state.arc.password, allowDangerous }));
  if (!r) return;
  if (r.error === "DANGEROUS") {
    const ok = await confirmBox("Fichier potentiellement dangereux",
      `« ${basename(member)} » est un programme ou un script. Ne l'ouvrez que si vous connaissez sa provenance.`, "Ouvrir quand même", "Annuler");
    return ok === true ? viewMember(member, true) : setStatus("Ouverture annulée");
  }
  if (api.isPwErr(r)) {
    state.arc.password = null;
    toast(api.errText(r), true);
    return viewMember(member, allowDangerous);
  }
  if (r.error) { setStatus("Échec de l'ouverture"); return toast(api.errText(r), true); }
  setStatus("Ouvert : " + basename(member));
}

export function viewSelected() {
  const f = [...state.sel].find((p) => !entry(p)?.dir);
  if (f) viewMember(f); else toast("Sélectionnez un fichier à ouvrir.", true);
}

// Clics dans le tableau : sélection (Ctrl / Maj), double-clic pour ouvrir
let last = null;
export function initArchiveView() {
  const body = $("#rows");
  body.addEventListener("click", (e) => {
    const tr = e.target.closest("tr"); if (!tr) return;
    const p = tr.dataset.p, all = $$("#rows tr").map((r) => r.dataset.p);
    if (e.shiftKey && last) {
      const [i, j] = [all.indexOf(last), all.indexOf(p)].sort((x, y) => x - y);
      if (!e.ctrlKey) state.sel.clear();
      all.slice(i, j + 1).forEach((x) => state.sel.add(x));
    } else if (e.ctrlKey || e.metaKey) { state.sel.has(p) ? state.sel.delete(p) : state.sel.add(p); last = p; }
    else { state.sel.clear(); state.sel.add(p); last = p; }
    $$("#rows tr").forEach((r) => r.classList.toggle("sel", state.sel.has(r.dataset.p)));
    statusLine();
  });
  body.addEventListener("dblclick", (e) => {
    const tr = e.target.closest("tr"); if (!tr) return;
    if (tr.dataset.dir) go(tr.dataset.p); else viewMember(tr.dataset.p);
  });
  $$("th[data-sort]").forEach((th) => th.addEventListener("click", () => {
    const k = th.dataset.sort;
    state.sort = { key: k, desc: state.sort.key === k ? !state.sort.desc : false };
    render();
  }));
  $("#filter").addEventListener("input", (e) => { state.filter = e.target.value; render(); });
}

/** Entrée sur une sélection : ouvrir le dossier ou le fichier. */
export function enterSelection() {
  if (state.sel.size !== 1) return;
  const p = [...state.sel][0];
  entry(p)?.dir ? go(p) : viewMember(p);
}
