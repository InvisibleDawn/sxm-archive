// État partagé et petits raccourcis DOM.
import {
  createElement, House, FolderOpen, PackagePlus, FolderOutput, Lock, ShieldCheck, Repeat, SunMoon, Pin, Info, FileArchive,
  Ellipsis, Archive, Wrench, HardDrive, ArrowUp, Eye, CheckCheck, KeyRound, FolderPlus, RefreshCw, LayoutGrid, Upload,
  Search, ChevronRight, Folder, File, FileImage, FileMusic, FileVideo, FileText, FileCode, CircleAlert,
} from "lucide";

/** Icônes utilisées (importées une à une : seules celles-ci sont embarquées). */
export const ICONS = {
  House, FolderOpen, PackagePlus, FolderOutput, Lock, ShieldCheck, Repeat, SunMoon, Pin, Info, FileArchive, Ellipsis,
  Archive, Wrench, HardDrive, ArrowUp, Eye, CheckCheck, KeyRound, FolderPlus, RefreshCw, LayoutGrid, Upload, Search,
  ChevronRight, Folder, File, FileImage, FileMusic, FileVideo, FileText, FileCode, CircleAlert,
};

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/** Archive ouverte : { file, entries (indexées), size, password, encrypted, unsafeCount } */
export const state = {
  arc: null,
  cwd: "",
  sel: new Set(),
  sort: { key: "name", desc: false },
  filter: "",
  busy: false,
};

const pascal = (n) => n.replace(/(^|-)([a-z0-9])/g, (_, __, c) => c.toUpperCase());
/** Icône lucide en élément SVG (pour le contenu créé dynamiquement). */
export function ico(name) {
  const node = ICONS[pascal(name)] || File;
  const svg = createElement(node);
  svg.classList.add("lucide");
  return svg;
}

export const isWindows = () => navigator.userAgent.includes("Windows");
export const sep = () => (isWindows() ? "\\" : "/");
