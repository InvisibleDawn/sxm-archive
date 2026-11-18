// Pont entre l'interface et le moteur Rust (Tauri 2)
(() => {
  const T = window.__TAURI__;
  const invoke = T.core.invoke;
  const dialog = T.dialog;
  const win = T.window.getCurrentWindow();
  const ARC = ['zip', '7z', 'rar', 'gz', 'tgz', 'tar'];
  const isWin = navigator.userAgent.includes('Windows');

  window.sxm = {
    list: (file, password) => invoke('list', { file, password: password || null }),
    extract: (req) => invoke('extract', { req }),
    test: (req) => invoke('test', { req }),
    compress: (req) => invoke('compress', { req }),
    convert: (req) => invoke('convert', { req }),
    openMember: (req) => invoke('open_member', { req }),
    showInFolder: (path) => invoke('show_in_folder', { path }),
    openPath: (path) => invoke('open_path', { path }),
    stat: (path) => invoke('stat', { path }),
    appInfo: () => invoke('app_info'),
    pickArchive: () => dialog.open({ title: 'Ouvrir une archive', multiple: false,
      filters: [{ name: 'Archives', extensions: ARC }, { name: 'Tous les fichiers', extensions: ['*'] }] }),
    pickFiles: () => dialog.open({ title: 'Fichiers à compresser', multiple: true }),
    pickFolderToAdd: () => dialog.open({ title: 'Dossier à compresser', directory: true, multiple: true }),
    pickDest: (defaultPath) => dialog.open({ title: 'Extraire vers…', directory: true, defaultPath }),
    setTheme: (t) => win.setTheme(t).catch(() => {}),
    setPinned: async (v) => { await win.setAlwaysOnTop(!!v); return !!v; },
    onProgress: (cb) => T.event.listen('progress', (e) => cb(e.payload)),
    onOpenFiles: (cb) => {
      T.event.listen('open-files', (e) => cb(e.payload));
      invoke('start_files').then((f) => f && f.length && cb(f));
    },
    onDragDrop: (onDrop, onHover) => T.webview.getCurrentWebview().onDragDropEvent((e) => {
      const t = e.payload.type;
      if (t === 'enter' || t === 'over') onHover(true);
      else if (t === 'leave') onHover(false);
      else if (t === 'drop') { onHover(false); onDrop(e.payload.paths || []); }
    }),
    sep: isWin ? '\\' : '/',
  };
})();
