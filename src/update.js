// Mises à jour (même fonctionnement que SXM PDF) : vérification discrète au démarrage, carte en bas à
// droite, jamais d'installation sans clic. Téléchargement et vérification de la signature côté Rust.
// Différence avec SXM PDF : sous Fedora, le paquet .rpm signé est installé par l'application
// (mot de passe administrateur demandé par le système) ; en cas d'échec, la page de la version s'ouvre.
// Version publiée sans fichier signé (u.manual) : « Télécharger » ouvre la page de la version.
import { invoke, Channel } from "@tauri-apps/api/core";
import * as db from "./store.js";
import { toast, el, modal } from "./ui.js";
import { state } from "./core.js";

const RELEASES = "https://github.com/InvisibleDawn/sxm-archive/releases";
export const isLinux = !navigator.userAgent.includes("Windows") && !navigator.userAgent.includes("Mac");

export const autoEnabled = () => db.get("sxm.updates.auto", "1") !== "0";
export const betaEnabled = () => db.get("sxm.updates.beta", "0") === "1";
const setAuto = (on) => db.set("sxm.updates.auto", on ? "1" : "0");
const setBeta = (on) => db.set("sxm.updates.beta", on ? "1" : "0");

let running = false;

/** Vérification discrète quelques secondes après le démarrage. */
export function autoCheck() {
  if (!autoEnabled()) return;
  setTimeout(async () => {
    try {
      const u = await invoke("update_check", { beta: betaEnabled() });
      if (u && db.get("sxm.updates.skip") !== u.version) notify(u);
    } catch { /* hors ligne : on réessaiera au prochain lancement */ }
  }, 5000);
}

/** Vérification demandée (menu ⋯, ruban Outils, À propos). */
export async function checkNow() {
  if (running) return;
  running = true;
  toast("Recherche des mises à jour…");
  try {
    const u = await invoke("update_check", { beta: betaEnabled() });
    if (u) await offer(u, false);
    else toast("Vous avez la dernière version de SXM Archive.");
  } catch (e) {
    toast("Impossible de vérifier les mises à jour. Vérifiez votre connexion Internet.\n" + String(e?.message || e), true);
  } finally { running = false; }
}

/** Petite carte en bas à droite : Installer, Nouveautés, Plus tard, Ignorer cette version. */
export function notify(u) {
  document.querySelector(".update-card")?.remove();
  const host = document.getElementById("toasts");
  const card = el("div", { class: "toast update-card", role: "status" });
  const close = () => card.remove();
  const small = (label, fn, cls = "btn") => el("button", { class: cls, onclick: fn }, label);
  card.append(
    el("div", { class: "uc-head" },
      el("b", {}, `SXM Archive ${u.version} est disponible`),
      el("button", { class: "uc-x", title: "Plus tard", "aria-label": "Plus tard", onclick: close }, "×")),
    el("div", { class: "uc-sub" }, `Vous utilisez la version ${u.current}.`),
    el("div", { class: "uc-row" },
      small(u.manual ? "Télécharger" : "Installer", () => { close(); install(u); }, "btn accent"),
      u.notes ? small("Nouveautés", () => { close(); offer(u, true); }) : null,
      small("Plus tard", close)),
    el("button", { class: "uc-skip", onclick: () => { db.set("sxm.updates.skip", u.version); close(); } }, "Ignorer cette version"));
  host.prepend(card);
  return card;
}

function offer(u, automatic) {
  return modal((m, close) => m.append(
    el("h2", {}, `SXM Archive ${u.version} est disponible`),
    el("p", {}, u.manual
      ? `Vous utilisez la version ${u.current}. Téléchargez la nouvelle version, puis installez-la par-dessus : vos réglages sont conservés.`
      : isLinux
      ? `Vous utilisez la version ${u.current}. La mise à jour est téléchargée, sa signature vérifiée, puis Fedora vous demande votre mot de passe pour l'installer.`
      : `Vous utilisez la version ${u.current}. La mise à jour est téléchargée, sa signature vérifiée, puis elle s'installe en un clic.`),
    u.notes ? el("div", {},
      el("b", {}, "Nouveautés"),
      el("pre", { "data-no-tr": "", style: "max-height:40vh;overflow:auto;white-space:pre-wrap;font:inherit;font-size:13px;background:var(--panel2);padding:10px 12px;border-radius:8px;user-select:text;margin:6px 0 0" }, u.notes)) : null,
    el("div", { class: "row end" },
      automatic ? el("button", { class: "btn", onclick: () => { db.set("sxm.updates.skip", u.version); close(); } }, "Ignorer cette version") : null,
      el("button", { class: "btn", onclick: () => close() }, "Plus tard"),
      el("button", { class: "btn accent", onclick: () => { close(); install(u); } }, u.manual ? "Télécharger" : "Installer maintenant"))));
}

const pageOf = (u) => (u.version ? `${RELEASES}/tag/v${u.version}` : `${RELEASES}/latest`);

async function install(u) {
  if (u.manual) {
    toast("La page de téléchargement s'ouvre dans votre navigateur.");
    return invoke("open_external", { url: pageOf(u) }).catch((e) => toast(String(e?.message || e), true));
  }
  if (state.busy) return toast("Une opération est en cours : attendez sa fin ou annulez-la.", true);
  const bar = el("div", { style: "height:8px;border-radius:4px;background:var(--accent);width:0%;transition:width .2s" });
  const label = el("p", {}, "Téléchargement…");
  let closeBox = () => {};
  modal((m, close) => {
    closeBox = close;
    m.append(el("h2", {}, `Mise à jour vers ${u.version}`), label,
      el("div", { style: "height:8px;border-radius:4px;background:var(--panel2);overflow:hidden" }, bar),
      el("p", { style: "font-size:12px" }, "Après le téléchargement, SXM Archive s'installe puis redémarre tout seul."));
  });
  const progress = new Channel();
  progress.onmessage = ([done, total]) => {
    const mo = (n) => (n / 1048576).toFixed(1);
    if (total) {
      bar.style.width = Math.min(100, (done / total) * 100).toFixed(1) + "%";
      label.textContent = `Téléchargement… ${mo(done)} / ${mo(total)} Mo`;
      if (done >= total) label.textContent = isLinux ? "Installation (mot de passe administrateur)…" : "Installation…";
    } else label.textContent = `Téléchargement… ${mo(done)} Mo`;
  };
  try {
    await invoke("update_install", { beta: betaEnabled(), progress });
  } catch (e) {
    closeBox();
    const msg = String(e?.message || e);
    if (msg === "SIGNATURE") return toast("La signature de la mise à jour est invalide : elle a été refusée par sécurité.", true);
    toast("La mise à jour a échoué : " + msg + `\nVous pouvez télécharger la nouvelle version sur ${RELEASES}`, true);
    if (isLinux) invoke("open_external", { url: pageOf(u) }).catch(() => {});
  }
}

/** Réglages affichés dans « À propos ». */
export function settingsBlock() {
  const check = (label, on, set) => {
    const c = el("input", { type: "checkbox" });
    c.checked = on;
    c.addEventListener("change", () => set(c.checked));
    return el("label", { class: "chk" }, c, label);
  };
  return el("div", { style: "display:flex;flex-direction:column;gap:6px" },
    el("b", {}, "Mises à jour"),
    check("Rechercher automatiquement au démarrage", autoEnabled(), setAuto),
    check("Recevoir aussi les versions de test (bêta)", betaEnabled(), setBeta));
}
