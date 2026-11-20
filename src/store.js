// Réglages de l'interface (thème, langue, mises à jour). Peu de données : stockage local du navigateur
// intégré, propre à l'utilisateur. Toute lecture/écriture est protégée (stockage parfois indisponible).

export function get(key, def = null) {
  try { const v = localStorage.getItem(key); return v === null ? def : v; } catch { return def; }
}

export function set(key, value) {
  try { localStorage.setItem(key, value); } catch { /* stockage indisponible : réglage non mémorisé */ }
}
