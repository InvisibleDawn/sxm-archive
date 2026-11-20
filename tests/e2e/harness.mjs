// Banc d'essai de l'interface : sert l'interface COMPILÉE (dist/) avec la CSP de production de
// tauri.conf.json, dans Chrome sans écran, avec un faux moteur Tauri (window.__TAURI_INTERNALS__).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { chromium } from "playwright-core";

const root = process.cwd();
export const CHROME = [process.env.CHROME_PATH, "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium",
  "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome"].find((p) => p && fs.existsSync(p));

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };

export async function start({ lang = "fr", width = 1400, height = 900 } = {}) {
  if (!fs.existsSync(path.join(root, "dist/index.html")) || process.env.SXM_REBUILD !== "0") execSync("npx vite build", { stdio: "ignore" });
  const csp = JSON.parse(fs.readFileSync(path.join(root, "src-tauri/tauri.conf.json"), "utf8")).app.security.csp;
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/") p = "/index.html";
    const f = path.join(root, "dist", p);
    if (!f.startsWith(path.join(root, "dist")) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream", "Content-Security-Policy": csp });
    res.end(fs.readFileSync(f));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await chromium.launch({ executablePath: CHROME });
  const page = await browser.newPage({ viewport: { width, height }, locale: lang === "en" ? "en-US" : "fr-FR" });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.addInitScript(installMock, lang);
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForTimeout(600);
  return { page, errors, close: async () => { await browser.close(); server.close(); } };
}

/** Faux moteur : archive d'exemple, enregistrement des appels, réponses programmables. */
function installMock(lang) {
  localStorage.setItem("sxm.lang", lang);
  localStorage.setItem("sxm.updates.auto", "0");
  const entries = [
    { path: "Projet", size: 0, packed: 0, date: "2026-11-20 10:00:00", dir: true, encrypted: false, unsafe_path: false },
    { path: "Projet/Photos/IMG_0001.jpg", size: 2400000, packed: 2390000, date: "2026-11-19 09:12:00", dir: false, encrypted: false, unsafe_path: false },
    { path: "Projet/Photos/IMG_0002.jpg", size: 3100000, packed: 3080000, date: "2026-11-19 09:13:00", dir: false, encrypted: false, unsafe_path: false },
    { path: "Projet/Docs/rapport.pdf", size: 820000, packed: 610000, date: "2026-11-18 16:40:00", dir: false, encrypted: false, unsafe_path: false },
    { path: "Projet/Docs/budget.xlsx", size: 54000, packed: 21000, date: "2026-11-18 16:41:00", dir: false, encrypted: false, unsafe_path: false },
    { path: "Projet/installer.exe", size: 1200000, packed: 1100000, date: "2026-11-17 12:00:00", dir: false, encrypted: false, unsafe_path: false },
    { path: "Projet/notes.txt", size: 2300, packed: 900, date: "2026-11-20 08:30:00", dir: false, encrypted: false, unsafe_path: false },
  ];
  const calls = []; window.__calls = calls;
  window.__mock = {
    entries, existing: new Set(), picks: [], listPassword: null,
    update: null, // { version, current, notes } pour simuler une mise à jour
  };
  const M = window.__mock;
  const callbacks = new Map(); let cb = 1;
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { windowLabel: "main", label: "main" } },
    transformCallback: (f) => { const id = cb++; callbacks.set(id, f); window["_" + id] = f; return id; },
    unregisterCallback: (id) => callbacks.delete(id),
    convertFileSrc: (p) => p,
    invoke: async (c, a) => {
      calls.push([c, a]);
      switch (c) {
        case "plugin:event|listen": return 1;
        case "plugin:event|unlisten": return null;
        case "plugin:webview|...": return null;
        case "plugin:dialog|open": return M.picks.shift() ?? null;
        case "startup_args": return [];
        case "app_info": return { version: "3.0.0", platform: "linux", engine: "7-Zip 25.01", publisher: "Invisible_Dawn" };
        case "stat": return { exists: M.existing.has(a.path), dir: false, size: 0 };
        case "list":
          if (M.listPassword && a.password !== M.listPassword) return { error: a.password ? "PASSWORD_WRONG" : "PASSWORD_REQUIRED", detail: "" };
          return { entries: M.entries, archiveSize: 7000000, unsafeCount: M.entries.filter((e) => e.unsafe_path).length };
        case "extract": return { ok: true, out: a.req.dest, warnings: [] };
        case "test": return { ok: true, warnings: [] };
        case "compress": return { ok: true, out: a.req.out, warnings: [] };
        case "convert": return { ok: true, out: a.req.out, warnings: [] };
        case "open_member": return /\.exe$/i.test(a.req.member) && !a.req.allowDangerous ? { error: "DANGEROUS", detail: a.req.member } : { ok: true, warnings: [] };
        case "update_check": return M.update;
        default: return null;
      }
    },
  };
}

/** Appels reçus par le faux moteur pour une commande donnée. */
export const callsOf = (page, cmd) => page.evaluate((c) => window.__calls.filter(([n]) => n === c).map(([, a]) => a), cmd);
