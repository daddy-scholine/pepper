import * as pdfjs from "./vendor/pdf.min.mjs";
pdfjs.GlobalWorkerOptions.workerSrc = new URL("./vendor/pdf.worker.min.mjs", import.meta.url).href;

/* =========================================================
   Small helpers
   ========================================================= */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function toast(msg, ms = 2600) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.add("hidden"), ms);
}

const ICONS = {
  back: '<path d="M15 5l-7 7 7 7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M16 16l5 5"/>',
  more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>',
  pen: '<path d="M4 20l1-4L16 5l3 3L8 19z"/><path d="M14 7l3 3"/>',
  hl: '<path d="M9 14l-4 4v2h4l1-1 8-8-4-4z"/><path d="M13 6l5 5"/>',
  eraser: '<path d="M8 20h11"/><path d="M5 15l8-9 6 6-6 8H8z"/>',
  lasso: '<path d="M12 4c5 0 9 2 9 5s-4 5-9 5-9-2-9-5 4-5 9-5z" stroke-dasharray="3 3"/><path d="M8 14c0 3 1 4 2 5s2 1 2 0"/>',
  hand: '<path d="M8 12V6a1.5 1.5 0 013 0v5M11 11V4.5a1.5 1.5 0 013 0V11M14 11V6a1.5 1.5 0 013 0v7c0 4-2 7-6 7-3 0-4-1.5-6-4l-1.5-2.5a1.5 1.5 0 012.5-1.5L8 14"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 010 12h-3"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 000 12h3"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  edit: '<path d="M4 20l1-4L16 5l3 3L8 19z"/>',
  trash: '<path d="M4 7h16M10 7V4h4v3M6 7l1 13h10l1-13"/>',
  next: '<path d="M9 5l7 7-7 7"/>',
  prev: '<path d="M15 5l-7 7 7 7"/>',
  split: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M14 4v16"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  list: '<path d="M4 7h2M9 7h11M4 12h2M9 12h11M4 17h2M9 17h11"/>',
};
const ic = (n, cls = "") => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n] || ""}</svg>`;

/* =========================================================
   Storage (IndexedDB)
   ========================================================= */
let _db;
function db() {
  if (_db) return _db;
  _db = new Promise((res, rej) => {
    const rq = indexedDB.open("pepper", 1);
    rq.onupgradeneeded = () => {
      const d = rq.result;
      d.createObjectStore("books", { keyPath: "id" });
      d.createObjectStore("blobs");
      d.createObjectStore("ink");
      d.createObjectStore("extracts", { keyPath: "id" });
    };
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
  return _db;
}
async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode);
    const r = fn(t.objectStore(store));
    t.oncomplete = () => res(r && r.result);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}
const dbGet = (s, k) => tx(s, "readonly", (o) => o.get(k));
const dbAll = (s) => tx(s, "readonly", (o) => o.getAll());
const dbPut = (s, v, k) => tx(s, "readwrite", (o) => (k === undefined ? o.put(v) : o.put(v, k)));
const dbDel = (s, k) => tx(s, "readwrite", (o) => o.delete(k));
async function dbKeys(s) { return tx(s, "readonly", (o) => o.getAllKeys()); }

/* =========================================================
   App state
   ========================================================= */
const SETTINGS_KEY = "pepper.settings";
const settings = Object.assign(
  { pencilOnly: true, penColor: "#14233B", hlColor: "#FFE14D", size: 1 },
  (() => { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"); } catch { return {}; } })()
);
const saveSettings = () => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {} };

const S = {
  books: [],
  extracts: [],
  tabs: [],
  active: null,
  nav: "notebooks",
  q: "",
  searching: false,
};
try { S.tabs = JSON.parse(localStorage.getItem("pepper.tabs") || "[]"); } catch {}
const saveTabs = () => { try { localStorage.setItem("pepper.tabs", JSON.stringify(S.tabs)); } catch {} };

const COVERS = ["#2D56B8", "#1B3358", "#7A1426", "#0E8F9B", "#8E1F2E", "#1E2A3A", "#2E7D4F", "#7A1F5C", "#B5651D"];
const KINDS = { table: "Table", flow: "Flowchart", cards: "Flashcards", image: "Image prompt", scenario: "Scenario", viva: "Viva script" };
const GROUPS = { table: ["table"], flow: ["flow"], cards: ["cards"], other: ["image", "scenario", "viva"] };

async function loadAll() {
  S.books = await dbAll("books");
  S.extracts = await dbAll("extracts");
  S.tabs = S.tabs.filter((id) => S.books.some((b) => b.id === id));
}
const bookById = (id) => S.books.find((b) => b.id === id);
const extractsOf = (bookId) => S.extracts.filter((x) => x.bookId === bookId);

/* =========================================================
   Library
   ========================================================= */
function navCount(key) {
  const by = (g) => S.extracts.filter((x) => GROUPS[g].includes(x.kind)).length;
  return {
    notebooks: S.books.length,
    pinned: S.books.filter((b) => b.pinned).length,
    all: S.extracts.length,
    table: by("table"),
    flow: by("flow"),
    cards: by("cards"),
    other: by("other"),
  }[key];
}

function renderLibrary() {
  const nav = (key, label, cls = "", showCount = true) =>
    `<button class="nav ${cls} ${S.nav === key ? "on" : ""}" data-nav="${key}"><span>${label}</span>${showCount && navCount(key) !== undefined ? `<span class="n">${navCount(key)}</span>` : ""}</button>`;
  const studyKeys = ["all", "table", "flow", "cards", "other", "exports"];
  const titles = { notebooks: "Notebooks", pinned: "Pinned", all: "All extracts", table: "Tables", flow: "Flowcharts", cards: "Flashcards", other: "Scenarios and viva", exports: "Exports" };

  let content = "";
  if (S.nav === "notebooks" || S.nav === "pinned") {
    let books = S.books.slice().sort((a, b) => (b.opened || b.created) - (a.opened || a.created));
    if (S.nav === "pinned") books = books.filter((b) => b.pinned);
    if (S.q) books = books.filter((b) => b.title.toLowerCase().includes(S.q.toLowerCase()));
    content = `<div class="grid">${
      books.length
        ? books.map(bookCard).join("")
        : `<div class="empty"><b>${S.q ? "No notebook matches that." : S.nav === "pinned" ? "Nothing pinned yet." : "No notebooks yet."}</b><br>${S.nav === "notebooks" && !S.q ? "Tap the + button to import a PDF or start a blank notebook." : ""}</div>`
    }</div>`;
  } else if (S.nav === "exports") {
    content = `<div class="xlist">${exportCards()}</div>`;
  } else {
    const groupKinds = S.nav === "all" ? Object.keys(KINDS) : GROUPS[S.nav];
    const xs = S.extracts.filter((x) => groupKinds.includes(x.kind));
    const byBook = {};
    xs.forEach((x) => (byBook[x.bookId] ||= []).push(x));
    const parts = Object.keys(byBook).map((id) => {
      const b = bookById(id);
      const items = byBook[id].sort((a, b2) => a.page - b2.page || a.created - b2.created);
      return `<h3>${esc(b ? b.title : "Deleted notebook")} <span>${items.length} extract${items.length > 1 ? "s" : ""}</span></h3>${items.map((x) => extractBlock(x, { showPage: true, open: true })).join("")}`;
    });
    content = `<div class="xlist">${parts.join("") || `<div class="empty">Nothing here yet.<br>Open a notebook, lasso a part of a page and use <b>Send to AI</b>. Replies you save show up here.</div>`}</div>`;
  }

  $("#lib").innerHTML = `
  <aside>
    <div class="logo"><img src="icons/icon-192.png" alt=""><span>Pepper</span></div>
    ${nav("notebooks", "Notebooks")}
    ${nav("pinned", "Pinned")}
    <div class="rule"></div>
    <div class="navhead">Study</div>
    ${nav("all", "All extracts", "study")}
    ${nav("table", "Tables", "sub")}
    ${nav("flow", "Flowcharts", "sub")}
    ${nav("cards", "Flashcards", "sub")}
    ${nav("other", "Scenarios and viva", "sub")}
    ${nav("exports", "Exports", "", false)}
    <div class="rule"></div>
    <button class="nav" data-act="settings"><span>Settings and backup</span></button>
  </aside>
  <main>
    <div class="libtop">
      <h1>${titles[S.nav]}</h1>
      ${S.searching ? `<input class="field" id="q" style="max-width:260px" placeholder="Search notebooks" value="${esc(S.q)}">` : ""}
      <button class="iconbtn" data-act="search" aria-label="Search">${ic("search")}</button>
      <button class="iconbtn" data-act="settings" aria-label="Settings">${ic("gear")}</button>
    </div>
    ${content}
    <button class="fab" data-act="new" aria-label="New notebook">${ic("plus")}</button>
  </main>`;
  const q = $("#q");
  if (q) {
    q.addEventListener("input", () => { S.q = q.value; renderLibrary(); const n = $("#q"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); });
  }
}

function bookCard(b) {
  const n = extractsOf(b.id).length;
  const style = b.thumb ? `background-image:url(${b.thumb})` : `background:${b.color}`;
  return `<div class="book" data-open="${b.id}">
    ${n ? `<span class="badge">${n} extract${n > 1 ? "s" : ""}</span>` : ""}
    <div class="cover" style="${style}">${b.thumb ? "" : esc(b.title)}</div>
    <div class="t">${b.pinned ? "\u{1F4CC} " : ""}${esc(b.title)}</div>
    <button class="more" data-menu="${b.id}" aria-label="Notebook options"><span>${ic("more").replace('class="ic ', 'style="width:18px;height:18px" class="ic ')}</span></button>
  </div>`;
}

function exportCards() {
  const cards = S.extracts.filter((x) => x.kind === "cards" && x.anki);
  const n = countCards(cards);
  return `
  <div class="xcard"><div class="row"><h3 style="flex:1">Anki</h3><span class="chip">Automatic file</span></div>
    <p>One text file you import in Anki (File, Import). It uses the Basic and Cloze note types and puts each notebook in its own sub-deck under Pepper. Only flashcard blocks you marked <b>Add to Anki</b> are included.</p>
    <div class="row"><b>${n.basic}</b> question cards <b>${n.cloze}</b> cloze cards <button class="btn primary" data-act="export-anki" ${n.basic + n.cloze ? "" : "disabled"}>Export for Anki</button></div></div>
  <div class="xcard"><div class="row"><h3 style="flex:1">NotebookLM and ChatGPT</h3><span class="chip" style="background:#FBEFD2;color:#6B4A00">You upload it</span></div>
    <p>One clean Markdown source file per notebook with every table, flowchart, card and scenario, ordered by page. There is no direct push, so add the file as a source in the other app.</p>
    <div class="row">${S.books.length ? S.books.map((b) => `<button class="btn" data-act="export-md" data-id="${b.id}">${esc(b.title).slice(0, 28)}</button>`).join("") : "<span style='color:var(--muted)'>No notebooks yet.</span>"}</div></div>
  <div class="xcard"><div class="row"><h3 style="flex:1">Backup</h3><span class="chip">Automatic file</span></div>
    <p>Your ink, extracts and notebook list as one file. PDFs are not inside it (they can be large), so re-attach a PDF when you restore on a new device.</p>
    <div class="row"><button class="btn dark" data-act="backup">Back up everything</button><button class="btn" data-act="restore">Restore from backup</button></div></div>`;
}

function countCards(xs) {
  let basic = 0, cloze = 0;
  xs.forEach((x) => parseCards(x.body).forEach((c) => (c.t === "q" ? basic++ : cloze++)));
  return { basic, cloze };
}

/* ---- library events ---- */
document.addEventListener("click", async (e) => {
  const t = e.target;
  const navBtn = t.closest("[data-nav]");
  if (navBtn) { S.nav = navBtn.dataset.nav; renderLibrary(); return; }
  const menuBtn = t.closest("[data-menu]");
  if (menuBtn) { e.stopPropagation(); bookMenu(menuBtn.dataset.menu); return; }
  const openBtn = t.closest("[data-open]");
  if (openBtn && $("#lib").contains(openBtn)) { openBook(openBtn.dataset.open); return; }
  const act = t.closest("[data-act]");
  if (!act) return;
  const a = act.dataset.act;
  if (a === "new") newMenu();
  else if (a === "search") { S.searching = !S.searching; if (!S.searching) S.q = ""; renderLibrary(); if (S.searching) $("#q")?.focus(); }
  else if (a === "settings") settingsModal();
  else if (a === "export-anki") exportAnki();
  else if (a === "export-md") exportMarkdown(act.dataset.id);
  else if (a === "backup") backup();
  else if (a === "restore") $("#json-input").click();
});

function newMenu() {
  modal(`<div class="modal sm"><header><h2>New</h2><button class="iconbtn" data-close aria-label="Close">${ic("x")}</button></header>
  <div class="menu"><button data-do="pdf">Import PDF or book</button><button data-do="blank">Blank notebook</button></div></div>`, (m, close) => {
    $('[data-do="pdf"]', m).onclick = () => { close(); $("#pdf-input").click(); };
    $('[data-do="blank"]', m).onclick = () => { close(); blankModal(); };
  });
}

function blankModal() {
  modal(`<div class="modal sm"><header><h2>Blank notebook</h2><button class="iconbtn" data-close aria-label="Close">${ic("x")}</button></header>
  <div style="padding:20px;display:flex;flex-direction:column;gap:14px"><input class="field" id="nm" placeholder="Name" value="Untitled">
  <label style="display:flex;gap:10px;align-items:center"><input type="checkbox" id="ruled" checked style="width:22px;height:22px"> Ruled paper</label>
  <button class="btn primary" id="go">Create</button></div></div>`, (m, close) => {
    $("#go", m).onclick = async () => {
      const b = { id: uid(), title: $("#nm", m).value.trim() || "Untitled", kind: "blank", pages: 1, ruled: $("#ruled", m).checked, color: COVERS[Math.floor(Math.random() * COVERS.length)], created: Date.now(), lastPage: 1 };
      await dbPut("books", b); S.books.push(b); close(); renderLibrary(); openBook(b.id);
    };
  });
}

$("#pdf-input").addEventListener("change", async (e) => {
  const files = [...e.target.files];
  e.target.value = "";
  if (pendingAttach) { const id = pendingAttach; pendingAttach = null; if (files[0]) await attachPdf(id, files[0]); return; }
  for (const f of files) await importPdf(f);
});
let pendingAttach = null;

async function readPdfInfo(buf) {
  const task = pdfjs.getDocument({ data: new Uint8Array(buf.slice(0)) });
  const doc = await task.promise;
  const page = await doc.getPage(1);
  const vp = page.getViewport({ scale: 1 });
  const sc = 240 / vp.width;
  const v = page.getViewport({ scale: sc });
  const c = document.createElement("canvas");
  c.width = v.width; c.height = v.height;
  await page.render({ canvas: c, canvasContext: c.getContext("2d"), viewport: v }).promise;
  const thumb = c.toDataURL("image/jpeg", 0.7);
  const pages = doc.numPages;
  try { await task.destroy(); } catch {}
  return { pages, thumb };
}

async function importPdf(file) {
  try {
    toast("Importing " + file.name + "...", 8000);
    const buf = await file.arrayBuffer();
    const info = await readPdfInfo(buf);
    const b = { id: uid(), title: file.name.replace(/\.pdf$/i, ""), kind: "pdf", pages: info.pages, thumb: info.thumb, color: COVERS[Math.floor(Math.random() * COVERS.length)], created: Date.now(), lastPage: 1 };
    await dbPut("blobs", new Blob([buf], { type: "application/pdf" }), b.id);
    await dbPut("books", b);
    S.books.push(b);
    S.nav = "notebooks";
    renderLibrary();
    toast("Imported " + b.title);
  } catch (err) {
    console.error(err);
    toast("Could not read that PDF.");
  }
}

async function attachPdf(id, file) {
  const buf = await file.arrayBuffer();
  const info = await readPdfInfo(buf);
  const b = bookById(id);
  b.pages = info.pages; b.thumb = b.thumb || info.thumb;
  await dbPut("blobs", new Blob([buf], { type: "application/pdf" }), id);
  await dbPut("books", b);
  closeModal();
  openBook(id);
}

function bookMenu(id) {
  const b = bookById(id);
  modal(`<div class="modal sm"><header><h2>${esc(b.title).slice(0, 40)}</h2><button class="iconbtn" data-close aria-label="Close">${ic("x")}</button></header>
  <div class="menu"><button data-do="open">Open</button><button data-do="rename">Rename</button><button data-do="pin">${b.pinned ? "Unpin" : "Pin"}</button><button data-do="md">Export source file (Markdown)</button><button class="dng" data-do="del">Delete notebook</button></div></div>`, (m, close) => {
    $('[data-do="open"]', m).onclick = () => { close(); openBook(id); };
    $('[data-do="rename"]', m).onclick = () => { close(); renameModal(id); };
    $('[data-do="pin"]', m).onclick = async () => { b.pinned = !b.pinned; await dbPut("books", b); close(); renderLibrary(); };
    $('[data-do="md"]', m).onclick = () => { close(); exportMarkdown(id); };
    $('[data-do="del"]', m).onclick = () => { close(); confirmModal(`Delete "${b.title}"?`, "Its ink and extracts are removed from this device too.", "Delete", () => deleteBook(id)); };
  });
}

function renameModal(id) {
  const b = bookById(id);
  modal(`<div class="modal sm"><header><h2>Rename</h2><button class="iconbtn" data-close aria-label="Close">${ic("x")}</button></header>
  <div style="padding:20px;display:flex;flex-direction:column;gap:14px"><input class="field" id="nm" value="${esc(b.title)}"><button class="btn primary" id="go">Save</button></div></div>`, (m, close) => {
    $("#go", m).onclick = async () => { b.title = $("#nm", m).value.trim() || b.title; await dbPut("books", b); close(); renderLibrary(); };
  });
}

function confirmModal(title, text, label, fn) {
  modal(`<div class="modal sm"><header><h2>${esc(title)}</h2></header><div style="padding:20px;display:flex;flex-direction:column;gap:16px"><div style="color:var(--muted);line-height:1.5">${esc(text)}</div>
  <div class="row"><button class="btn danger" id="yes">${esc(label)}</button><button class="btn" data-close>Cancel</button></div></div></div>`, (m, close) => {
    $("#yes", m).onclick = async () => { close(); await fn(); };
  });
}

async function deleteBook(id) {
  await dbDel("books", id); await dbDel("blobs", id);
  for (const k of await dbKeys("ink")) if (String(k).startsWith(id + ":")) await dbDel("ink", k);
  for (const x of extractsOf(id)) await dbDel("extracts", x.id);
  S.books = S.books.filter((b) => b.id !== id);
  S.extracts = S.extracts.filter((x) => x.bookId !== id);
  S.tabs = S.tabs.filter((t) => t !== id); saveTabs();
  renderLibrary();
}

/* =========================================================
   Modal helper
   ========================================================= */
let closeFn = null;
function modal(html, onMount) {
  closeModal();
  const root = $("#modal-root");
  root.innerHTML = `<div class="scrim">${html}</div>`;
  const scrim = root.firstElementChild;
  const m = scrim;
  const close = () => { root.innerHTML = ""; closeFn = null; };
  closeFn = close;
  $$("[data-close]", m).forEach((b) => (b.onclick = close));
  scrim.addEventListener("pointerdown", (e) => { if (e.target === scrim && scrim.dataset.sticky !== "1") close(); });
  onMount && onMount(m, close);
  return close;
}
function closeModal() { closeFn && closeFn(); }

/* =========================================================
   Extract parsing and rendering
   ========================================================= */
function parseTables(md) {
  const lines = md.split(/\r?\n/);
  const out = [];
  let title = "", cur = null;
  const cells = (l) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
  for (const raw of lines) {
    const l = raw.trim();
    if (/^\|/.test(l)) {
      if (!cur) { cur = { title, head: null, rows: [] }; title = ""; }
      if (/^\|?\s*:?-{2,}/.test(l.replace(/\s/g, "")) || /^\|[\s:|-]+\|?$/.test(l)) continue;
      const c = cells(l);
      if (!cur.head) cur.head = c; else cur.rows.push(c);
    } else {
      if (cur) { out.push(cur); cur = null; }
      if (l) title = l.replace(/^#+\s*/, "").replace(/\*\*/g, "");
    }
  }
  if (cur) out.push(cur);
  return out;
}

function parseFlow(text) {
  const out = { title: "", chains: [], notes: [] };
  text.split(/\r?\n/).forEach((raw) => {
    const l = raw.trim();
    if (!l) return;
    if (/^#+\s/.test(l)) { out.title = out.title || l.replace(/^#+\s*/, ""); return; }
    if (/->|→/.test(l)) out.chains.push(l.replace(/^[-*\d.)\s]+/, "").split(/\s*(?:->|→)\s*/).filter(Boolean));
    else out.notes.push(l);
  });
  return out;
}

function parseCards(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const cards = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(?:[-*]\s*|\d+[.)]\s*)?(Q|C)\s*:{1,2}\s*(.+)$/i);
    if (!m) continue;
    if (m[1].toUpperCase() === "C") { cards.push({ t: "c", text: m[2] }); continue; }
    let q = m[2], a = "";
    if (q.includes("||")) { [q, a] = q.split("||").map((s) => s.trim()); }
    else if (lines[i + 1] && /^(?:[-*]\s*)?A\s*:{1,2}\s*/i.test(lines[i + 1])) { a = lines[i + 1].replace(/^(?:[-*]\s*)?A\s*:{1,2}\s*/i, ""); i++; }
    cards.push({ t: "q", q, a });
  }
  return cards;
}

function extractBlock(x, opt = {}) {
  const b = bookById(x.bookId);
  let content = "";
  if (x.kind === "table") {
    const tbls = parseTables(x.body);
    content = tbls.length
      ? tbls.map((t) => `${t.title ? `<div class="tt">${esc(t.title)}</div>` : ""}<div style="overflow:auto"><table><thead><tr>${(t.head || []).map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${t.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`).join("")
      : `<div class="notetxt">${esc(x.body)}</div>`;
  } else if (x.kind === "flow") {
    const f = parseFlow(x.body);
    content = (f.title ? `<div class="tt">${esc(f.title)}</div>` : "") +
      (f.chains.length
        ? f.chains.map((ch) => `<div class="flow">${ch.map((n, i) => `${i ? '<span class="ar">&rarr;</span>' : ""}<div class="node ${i === ch.length - 1 && ch.length > 1 ? "end" : ""}">${esc(n)}</div>`).join("")}</div>`).join("")
        : `<div class="notetxt">${esc(x.body)}</div>`) +
      f.notes.map((n) => `<div class="notetxt" style="color:var(--muted)">${esc(n)}</div>`).join("");
  } else if (x.kind === "cards") {
    const cards = parseCards(x.body);
    content = cards.length
      ? cards.map((c) => c.t === "q"
        ? `<div class="card"><span class="k">Q</span><div>${esc(c.q)}${c.a ? `<span class="a">${esc(c.a)}</span>` : ""}</div></div>`
        : `<div class="card"><span class="k">C</span><div>${esc(c.text).replace(/\{\{c\d+::(.*?)(?:::.*?)?\}\}/g, (_, a) => `<span class="cz" data-a="${a}">[...]</span>`)}</div></div>`).join("")
      : `<div class="notetxt">${esc(x.body)}</div>`;
    content += `<div class="row"><button class="btn ${x.anki ? "primary" : ""}" data-x="anki" data-id="${x.id}">${x.anki ? "Added to Anki" : "Add to Anki"}</button><span style="font-size:13px;color:var(--muted)">${cards.length} card${cards.length === 1 ? "" : "s"}</span></div>`;
  } else {
    content = `<div class="notetxt">${esc(x.body)}</div>`;
  }
  return `<section class="xb" data-xid="${x.id}">
    <div class="xh"><span class="chip">${KINDS[x.kind] || x.kind}</span><span class="grow">${opt.showPage ? "Page " + x.page + " &middot; " : ""}${x.crop ? "From selection" : "Pasted"}</span>
      <button class="iconbtn" data-x="edit" data-id="${x.id}" aria-label="Edit">${ic("edit")}</button>
      <button class="iconbtn" data-x="del" data-id="${x.id}" aria-label="Delete">${ic("trash")}</button></div>
    ${x.crop ? `<img class="crop" src="${x.crop}" alt="Selected part of the page">` : ""}
    ${content}
  </section>`;
}

// events for extract blocks (library and reader panel share this)
document.addEventListener("click", async (e) => {
  const cz = e.target.closest(".cz");
  if (cz) { const a = cz.dataset.a; cz.textContent = cz.textContent === "[...]" ? a : "[...]"; return; }
  const b = e.target.closest("[data-x]");
  if (!b) return;
  const x = S.extracts.find((q) => q.id === b.dataset.id);
  if (!x) return;
  if (b.dataset.x === "anki") { x.anki = !x.anki; await dbPut("extracts", x); refreshExtracts(); toast(x.anki ? "Marked for the Anki export" : "Removed from the Anki export"); }
  else if (b.dataset.x === "del") confirmModal("Delete this extract?", "It is removed from this page.", "Delete", async () => { await dbDel("extracts", x.id); S.extracts = S.extracts.filter((q) => q.id !== x.id); refreshExtracts(); });
  else if (b.dataset.x === "edit") editExtract(x);
});

function refreshExtracts() {
  if (!$("#lib").classList.contains("hidden")) renderLibrary();
  if (R) renderPanel();
}

function editExtract(x) {
  modal(`<div class="modal"><header><h2>Edit ${KINDS[x.kind] || "extract"}</h2><button class="iconbtn" data-close aria-label="Close">${ic("x")}</button></header>
  <div style="padding:20px;display:flex;flex-direction:column;gap:14px"><textarea class="promptbox" id="body" style="height:300px;resize:vertical">${esc(x.body)}</textarea><button class="btn primary" id="go">Save</button></div></div>`, (m, close) => {
    $("#go", m).onclick = async () => { x.body = $("#body", m).value; await dbPut("extracts", x); close(); refreshExtracts(); };
  });
}

/* =========================================================
   Export and backup
   ========================================================= */
function download(name, data, type = "text/plain") {
  const blob = data instanceof Blob ? data : new Blob([data], { type: type + ";charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function exportAnki() {
  const xs = S.extracts.filter((x) => x.kind === "cards" && x.anki);
  const f = (s) => String(s).replace(/\t/g, " ").replace(/\r?\n/g, "<br>");
  const rows = [];
  xs.forEach((x) => {
    const b = bookById(x.bookId);
    const deck = "Pepper::" + (b ? b.title.replace(/::/g, "-") : "Notes");
    const tag = "pepper";
    parseCards(x.body).forEach((c) => {
      if (c.t === "q") rows.push(["Basic", deck, f(c.q), f(c.a), tag].join("\t"));
      else rows.push(["Cloze", deck, f(c.text), "", tag].join("\t"));
    });
  });
  if (!rows.length) return toast("No cards marked for Anki yet.");
  const head = ["#separator:tab", "#html:true", "#notetype column:1", "#deck column:2", "#tags column:5"].join("\n");
  download("pepper-anki.txt", head + "\n" + rows.join("\n") + "\n");
  toast(rows.length + " cards exported. In Anki: File, Import.");
}

function exportMarkdown(id) {
  const b = bookById(id);
  const xs = extractsOf(id).sort((a, c) => a.page - c.page || a.created - c.created);
  let md = `# ${b.title}\n\nSource file made with Pepper. Each section is an extract made from one page of the notebook.\n`;
  let page = 0;
  xs.forEach((x) => {
    if (x.page !== page) { page = x.page; md += `\n## Page ${page}\n`; }
    md += `\n### ${KINDS[x.kind] || x.kind}\n\n${x.body.trim()}\n`;
  });
  if (!xs.length) md += "\n(No extracts yet.)\n";
  download(b.title.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "_") + "_source.md", md, "text/markdown");
}

async function backup() {
  const ink = {};
  for (const k of await dbKeys("ink")) ink[k] = await dbGet("ink", k);
  const data = { app: "pepper", v: 1, at: new Date().toISOString(), books: S.books, extracts: S.extracts, ink };
  download("pepper-backup-" + new Date().toISOString().slice(0, 10) + ".json", JSON.stringify(data), "application/json");
  toast("Backup saved to your Files.");
}

$("#json-input").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (d.app !== "pepper") throw new Error("not a Pepper backup");
    for (const b of d.books || []) { const had = S.books.find((x) => x.id === b.id); if (!had) { await dbPut("books", b); } }
    for (const x of d.extracts || []) await dbPut("extracts", x);
    for (const [k, v] of Object.entries(d.ink || {})) await dbPut("ink", v, k);
    await loadAll();
    renderLibrary();
    toast("Backup restored. Re-attach PDFs by opening those notebooks.");
  } catch (err) { console.error(err); toast("That file is not a Pepper backup."); }
});

function settingsModal() {
  modal(`<div class="modal sm"><header><h2>Settings and backup</h2><button class="iconbtn" data-close aria-label="Close">${ic("x")}</button></header>
  <div style="padding:20px;display:flex;flex-direction:column;gap:16px">
    <label style="display:flex;gap:12px;align-items:flex-start;line-height:1.4"><input type="checkbox" id="po" ${settings.pencilOnly ? "checked" : ""} style="width:24px;height:24px;flex:none;margin-top:2px"><span><b>Apple Pencil only draws</b><br><span style="color:var(--muted);font-size:14px">Your finger scrolls and zooms the page. Turn off to draw with a finger too.</span></span></label>
    <div class="row"><button class="btn dark" id="bk">Back up everything</button><button class="btn" id="rs">Restore from backup</button></div>
    <div style="color:var(--muted);font-size:13px;line-height:1.5">Everything is stored on this device only. Pepper 0.1</div>
  </div></div>`, (m) => {
    $("#po", m).onchange = (e) => { settings.pencilOnly = e.target.checked; saveSettings(); R && updateInkMode(); };
    $("#bk", m).onclick = backup;
    $("#rs", m).onclick = () => $("#json-input").click();
  });
}

/* =========================================================
   Reader
   ========================================================= */
let R = null; // current reader state
const BASE = 1000; // page width in drawing units
const PEN_COLORS = ["#14233B", "#D4261C", "#2F6FDB", "#1E8E4A"];
const HL_COLORS = ["#FFE14D", "#FF9CB5", "#8EE6A8", "#9CD2FF"];
const SIZES = { pen: [1.6, 2.8, 4.6], hl: [14, 22, 32], eraser: [10, 16, 26] };
let tool = "pen";
const docCache = new Map();

async function openBook(id) {
  const b = bookById(id);
  if (!b) return;
  if (b.kind === "pdf") {
    const blob = await dbGet("blobs", id);
    if (!blob) {
      modal(`<div class="modal sm"><header><h2>PDF file needed</h2><button class="iconbtn" data-close aria-label="Close">${ic("x")}</button></header>
      <div style="padding:20px;display:flex;flex-direction:column;gap:14px;line-height:1.5"><div>This notebook came from a backup, which does not contain the PDF itself. Choose the same PDF again to continue. Your ink and extracts will line up.</div><button class="btn primary" id="pick">Choose PDF</button></div></div>`, (m) => {
        $("#pick", m).onclick = () => { pendingAttach = id; $("#pdf-input").click(); };
      });
      return;
    }
  }
  b.opened = Date.now(); dbPut("books", b);
  if (!S.tabs.includes(id)) S.tabs.push(id);
  saveTabs();
  S.active = id;
  $("#lib").classList.add("hidden");
  $("#reader").classList.remove("hidden");
  await mountReader(b);
}

function backToLibrary() {
  saveInk(true);
  R && R.ro && R.ro.disconnect();
  R = null;
  S.active = null;
  $("#reader").classList.add("hidden");
  $("#lib").classList.remove("hidden");
  renderLibrary();
}

async function mountReader(b) {
  if (R) { await saveInk(true); R.ro && R.ro.disconnect(); }
  const prevPanel = R ? R.panelOpen : false;
  R = {
    book: b, pdf: null, page: b.lastPage || 1, zoom: 1, strokes: [], undo: [], redo: [], sel: null,
    panelOpen: prevPanel, filter: "all", scope: "page", cssW: 0, cssH: 0, k: 1, dpr: Math.min(window.devicePixelRatio || 1, 2), tok: 0, saveT: null,
  };
  if (b.kind === "pdf") {
    let entry = docCache.get(b.id);
    if (!entry) {
      const blob = await dbGet("blobs", b.id);
      const buf = await blob.arrayBuffer();
      entry = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
      docCache.set(b.id, entry);
    }
    R.pdf = entry;
    b.pages = entry.numPages;
  }
  R.page = clamp(R.page, 1, b.pages);
  buildReaderShell();
  await showPage(R.page);
}

function buildReaderShell() {
  const tabs = S.tabs.map((id) => bookById(id)).filter(Boolean)
    .map((b) => `<button class="tab ${b.id === R.book.id ? "on" : ""}" data-tab="${b.id}"><span class="tt">${esc(b.title)}</span><span class="x" data-closetab="${b.id}" role="button" aria-label="Close tab">${ic("x").replace('class="ic ', 'style="width:14px;height:14px" class="ic ')}</span></button>`).join("");
  const toolBtn = (id, icon, label) => `<button data-tool="${id}" class="${tool === id ? "on" : ""}" aria-label="${label}">${ic(icon)}</button>`;
  $("#reader").innerHTML = `
  <div class="topbar">
    <button class="iconbtn" data-r="back" aria-label="Library">${ic("back")}</button>
    <div class="tabs">${tabs}</div>
    <button class="xbtn ${R.panelOpen ? "on" : ""}" data-r="extracts">${ic("split").replace('class="ic ', 'style="width:20px;height:20px" class="ic ')}<span>${R.panelOpen ? "Hide extracts" : "Show extracts"}</span></button>
    <button class="iconbtn" data-r="more" aria-label="More">${ic("more")}</button>
  </div>
  <div class="rbody">
    <nav class="tools" aria-label="Tools">
      ${toolBtn("pen", "pen", "Pen")}${toolBtn("hl", "hl", "Highlighter")}${toolBtn("eraser", "eraser", "Eraser")}${toolBtn("lasso", "lasso", "Lasso select")}${toolBtn("hand", "hand", "Hand")}
      <div class="sep"></div>
      <button data-r="undo" aria-label="Undo">${ic("undo")}</button><button data-r="redo" aria-label="Redo">${ic("redo")}</button>
      <div class="sep"></div>
      <div id="dots"></div>
      <div class="sep"></div>
      <button data-r="size" aria-label="Stroke size"><svg width="26" height="26" viewBox="0 0 26 26"><circle id="sizedot" cx="13" cy="13" r="4" fill="#3A4A60"/></svg></button>
    </nav>
    <div class="stage" id="stage"><div class="pagewrap" id="pw"><canvas id="pdfc"></canvas><canvas id="ink" style="mix-blend-mode:multiply"></canvas><canvas id="live"></canvas></div>
      <div class="pager"><button data-r="zout" aria-label="Zoom out"><span style="font-size:22px;padding:0">&minus;</span></button><button data-r="prev" aria-label="Previous page">${ic("prev")}</button><input id="pgin" inputmode="numeric" aria-label="Page number"><span id="pgtot"></span><button data-r="next" aria-label="Next page">${ic("next")}</button><button data-r="zin" aria-label="Zoom in"><span style="font-size:22px;padding:0">+</span></button></div>
    </div>
    <aside class="panel ${R.panelOpen ? "open" : ""}" id="panel"><div class="in" id="panelin"></div></aside>
  </div>`;
  renderDots(); renderSizeDot(); renderPanel();
  wireInk();
  $("#pgin").addEventListener("change", (e) => goPage(parseInt(e.target.value, 10) || R.page));
  $("#pgin").addEventListener("focus", (e) => e.target.select());
  const me = R;
  R.ro = new ResizeObserver(() => { if (R !== me) return; clearTimeout(R.rt); R.rt = setTimeout(() => { const w = $("#stage").clientWidth; if (Math.abs(w - (R.lastStageW || 0)) > 2) { R.lastStageW = w; showPage(R.page, true); } }, 120); });
  R.ro.observe($("#stage"));
  R.lastStageW = $("#stage").clientWidth;
}

$("#reader").addEventListener("click", async (e) => {
  const t = e.target;
  const tb = t.closest("[data-tool]");
  if (tb) { setTool(tb.dataset.tool); return; }
  const ct = t.closest("[data-closetab]");
  if (ct) { e.stopPropagation(); closeTab(ct.dataset.closetab); return; }
  const tab = t.closest("[data-tab]");
  if (tab) { if (tab.dataset.tab !== R.book.id) { await saveInk(true); R.book.lastPage = R.page; await dbPut("books", R.book); openBook(tab.dataset.tab); } return; }
  const c = t.closest("[data-color]");
  if (c) { if (tool === "hl") settings.hlColor = c.dataset.color; else settings.penColor = c.dataset.color; saveSettings(); renderDots(); return; }
  const f = t.closest("[data-filter]");
  if (f) { R.filter = f.dataset.filter; renderPanel(); return; }
  const sc = t.closest("[data-scope]");
  if (sc) { R.scope = R.scope === "page" ? "book" : "page"; renderPanel(); return; }
  const m = t.closest("[data-sel]");
  if (m) { selAction(m.dataset.sel); return; }
  const r = t.closest("[data-r]");
  if (!r) return;
  const a = r.dataset.r;
  if (a === "back") { R.book.lastPage = R.page; dbPut("books", R.book); backToLibrary(); }
  else if (a === "extracts") { R.panelOpen = !R.panelOpen; $("#panel").classList.toggle("open", R.panelOpen); r.classList.toggle("on", R.panelOpen); r.querySelector("span").textContent = R.panelOpen ? "Hide extracts" : "Show extracts"; renderPanel(); }
  else if (a === "undo") undo();
  else if (a === "redo") redo();
  else if (a === "size") { settings.size = (settings.size + 1) % 3; saveSettings(); renderSizeDot(); }
  else if (a === "prev") goPage(R.page - 1);
  else if (a === "next") goPage(R.page + 1);
  else if (a === "zin") { R.zoom = clamp(R.zoom * 1.25, 0.6, 4); showPage(R.page, true); }
  else if (a === "zout") { R.zoom = clamp(R.zoom / 1.25, 0.6, 4); showPage(R.page, true); }
  else if (a === "more") readerMenu();
});

function closeTab(id) {
  S.tabs = S.tabs.filter((t) => t !== id); saveTabs();
  if (R && R.book.id === id) {
    const next = S.tabs[S.tabs.length - 1];
    if (next) { saveInk(true).then(() => openBook(next)); } else backToLibrary();
  } else buildReaderShell(), showPage(R.page);
}

function readerMenu() {
  modal(`<div class="modal sm"><header><h2>${esc(R.book.title).slice(0, 36)}</h2><button class="iconbtn" data-close aria-label="Close">${ic("x")}</button></header>
  <div class="menu">${R.book.kind === "blank" ? '<button data-do="addpage">Add a page after this one</button>' : ""}<button data-do="md">Export source file (Markdown)</button><button data-do="anki">Export flashcards for Anki</button><button data-do="settings">Settings and backup</button></div></div>`, (m, close) => {
    const on = (k, fn) => { const el = $(`[data-do="${k}"]`, m); if (el) el.onclick = () => { close(); fn(); }; };
    on("addpage", async () => { R.book.pages++; await dbPut("books", R.book); goPage(R.page + 1); });
    on("md", () => exportMarkdown(R.book.id));
    on("anki", exportAnki);
    on("settings", settingsModal);
  });
}

function setTool(t) {
  tool = t;
  clearSel();
  $$("[data-tool]").forEach((b) => b.classList.toggle("on", b.dataset.tool === t));
  renderDots(); renderSizeDot(); updateInkMode();
}

function renderDots() {
  const cols = tool === "hl" ? HL_COLORS : PEN_COLORS;
  const cur = tool === "hl" ? settings.hlColor : settings.penColor;
  $("#dots").innerHTML = tool === "eraser" || tool === "lasso" || tool === "hand" ? "" :
    `<div style="display:flex;flex-direction:column;align-items:center">${cols.map((c) => `<button class="dot ${c === cur ? "on" : ""}" data-color="${c}" style="background:${c}" aria-label="Colour ${c}"></button>`).join("")}</div>`;
}
function renderSizeDot() {
  const set = SIZES[tool === "hl" ? "hl" : tool === "eraser" ? "eraser" : "pen"];
  const r = [3, 5.5, 8][settings.size];
  const el = $("#sizedot"); if (el) el.setAttribute("r", r);
}

/* ---- page rendering ---- */
function goPage(n) {
  const max = R.book.pages;
  if (n > max && R.book.kind === "blank") { R.book.pages++; dbPut("books", R.book); }
  n = clamp(n, 1, R.book.pages);
  if (n === R.page && R.cssW) { $("#pgin").value = n; return; }
  saveInk(true).then(() => { R.page = n; R.book.lastPage = n; R.undo = []; R.redo = []; clearSel(); showPage(n); $("#stage").scrollTop = 0; });
}

async function showPage(n, keepScroll) {
  const tok = ++R.tok;
  R.page = n;
  const stage = $("#stage"), pw = $("#pw");
  const cssW = Math.max(280, (stage.clientWidth - 36) * R.zoom);
  let ratio = 1.4142, page = null;
  if (R.pdf) {
    page = await R.pdf.getPage(n);
    if (tok !== R.tok) return;
    const v = page.getViewport({ scale: 1 });
    ratio = v.height / v.width;
  }
  const cssH = cssW * ratio;
  R.cssW = cssW; R.cssH = cssH; R.k = cssW / BASE;
  pw.style.width = cssW + "px"; pw.style.height = cssH + "px";
  pw.classList.toggle("ruled", R.book.kind === "blank" && R.book.ruled);
  const dpr = R.dpr;
  for (const id of ["pdfc", "ink", "live"]) {
    const c = $("#" + id);
    c.width = Math.round(cssW * dpr); c.height = Math.round(cssH * dpr);
    c.style.width = cssW + "px"; c.style.height = cssH + "px";
  }
  $("#pgin").value = n; $("#pgtot").textContent = "/ " + R.book.pages;
  const rec = await dbGet("ink", R.book.id + ":" + n);
  if (tok !== R.tok) return;
  R.strokes = (rec && rec.strokes) || [];
  redrawInk();
  updateInkMode();
  renderSel();
  renderPanel();
  if (page) {
    const c = $("#pdfc");
    const vp = page.getViewport({ scale: (cssW * dpr) / page.getViewport({ scale: 1 }).width });
    try { R.renderTask && R.renderTask.cancel(); } catch {}
    R.renderTask = page.render({ canvas: c, canvasContext: c.getContext("2d"), viewport: vp });
    try { await R.renderTask.promise; } catch (e) { /* cancelled */ }
  }
}

/* ---- ink engine ---- */
function strokeW(s, pr) { return s.t === "pen" ? s.w * (0.55 + 0.9 * (pr ?? 0.5)) : s.w; }

function drawStrokes(ctx, strokes) {
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  for (const s of strokes) {
    const p = s.p;
    ctx.strokeStyle = s.c; ctx.fillStyle = s.c;
    ctx.globalAlpha = s.t === "hl" ? 0.42 : 1;
    if (p.length === 1) { ctx.beginPath(); ctx.arc(p[0][0], p[0][1], strokeW(s, p[0][2]) / 2, 0, 7); ctx.fill(); continue; }
    if (s.t === "hl") {
      ctx.lineWidth = s.w; ctx.lineCap = "butt";
      ctx.beginPath(); ctx.moveTo(p[0][0], p[0][1]);
      for (let i = 1; i < p.length - 1; i++) ctx.quadraticCurveTo(p[i][0], p[i][1], (p[i][0] + p[i + 1][0]) / 2, (p[i][1] + p[i + 1][1]) / 2);
      ctx.lineTo(p[p.length - 1][0], p[p.length - 1][1]); ctx.stroke(); ctx.lineCap = "round";
    } else {
      let px = p[0][0], py = p[0][1];
      for (let i = 1; i < p.length; i++) {
        const mx = i === p.length - 1 ? p[i][0] : (p[i][0] + p[i + 1][0]) / 2;
        const my = i === p.length - 1 ? p[i][1] : (p[i][1] + p[i + 1][1]) / 2;
        ctx.lineWidth = strokeW(s, p[i][2]);
        ctx.beginPath(); ctx.moveTo(px, py); ctx.quadraticCurveTo(p[i][0], p[i][1], mx, my); ctx.stroke();
        px = mx; py = my;
      }
    }
  }
  ctx.globalAlpha = 1;
}

function redrawInk() {
  const c = $("#ink"), ctx = c.getContext("2d");
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, c.width, c.height);
  const f = R.k * R.dpr;
  ctx.setTransform(f, 0, 0, f, 0, 0);
  drawStrokes(ctx, R.strokes);
}

function updateInkMode() {
  const live = $("#live");
  if (!live) return;
  const draws = tool !== "hand";
  live.style.touchAction = "none"; // Pencil strokes are never taken over by scrolling; finger panning is done in code
  live.style.cursor = tool === "hand" ? "grab" : "crosshair";
  live.style.webkitUserSelect = "none"; live.setAttribute("draggable", "false");
}

function pt(e) {
  const r = $("#live").getBoundingClientRect();
  return [(e.clientX - r.left) / R.k, (e.clientY - r.top) / R.k, e.pressure && e.pressure !== 0.5 ? e.pressure : e.pointerType === "pen" ? 0.5 : 0.55];
}

let drag = null;
function wireInk() {
  const live = $("#live");
  live.addEventListener("pointerdown", (e) => {
    if (e.button && e.button !== 0) return;
    e.preventDefault();
    live.setPointerCapture(e.pointerId);
    const stg = $("#stage");
    if (tool === "hand" || (e.pointerType === "touch" && settings.pencilOnly)) {
      drag = { type: "pan", id: e.pointerId, x: e.clientX, y: e.clientY, sl: stg.scrollLeft, st: stg.scrollTop };
      return;
    }
    const p = pt(e);
    if (tool === "pen" || tool === "hl") {
      const sz = SIZES[tool][settings.size];
      drag = { type: "draw", s: { t: tool, c: tool === "hl" ? settings.hlColor : settings.penColor, w: sz, p: [p] } };
      clearSel(); liveDraw();
    } else if (tool === "eraser") {
      pushUndo(); drag = { type: "erase", changed: false }; eraseAt(p); clearSel();
    } else if (tool === "lasso") {
      clearSel(); drag = { type: "lasso", path: [p] };
    }
  });
  live.addEventListener("pointermove", (e) => {
    if (!drag) return;
    e.preventDefault();
    if (drag.type === "pan") { if (e.pointerId !== drag.id) return; const stg = $("#stage"); stg.scrollLeft = drag.sl - (e.clientX - drag.x); stg.scrollTop = drag.st - (e.clientY - drag.y); return; }
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of evs.length ? evs : [e]) {
      const p = pt(ev);
      if (drag.type === "draw") { const last = drag.s.p[drag.s.p.length - 1]; if (Math.hypot(p[0] - last[0], p[1] - last[1]) > 0.8) drag.s.p.push(p); }
      else if (drag.type === "erase") eraseAt(p);
      else if (drag.type === "lasso") drag.path.push(p);
    }
    if (drag.type === "draw") liveDraw();
    if (drag.type === "lasso") liveLasso();
  });
  const end = (e) => {
    if (!drag) return;
    const d = drag; drag = null;
    const lc = $("#live"), lctx = lc.getContext("2d"); lctx.setTransform(1, 0, 0, 1, 0, 0); lctx.clearRect(0, 0, lc.width, lc.height);
    if (d.type === "pan") return;
    if (d.type === "draw") {
      pushUndo(); R.strokes.push(d.s); redrawInk(); scheduleSave();
    } else if (d.type === "erase") { if (d.changed) { redrawInk(); scheduleSave(); } else R.undo.pop(); }
    else if (d.type === "lasso") finishLasso(d.path);
  };
  live.addEventListener("pointerup", end);
  live.addEventListener("pointercancel", end);
}

function liveDraw() {
  const c = $("#live"), ctx = c.getContext("2d");
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, c.width, c.height);
  const f = R.k * R.dpr; ctx.setTransform(f, 0, 0, f, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  drawStrokes(ctx, [drag.s]);
  c.style.mixBlendMode = drag.s.t === "hl" ? "multiply" : "normal";
}

function liveLasso() {
  const c = $("#live"), ctx = c.getContext("2d");
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, c.width, c.height);
  const f = R.k * R.dpr; ctx.setTransform(f, 0, 0, f, 0, 0);
  c.style.mixBlendMode = "normal";
  ctx.strokeStyle = "#2F6FDB"; ctx.lineWidth = 2 / R.k; ctx.setLineDash([8 / R.k, 6 / R.k]);
  ctx.beginPath(); drag.path.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.stroke(); ctx.setLineDash([]);
}

function distSeg(px, py, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - a[0]) * dx + (py - a[1]) * dy) / l2 : 0;
  t = clamp(t, 0, 1);
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
}
function eraseAt(p) {
  const r = SIZES.eraser[settings.size];
  const before = R.strokes.length;
  R.strokes = R.strokes.filter((s) => {
    const hw = s.t === "hl" ? s.w / 2 : 1;
    if (s.p.length === 1) return Math.hypot(s.p[0][0] - p[0], s.p[0][1] - p[1]) > r;
    for (let i = 1; i < s.p.length; i++) if (distSeg(p[0], p[1], s.p[i - 1], s.p[i]) <= r + hw * 0.5) return false;
    return true;
  });
  if (R.strokes.length !== before) { drag.changed = true; redrawInk(); }
}

function pushUndo() { R.undo.push(JSON.stringify(R.strokes)); if (R.undo.length > 60) R.undo.shift(); R.redo = []; }
function undo() { if (!R.undo.length) return; R.redo.push(JSON.stringify(R.strokes)); R.strokes = JSON.parse(R.undo.pop()); redrawInk(); scheduleSave(); }
function redo() { if (!R.redo.length) return; R.undo.push(JSON.stringify(R.strokes)); R.strokes = JSON.parse(R.redo.pop()); redrawInk(); scheduleSave(); }

function scheduleSave() { clearTimeout(R.saveT); R.saveT = setTimeout(() => saveInk(), 500); }
async function saveInk(now) {
  if (!R) return;
  clearTimeout(R.saveT);
  const key = R.book.id + ":" + R.page;
  if (R.strokes.length) await dbPut("ink", { strokes: R.strokes }, key);
  else await dbDel("ink", key);
}

/* ---- lasso selection ---- */
function finishLasso(path) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  path.forEach((p) => { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); });
  const H = R.cssH / R.k;
  x0 = clamp(x0, 0, BASE); x1 = clamp(x1, 0, BASE); y0 = clamp(y0, 0, H); y1 = clamp(y1, 0, H);
  if (x1 - x0 < 24 || y1 - y0 < 24) { clearSel(); return; }
  R.sel = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  renderSel();
}
function clearSel() { if (R) { R.sel = null; renderSel(); } }
function renderSel() {
  const pw = $("#pw");
  if (!pw) return;
  $$(".selbox,.lassomenu", pw).forEach((n) => n.remove());
  if (!R.sel) return;
  const k = R.k, s = R.sel;
  const box = document.createElement("div");
  box.className = "selbox";
  box.style.cssText = `left:${s.x * k}px;top:${s.y * k}px;width:${s.w * k}px;height:${s.h * k}px`;
  pw.appendChild(box);
  const menu = document.createElement("div");
  menu.className = "lassomenu";
  const left = clamp(s.x * k + s.w * k + 10, 8, Math.max(8, R.cssW - 240));
  const overlap = s.x * k + s.w * k + 250 > R.cssW;
  menu.style.left = (overlap ? clamp(s.x * k + 8, 8, R.cssW - 240) : left) + "px";
  menu.style.top = (overlap ? clamp(s.y * k + s.h * k + 10, 8, R.cssH - 240) : clamp(s.y * k, 8, R.cssH - 260)) + "px";
  menu.innerHTML = `<button class="ai" data-sel="ai"><span>Send to AI</span><span class="chip" style="background:var(--teal);color:#fff">new</span></button>
    <button data-sel="copy">Copy picture</button><button data-sel="save">Save picture</button><button data-sel="quick">Save as extract (no AI)</button><button class="dng" data-sel="del">Delete ink inside</button><button data-sel="cancel">Cancel</button>`;
  menu.addEventListener("pointerdown", (e) => e.stopPropagation());
  pw.appendChild(menu);
}

function cropSelection(maxSide = 1800) {
  const s = R.sel, k = R.k;
  let f = Math.min(2, window.devicePixelRatio || 1) * 1.5;
  const long = Math.max(s.w, s.h) * k * f;
  if (long > maxSide) f *= maxSide / long;
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(s.w * k * f)); out.height = Math.max(1, Math.round(s.h * k * f));
  const ctx = out.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, out.width, out.height);
  const pc = $("#pdfc");
  if (R.pdf) {
    const r = pc.width / R.cssW;
    ctx.drawImage(pc, s.x * k * r, s.y * k * r, s.w * k * r, s.h * k * r, 0, 0, out.width, out.height);
  } else if (R.book.ruled) {
    ctx.strokeStyle = "#DCE6F2"; ctx.lineWidth = 1;
    for (let y = 32 - ((s.y * k) % 32); y < s.h * k; y += 32) { ctx.beginPath(); ctx.moveTo(0, y * f); ctx.lineTo(out.width, y * f); ctx.stroke(); }
  }
  ctx.globalCompositeOperation = "multiply";
  const g = k * f;
  ctx.setTransform(g, 0, 0, g, -s.x * g, -s.y * g);
  drawStrokes(ctx, R.strokes);
  return out;
}
const canvasBlob = (c, type = "image/png", q) => new Promise((res) => c.toBlob(res, type, q));

async function selAction(a) {
  if (!R.sel) return;
  if (a === "cancel") return clearSel();
  if (a === "del") {
    const s = R.sel; pushUndo();
    R.strokes = R.strokes.filter((st) => !st.p.some((p) => p[0] >= s.x && p[0] <= s.x + s.w && p[1] >= s.y && p[1] <= s.y + s.h));
    redrawInk(); scheduleSave(); return clearSel();
  }
  const c = cropSelection();
  if (a === "copy") {
    try { await navigator.clipboard.write([new ClipboardItem({ "image/png": await canvasBlob(c) })]); toast("Picture copied."); }
    catch { toast("Copy was blocked here. Use Save picture instead."); }
  } else if (a === "save") download("pepper-selection.png", await canvasBlob(c), "image/png");
  else if (a === "ai") sendToAI(c);
  else if (a === "quick") saveExtractModal(c);
}

/* =========================================================
   Send to AI
   ========================================================= */
const HOW = {
  table: 'Group the information into one or more tables. Put similar information together and do not stuff too much into a single table. Reply with markdown tables only. Put a short title line starting with "## " above each table.',
  flow: 'Make a flowchart of the process or mechanism shown. Reply with plain text only: a first line "## Title", then one line per path written as "Step A -> Step B -> Step C". Use extra lines for branches and keep each step to a few words.',
  cards: "Make Anki flashcards from this. Reply with one card per line and nothing else.\nQuestion cards:  Q:: question || answer\nCloze cards:  C:: sentence with {{c1::hidden part}}\nUse only one cloze number per card, and let items that are recalled together share the same cloze. Do not make too many cards.",
  image: "Write one prompt for an image generator that makes a clean teaching diagram of this, white background, labelled arrows. Reply with the prompt only.",
  scenario: "Write a short clinical scenario based on this, followed by 3 viva questions with brief model answers.",
  viva: "Write a short examiner-style audio viva script on this: the examiner asks, pauses, then gives the model answer. About two minutes spoken.",
};
const SEND_LABEL = { table: "Table", flow: "Flowchart", cards: "Flashcards", image: "Image prompt", scenario: "Scenario", viva: "Audio viva script" };
let lastKind = "table";

function buildPrompt(kind) {
  return `The attached picture is a crop from my study notes ("${R.book.title}", page ${R.page}). It may be handwriting, so read it carefully first.\n\n${HOW[kind]}`;
}

async function sendToAI(canvas) {
  const blob = await canvasBlob(canvas);
  const url = URL.createObjectURL(blob);
  const bookId = R.book.id, page = R.page, sel = { ...R.sel };
  let kind = lastKind;
  modal(`<div class="modal" style="height:min(760px,100%)"><header><h2>Send to AI</h2><button class="btn" data-close>Close</button></header>
  <div class="sbwrap" style="flex:1;min-height:0">
    <div class="sendbody"><div class="sel" style="flex:1"><img src="${url}" alt="Your selection"><div style="font-size:14px;line-height:1.5"><b>Your selection</b><br><span style="color:var(--muted)">Page ${page} of ${esc(R.book.title)}. The picture goes to the AI with the prompt, so it reads your handwriting itself.</span></div></div></div>
    <div class="sbcols" style="flex:1">
      <div class="l"><div class="lbl">Make a</div>${Object.keys(SEND_LABEL).map((k) => `<button class="opt ${k === kind ? "on" : ""}" data-k="${k}">${SEND_LABEL[k]}</button>`).join("")}</div>
      <div class="r">
        <div class="lbl">1. Copy the prompt and the picture</div>
        <textarea class="promptbox" id="pr"></textarea>
        <div class="row"><button class="btn primary" id="cp">Copy prompt</button><button class="btn" id="ci">Copy picture</button><button class="btn" id="sh">Share to an app</button><button class="btn" id="sv">Save picture</button></div>
        <div class="row"><a class="btn" style="display:flex;align-items:center;text-decoration:none;color:inherit" href="https://claude.ai/new" target="_blank" rel="noopener">Open Claude</a><a class="btn" style="display:flex;align-items:center;text-decoration:none;color:inherit" href="https://chatgpt.com/" target="_blank" rel="noopener">Open ChatGPT</a><a class="btn" style="display:flex;align-items:center;text-decoration:none;color:inherit" href="https://gemini.google.com/app" target="_blank" rel="noopener">Open Gemini</a></div>
        <div class="lbl" style="margin-top:6px">2. Paste the reply</div>
        <textarea class="pastebox" id="rp" placeholder="Paste the reply here. It is saved under this selection and shown beside the page."></textarea>
        <div class="row"><button class="btn" id="pc">Paste from clipboard</button><span style="flex:1"></span><button class="btn dark" id="sa" disabled>Save to page</button></div>
      </div></div></div></div>`, (m, close) => {
    const pr = $("#pr", m), rp = $("#rp", m);
    const setKind = (k) => { kind = k; lastKind = k; pr.value = buildPrompt(k); $$(".opt", m).forEach((o) => o.classList.toggle("on", o.dataset.k === k)); };
    setKind(kind);
    $$(".opt", m).forEach((o) => (o.onclick = () => setKind(o.dataset.k)));
    $("#cp", m).onclick = async () => { try { await navigator.clipboard.writeText(pr.value); toast("Prompt copied."); } catch { pr.select(); toast("Select and copy the prompt."); } };
    $("#ci", m).onclick = async () => { try { await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]); toast("Picture copied."); } catch { toast("Copy was blocked here. Use Save picture or Share."); } };
    $("#sv", m).onclick = () => download("pepper-selection.png", blob, "image/png");
    $("#sh", m).onclick = async () => {
      const file = new File([blob], "pepper-selection.png", { type: "image/png" });
      try {
        if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], text: pr.value });
        else toast("Sharing is not available here. Use Copy picture.");
      } catch {}
    };
    $("#pc", m).onclick = async () => { try { rp.value = await navigator.clipboard.readText(); rp.dispatchEvent(new Event("input")); } catch { toast("Paste is blocked here. Press and hold in the box, then Paste."); } };
    rp.oninput = () => ($("#sa", m).disabled = !rp.value.trim());
    $("#sa", m).onclick = async () => {
      const small = canvas.width > 700 ? shrink(canvas, 700) : canvas;
      const x = { id: uid(), bookId, page, kind, body: rp.value.trim(), crop: small.toDataURL("image/jpeg", 0.72), sel, created: Date.now() };
      await dbPut("extracts", x); S.extracts.push(x);
      close(); URL.revokeObjectURL(url);
      toast("Saved to page " + page);
      if (R && R.book.id === bookId) { R.panelOpen = true; $("#panel").classList.add("open"); const xb = $('[data-r="extracts"]'); xb.classList.add("on"); xb.querySelector("span").textContent = "Hide extracts"; R.filter = "all"; R.scope = "page"; renderPanel(); clearSel(); }
    };
  });
}

function shrink(c, w) {
  const o = document.createElement("canvas");
  o.width = w; o.height = Math.round((c.height * w) / c.width);
  o.getContext("2d").drawImage(c, 0, 0, o.width, o.height);
  return o;
}

function saveExtractModal(canvas) {
  const bookId = R.book.id, page = R.page, sel = { ...R.sel };
  modal(`<div class="modal sm"><header><h2>Save as extract</h2><button class="iconbtn" data-close aria-label="Close">${ic("x")}</button></header>
  <div style="padding:20px;display:flex;flex-direction:column;gap:12px"><div style="color:var(--muted);font-size:14px;line-height:1.5">Keep this selection beside the page, with your own text under it. Nothing is sent anywhere.</div>
  <select class="field" id="kd">${Object.keys(KINDS).map((k) => `<option value="${k}">${KINDS[k]}</option>`).join("")}</select>
  <textarea class="pastebox" id="bd" placeholder="Type or paste the text"></textarea><button class="btn primary" id="go">Save</button></div></div>`, (m, close) => {
    $("#go", m).onclick = async () => {
      const x = { id: uid(), bookId, page, kind: $("#kd", m).value, body: $("#bd", m).value.trim(), crop: (canvas.width > 700 ? shrink(canvas, 700) : canvas).toDataURL("image/jpeg", 0.72), sel, created: Date.now() };
      await dbPut("extracts", x); S.extracts.push(x); close(); toast("Saved"); renderPanel(); clearSel();
      if (!R.panelOpen) { R.panelOpen = true; $("#panel").classList.add("open"); }
    };
  });
}

/* ---- extracts panel ---- */
function renderPanel() {
  const pi = $("#panelin");
  if (!pi || !R) return;
  const all = R.scope === "page" ? extractsOf(R.book.id).filter((x) => x.page === R.page) : extractsOf(R.book.id);
  const cnt = (g) => (g === "all" ? all.length : all.filter((x) => GROUPS[g].includes(x.kind)).length);
  const shown = R.filter === "all" ? all : all.filter((x) => GROUPS[R.filter].includes(x.kind));
  shown.sort((a, b) => a.page - b.page || a.created - b.created);
  const chip = (g, l) => `<button class="fchip ${R.filter === g ? "on" : ""}" data-filter="${g}">${l} ${cnt(g)}</button>`;
  pi.innerHTML = `<header><div class="row"><h2 style="flex:1">${R.scope === "page" ? "Extracts for page " + R.page : "Extracts for this notebook"}</h2><button class="btn" data-scope="1">${R.scope === "page" ? "Whole notebook" : "This page"}</button></div>
    <div class="chips">${chip("all", "All")}${chip("table", "Tables")}${chip("flow", "Flowcharts")}${chip("cards", "Cards")}${chip("other", "Other")}</div></header>
    <div class="list">${shown.length ? shown.map((x) => extractBlock(x, { showPage: R.scope === "book" })).join("") : `<div class="empty" style="padding:40px 10px">Nothing here for ${R.scope === "page" ? "this page" : "this notebook"} yet.<br>Use the <b>lasso</b>, circle some notes, then tap <b>Send to AI</b>. The tables, flowcharts and cards you save come back here.</div>`}</div>`;
}

/* =========================================================
   Boot
   ========================================================= */
window.addEventListener("beforeunload", () => saveInk(true));
document.addEventListener("visibilitychange", () => { if (document.hidden) saveInk(true); });
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeModal();
  if (R && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) { e.preventDefault(); e.shiftKey ? redo() : undo(); }
});

(async function boot() {
  try { await loadAll(); } catch (e) { console.error(e); }
  renderLibrary();
  if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("sw.js").catch(() => {});
  window.__pepper = { S, get R() { return R; }, openBook };
})();
