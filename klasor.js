// KLASOR — yolcu grup dosyaları için kalıcı klasör erişimi (File System Access API,
// vscode.dev'deki "klasör aç" izniyle aynı mekanizma). Kullanıcı klasörü bir kez
// seçer; klasör tutamacı IndexedDB'de saklanır, sonraki açılışlarda izin yalnızca
// doğrulanır (Chrome "Her ziyarette izin ver" seçeneğini sunarsa hiç sorulmaz).
// Popup/yan panel (pencere) ve service worker birlikte kullanır; klasör seçme ve
// izin isteme yalnız sayfada, bir tıklamanın içinde çalışır.
const KLASOR = (() => {
  const DB = "rodopzer", DEPO = "tutamac", ANAHTAR = "yolcuKlasoru";

  const destek = () => typeof indexedDB !== "undefined" && typeof FileSystemDirectoryHandle !== "undefined";

  function db() {
    return new Promise((coz, reddet) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(DEPO);
      r.onsuccess = () => coz(r.result);
      r.onerror = () => reddet(r.error);
    });
  }

  async function islem(mod, fn) {
    const d = await db();
    try {
      return await new Promise((coz, reddet) => {
        const t = d.transaction(DEPO, mod);
        const r = fn(t.objectStore(DEPO));
        t.oncomplete = () => coz(r && r.result);
        t.onerror = () => reddet(t.error);
      });
    } finally { d.close(); }
  }

  const al = async () => (destek() ? (await islem("readonly", (s) => s.get(ANAHTAR))) || null : null);
  const kaydet = (h) => islem("readwrite", (s) => s.put(h, ANAHTAR));
  const sil = () => islem("readwrite", (s) => s.delete(ANAHTAR));

  // "granted" | "prompt" | "denied" | "yok". iste=true yalnız tıklama içinde çağrılmalı.
  async function izin(h, iste = false) {
    if (!h) return "yok";
    let d = await h.queryPermission({ mode: "readwrite" });
    if (d !== "granted" && iste) d = await h.requestPermission({ mode: "readwrite" });
    return d;
  }

  // Klasör seçme penceresi yalnız normal sekmede vardır; yan panelde ve araç
  // çubuğu penceresinde yoktur. Oralardan klasor.html sekmesi açılır.
  const secilebilir = () => typeof showDirectoryPicker === "function";

  // Klasör seçtirir ve saklar (tıklama içinde, sekmede).
  async function sec() {
    if (!secilebilir()) throw new Error("Klasör seçme penceresi bu görünümde açılamıyor.");
    const h = await showDirectoryPicker({ id: "rodopzer-yolcu", mode: "readwrite", startIn: "downloads" });
    await kaydet(h);
    return h;
  }

  async function altKlasor(h, yol, olustur) {
    let d = h;
    for (const p of yol || []) d = await d.getDirectoryHandle(p, { create: olustur });
    return d;
  }

  async function yaz(h, yol, ad, bayt) {
    const d = await altKlasor(h, yol, true);
    const f = await d.getFileHandle(ad, { create: true });
    const w = await f.createWritable();
    await w.write(bayt);
    await w.close();
  }

  // adlar sırayla denenir; bulunamazsa null
  async function oku(h, yol, adlar) {
    let d;
    try { d = await altKlasor(h, yol, false); } catch (e) { return null; }
    for (const ad of adlar) {
      try {
        const f = await (await d.getFileHandle(ad)).getFile();
        return { ad, bayt: new Uint8Array(await f.arrayBuffer()), degisme: f.lastModified };
      } catch (e) { /* sıradaki ad */ }
    }
    return null;
  }

  // Brave, File System Access API'yi varsayılan olarak kapatır; brave://flags'ten açılır.
  const BRAVE_BAYRAK = "brave://flags/#file-system-access-api";
  async function brave() {
    try { return !!(navigator.brave && await navigator.brave.isBrave()); } catch (e) { return false; }
  }

  return { destek, secilebilir, brave, BRAVE_BAYRAK, al, kaydet, sil, izin, sec, yaz, oku };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = KLASOR;
}
