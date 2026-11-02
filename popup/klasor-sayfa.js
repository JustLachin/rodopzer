// Klasör sekmesi: yan panel/araç çubuğu penceresinde açılamayan klasör seçme ve
// izin pencerelerini normal bir sekmede açar (vscode.dev'deki gibi). Seçilen klasör
// IndexedDB'ye yazılır; panel ve arka plan aynı kaydı kullanır.
const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// Panel klasör durumunu yeniden çizsin diye işaret
const paneleHaberVer = () => chrome.storage.local.set({ dx_klasorGuncel: Date.now() });

async function yolcuVerisi() {
  const o = await chrome.storage.local.get(["dx_yolcu", "dx_tarih"]);
  return o.dx_yolcu && o.dx_yolcu.sira ? o : null;
}

async function durumGoster() {
  const h = await KLASOR.al();
  const izin = h ? await KLASOR.izin(h) : "yok";
  $("btnSec").textContent = h ? "Başka klasör seç" : "Klasör seç";
  $("btnIzin").classList.toggle("d-none", !h || izin === "granted");
  const braveMi = await KLASOR.brave();
  $("braveYardim").classList.toggle("d-none", KLASOR.secilebilir() || !braveMi);
  if (!KLASOR.secilebilir()) {
    $("durum").innerHTML = braveMi
      ? '<span class="text-danger">Brave bu özelliği şu an kapalı tutuyor; aşağıdaki adımlarla bir kez açın.</span>'
      : '<span class="text-danger">Bu tarayıcı klasöre yazma iznini (File System Access API) desteklemiyor. Chrome veya Edge\'in güncel sürümünü kullanın.</span>';
    $("btnSec").disabled = true;
  } else if (!h) {
    $("durum").textContent = "Henüz klasör seçilmedi.";
  } else if (izin === "granted") {
    $("durum").innerHTML = `<span class="text-success">📁 <b>${esc(h.name)}</b> — okuma/yazma izni var.</span>`;
  } else {
    $("durum").innerHTML = `<span class="text-warning">📁 <b>${esc(h.name)}</b> — izin yenilenmeli.</span>`;
  }
  return { h, izin };
}

// İzinli klasöre yüklü yolcu listesinin tüm gruplarını yazar
async function dosyalariYaz(h) {
  const o = await yolcuVerisi();
  if (!o) { $("sonuc").textContent = "Yolcu listesi henüz yüklenmedi; yüklediğinizde dosyalar bu klasöre yazılacak."; return; }
  const tarih = YOLCU.tarihi(o.dx_yolcu) || o.dx_tarih || new Date().toISOString().slice(0, 10);
  const n = await YOLCU.klasoreYaz(KLASOR, h, o.dx_yolcu, tarih);
  await chrome.storage.local.set({ dx_yolcuAltKlasor: tarih });
  $("sonuc").innerHTML = `<span class="text-success">✓ ${n} grup dosyası yazıldı: <b>${esc(h.name)}/${esc(tarih)}</b></span>`;
}

async function tamamla() {
  await paneleHaberVer();
  $("btnKapat").classList.remove("d-none");
}

$("btnSec").addEventListener("click", async () => {
  $("sonuc").textContent = "";
  try {
    const h = await KLASOR.sec();
    await durumGoster();
    await dosyalariYaz(h);
    await tamamla();
  } catch (e) {
    if (e.name !== "AbortError") $("sonuc").innerHTML = `<span class="text-danger">${esc(e.message)}</span>`;
  }
});

$("btnIzin").addEventListener("click", async () => {
  $("sonuc").textContent = "";
  try {
    const h = await KLASOR.al();
    if (!h) return;
    if ((await KLASOR.izin(h, true)) !== "granted") {
      $("sonuc").innerHTML = '<span class="text-danger">İzin verilmedi.</span>';
      return;
    }
    await durumGoster();
    await dosyalariYaz(h);
    await tamamla();
  } catch (e) {
    $("sonuc").innerHTML = `<span class="text-danger">${esc(e.message)}</span>`;
  }
});

$("braveAdres").textContent = KLASOR.BRAVE_BAYRAK;
const adresiKopyala = async () => {
  try {
    await navigator.clipboard.writeText(KLASOR.BRAVE_BAYRAK);
    $("sonuc").innerHTML = '<span class="text-success">Adres kopyalandı; yeni sekmede adres çubuğuna yapıştırın.</span>';
  } catch (e) {
    $("sonuc").textContent = "Adresi elle yazın: " + KLASOR.BRAVE_BAYRAK;
  }
};
$("btnBraveKopyala").addEventListener("click", adresiKopyala);
$("btnBraveAc").addEventListener("click", async () => {
  try {
    await chrome.tabs.create({ url: KLASOR.BRAVE_BAYRAK });
  } catch (e) {
    // Bazı sürümler eklentinin ayar sayfası açmasına izin vermez: adresi kopyala
    await adresiKopyala();
  }
});

$("btnKapat").addEventListener("click", async () => {
  try {
    const t = await chrome.tabs.getCurrent();
    if (t) return chrome.tabs.remove(t.id);
  } catch (e) {}
  window.close();
});

// İzin zaten varsa (ör. "Her ziyarette izin ver" seçilmişse) ve dosya yazmak için
// açıldıysa tıklama beklemeden yaz.
(async () => {
  const { h, izin } = await durumGoster();
  if (h && izin === "granted" && new URLSearchParams(location.search).get("islem") === "yaz") {
    try { await dosyalariYaz(h); await tamamla(); } catch (e) {
      $("sonuc").innerHTML = `<span class="text-danger">${esc(e.message)}</span>`;
    }
  }
})();
