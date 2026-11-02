// POC-TEST: cevrimdisi motor (sunucusuz). popup ile ayni kurallar.
importScripts("kurallar.js", "vendors/xlsx.full.min.js", "yolcu.js", "klasor.js");
// Kısayol tuşları (Ctrl+Shift+1/2/3, chrome://extensions → kısayollar'dan
// değiştirilebilir) açık GTS sekmesine 1/2/3. aşamayı uygular.
// Sonuç, popup açılıncaya kadar araç çubuğu rozetinde (badge) görünür.

const NORM = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9ÇĞİÖŞÜ]/g, "");
const normalizeSrv = (raw) => {
  let s = (raw || "").trim();
  if (!s) return "";
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  try { return new URL(s).origin; } catch { return ""; }
};

const rozet = (metin, renk) => {
  chrome.action.setBadgeText({ text: metin });
  if (renk) chrome.action.setBadgeBackgroundColor({ color: renk });
};

const IMZALAR = { asama1: "seferHareketSaati", asama2: "tckn", asama3: "grupAdi" };

async function gtsBul(asama) {
  const anahtar = IMZALAR[asama] || "";
  const tum = await chrome.tabs.query({});
  const web = (tum || []).filter((t) => t.id
    && !/^(chrome|chrome-extension|edge|about|devtools):/i.test(t.url || ""));
  for (const t of web) {
    try {
      const r = await chrome.scripting.executeScript({ target: { tabId: t.id }, files: ["tabImza.js"] });
      const s = r && r[0] && r[0].result;
      if (s && s.imza && s.imza[anahtar]) return t;
    } catch (e) { /* erişilemeyen sekme (gizli mod vb.) */ }
  }
  return null;
}

async function asker(srv, token, body) {
  const h = { "Content-Type": "application/json" };
  if (token) h["X-Oturum-Token"] = token;
  const r = await fetch(srv + "/v1/tarif", { method: "POST", headers: h, body: JSON.stringify(body) });
  const t = await r.json().catch(() => null);
  if (!r.ok) throw new Error((t && (t.detail || t.error)) || ("HTTP " + r.status));
  return t;
}

function _fnv(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, "0");
}

async function parmakIzi() {
  try {
    const s = [
      navigator.userAgent,
      navigator.language,
      (navigator.languages || []).join(","),
      String(screen.width) + "x" + String(screen.height) + "x" + String(screen.colorDepth),
      String(navigator.hardwareConcurrency),
      String(navigator.platform),
      Intl.DateTimeFormat().resolvedOptions().timeZone
    ].join("|");
    let hash;
    if (crypto && crypto.subtle && crypto.subtle.digest) {
      const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
      hash = Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
    } else {
      hash = _fnv(s) + _fnv(s + "x") + _fnv(s + "y") + _fnv(s + "z");
    }
    return "FP" + hash.slice(0, 32).toUpperCase();
  } catch (e) {
    return "";
  }
}

async function cihazId() {
  try {
    const o = await chrome.storage.local.get(["dx_device"]);
    if (o.dx_device && String(o.dx_device).startsWith("FP")) return o.dx_device;
  } catch (e) {}
  const fp = await parmakIzi();
  if (fp) {
    try { await chrome.storage.local.set({ dx_device: fp }); } catch (e) {}
    return fp;
  }
  const o = await chrome.storage.local.get(["dx_device"]);
  if (o.dx_device) return o.dx_device;
  const id = (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(16) + Math.random().toString(16).slice(2));
  await chrome.storage.local.set({ dx_device: id });
  return id;
}

async function soforBul(plaka, liste) {
  const n = NORM(plaka);
  if (!n) return {};
  return (liste || []).find((s) => NORM(s.plaka) === n) || {};
}

// Popup ile aynı tarih biçimi: "2026-10-22" -> "22/10/2026"
const fmtTarih = (iso) => {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso || "");
};

async function basla(asama) {
  const o = await chrome.storage.local.get([
    "dx_device", "dx_islemeId", "dx_secili", "dx_kayitlar", "dx_yon",
    "dx_tarih", "dx_soforler", "dx_sabit", "dx_refs", "dx_anahtarlar",
    "dx_anahtarlar_a1", "dx_anahtarlar_a2", "dx_ilSecili"]);
  // POC-TEST: sunucu ve token sarti kaldirildi (sunucusuz mod).
  if (!o.dx_islemeId) {
    rozet("!L", "#b42318");
    return;
  }
  await cihazId();
  const tab = await gtsBul(asama);
  if (!tab) { rozet("!F", "#b42318"); return; }

  let sayfaPlaka = "";
  let sofor = {};
  if (asama === "asama2") {
    try {
      const r = await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["inject_plaka.js"] });
      sayfaPlaka = (r && r[0] && r[0].result) || "";
    } catch (e) {}
    sofor = await soforBul(sayfaPlaka, o.dx_soforler);
    try {
      const kayit0 = ((o.dx_kayitlar || [])[Number(o.dx_secili) || 0]) || {};
      if (!sayfaPlaka && kayit0.plaka) sayfaPlaka = kayit0.plaka;
    } catch (e) {}
  }

  try {
    // Tarif yerelde KURAL.tarifUret ile; popup'taki "Aşama" düğmeleriyle aynı girdiler.
    const kayit = (o.dx_kayitlar || [])[Number(o.dx_secili) || 0] || {};
    const eskiListe = o.dx_anahtarlar || [];
    const tarif = KURAL.tarifUret({
      kayit,
      indeks: Number(o.dx_secili) || 0,
      asama,
      tarih: fmtTarih(o.dx_tarih),
      yon: o.dx_yon || kayit.yon || "arrival",
      sayfaPlaka,
      sofor,
      sabit: o.dx_sabit || {},
      refs: o.dx_refs || {},
      ilSecili: o.dx_ilSecili || "",
      anahtarlar: eskiListe,
      anahtarlar1: o.dx_anahtarlar_a1 || eskiListe,
      anahtarlar2: o.dx_anahtarlar_a2 || eskiListe
    });
    await chrome.storage.local.set({ dx_recipe: tarif });
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: "MAIN",
        func: (rc) => { window.__dx_recipe = rc; },
        args: [tarif]
      });
    } catch (e) {}

    let sonuc;
    try {
      sonuc = await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["inject.js"], world: "MAIN" });
    } catch (e) {
      sonuc = await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["inject.js"] });
    }
    const r = sonuc && sonuc[0] && sonuc[0].result;
    if (r && typeof r.tamam === "number") {
      rozet(String(r.tamam), r.hata && r.hata.length ? "#b42318" : "#188038");
    } else if (r && r.tamam === false) {
      rozet("!X", "#b42318");
    } else {
      rozet("!?", "#b42318");
    }
  } catch (e) {
    rozet("!E", "#b42318");
  }
}

// ---- 4. aşama: yolcu Excel'i ----
// Popup düğmesi ve Alt+4 aynı akışı kullanır. Sayfa geçişleri (grup listesi ->
// Yolcu Listesi -> Excel'den Yükle) burada yapılır; popup kapansa da akış sürer.

const imzaAl = async (tabId) => {
  const r = await chrome.scripting.executeScript({ target: { tabId }, files: ["tabImza.js"] });
  return (r && r[0] && r[0].result) || null;
};

function sekmeYuklenince(tabId, ms = 20000) {
  return new Promise((coz, reddet) => {
    const zaman = setTimeout(() => { chrome.tabs.onUpdated.removeListener(dinle); reddet(new Error("Sayfa zamanında yüklenmedi.")); }, ms);
    function dinle(id, bilgi) {
      if (id !== tabId || bilgi.status !== "complete") return;
      clearTimeout(zaman);
      chrome.tabs.onUpdated.removeListener(dinle);
      coz();
    }
    chrome.tabs.onUpdated.addListener(dinle);
  });
}

async function git(tabId, url) {
  const bekle = sekmeYuklenince(tabId);
  await chrome.tabs.update(tabId, { url });
  await bekle;
  return imzaAl(tabId);
}

// Grup listesinde grup adı hücresi tam olarak grup koduna eşit olan satır
function grupSatiri(satirlar, grup) {
  const g = String(grup).toUpperCase();
  return (satirlar || []).filter((s) => (s.hucreler || []).some((h) => h.toUpperCase() === g));
}

// 4. aşamaya uygun sekme: aktif sekme önce, sonra diğerleri;
// Excel formu > Yolcu Listesi sayfası > grubu içeren grup listesi.
async function asama4SekmeBul(grup) {
  const tum = await chrome.tabs.query({});
  const web = (tum || []).filter((t) => t.id && !/^(chrome|chrome-extension|edge|about|devtools):/i.test(t.url || ""));
  web.sort((a, b) => (b.active ? 1 : 0) - (a.active ? 1 : 0));
  const adaylar = [];
  let listeVar = false;
  for (const t of web) {
    try {
      const s = await imzaAl(t.id);
      const a4 = s && s.asama4;
      if (!a4) continue;
      if (a4.grupSatirlari.length) listeVar = true;
      const puan = a4.excelYukle ? 3 : a4.excelLink ? 2 : grupSatiri(a4.grupSatirlari, grup).length ? 1 : 0;
      if (puan) adaylar.push({ tab: t, s, puan });
    } catch (e) { /* erişilemeyen sekme */ }
  }
  adaylar.sort((a, b) => b.puan - a.puan);
  return adaylar[0] || { listeVar };
}

async function asama4(grupIstek, gelenDosya) {
  const o = await chrome.storage.local.get(["dx_yolcu", "dx_otoKaydet", "dx_kayitlar", "dx_secili", "dx_yolcuAltKlasor"]);
  const veri = o.dx_yolcu;
  if (!veri || !veri.gruplar) return { tamam: false, mesaj: "Önce yolcu Excel'ini yükleyin (Ana → Yolcu Excel)." };
  const kayit = (o.dx_kayitlar || [])[Number(o.dx_secili) || 0] || {};
  const grup = String(grupIstek || kayit.gno || "").trim().toUpperCase();
  if (!grup) return { tamam: false, mesaj: "Seçili uçuş yok." };
  if (!veri.gruplar[grup]) return { tamam: false, mesaj: `Yolcu listesinde ${grup} grubu yok.` };
  // Dosya sayfalar arasında gezinmeden önce hazırlanır: klasördeki dosya hatalıysa hiç gidilmez
  const dosya = await grupDosyasi(veri, grup, gelenDosya, o.dx_yolcuAltKlasor);

  const bulunan = await asama4SekmeBul(grup);
  if (!bulunan.tab) {
    return {
      tamam: false,
      mesaj: bulunan.listeVar
        ? `GTS grup listesinde adı "${grup}" olan grup yok (3. aşamada grup adı ${grup} olarak kaydedildi mi?).`
        : "GTS'de grup listesi, Yolcu Listesi ya da Excel'den Yükle sayfası açık değil."
    };
  }
  const tabId = bulunan.tab.id;
  let s = bulunan.s;

  // Grup listesindeysek: grubun satırındaki "Yolcu Listesi"ne git
  if (!s.asama4.excelYukle && !s.asama4.excelLink) {
    const satir = grupSatiri(s.asama4.grupSatirlari, grup);
    if (satir.length !== 1) {
      return { tamam: false, mesaj: satir.length ? `Listede ${grup} adlı ${satir.length} grup var; doğru grubun Yolcu Listesi'ni elle açın.` : `Listede ${grup} grubu bulunamadı.` };
    }
    s = await git(tabId, satir[0].href);
  }
  // Yolcu Listesi sayfasındaysak: "Excel'den Yükle"ye git
  if (s && !s.asama4.excelYukle && s.asama4.excelLink) s = await git(tabId, s.asama4.excelLink);
  if (!s || !s.asama4.excelYukle) return { tamam: false, mesaj: "Excel'den Yükle formu açılamadı." };

  const otoKaydet = o.dx_otoKaydet !== false;
  const r = await chrome.scripting.executeScript({
    target: { tabId },
    func: YOLCU.dosyaEkle,
    args: [dosya.b64, dosya.ad, otoKaydet, grup, veri.sira || []]
  });
  const sonuc = (r && r[0] && r[0].result) || { tamam: false, mesaj: "Sayfa yanıt vermedi." };
  return { ...sonuc, grup, yolcu: dosya.yolcu, kaynak: dosya.kaynak };
}

// Yüklenecek grup dosyası: panelin klasörden okuduğu > klasörden (izin kalıcıysa,
// Alt+4 için) > eklentideki listeden üretilen. Klasördeki dosya Excel'de
// düzeltilmiş olabilir; yalnız o grubun yolcularını içeriyorsa kabul edilir.
async function grupDosyasi(veri, grup, gelen, altKlasor) {
  if (gelen && gelen.b64 && gelen.ad) return { ...gelen, kaynak: "klasörden" };
  let h = null;
  try {
    h = await KLASOR.al();
    if (h && (await KLASOR.izin(h)) !== "granted") h = null;
  } catch (e) { h = null; } // service worker'da klasör erişimi yoksa listeden üret
  if (h) {
    const d = await YOLCU.klasordenGrup(KLASOR, h, altKlasor ? [altKlasor] : [], grup);
    if (d) return { ...d, kaynak: "klasörden" };
  }
  return {
    ad: YOLCU.dosyaAdi(grup),
    b64: YOLCU.base64(YOLCU.grupExcel(veri, grup)),
    yolcu: veri.gruplar[grup].length,
    kaynak: "yolcu listesinden"
  };
}

chrome.runtime.onMessage.addListener((mesaj, gonderen, yanit) => {
  if (!mesaj || mesaj.tur !== "asama4") return false;
  // Popup akış sırasında kapanırsa sonuç rozette kalır
  asama4(mesaj.grup, mesaj.dosya)
    .then((r) => { rozet(r.tamam ? String(r.yolcu) : "!X", r.tamam ? "#188038" : "#b42318"); yanit(r); })
    .catch((e) => { rozet("!E", "#b42318"); yanit({ tamam: false, mesaj: e.message }); });
  return true; // yanıt eşzamansız
});

chrome.commands.onCommand.addListener(async (komut) => {
  if (["asama1", "asama2", "asama3"].includes(komut)) basla(komut);
  if (komut === "asama4") {
    try {
      const r = await asama4();
      rozet(r.tamam ? String(r.yolcu) : "!X", r.tamam ? "#188038" : "#b42318");
    } catch (e) { rozet("!E", "#b42318"); }
  }
  if (komut === "asama5") {
    const o = await chrome.storage.local.get(["dx_secili"]);
    const r = await a5Hazirla(o.dx_secili, null).catch((e) => ({ tamam: false, mesaj: e.message }));
    if (!r.tamam) rozet("!X", "#b42318");
  }
});

// Yan panel (tarayicinin sagina gomulu mod): panel pencere geneline baglidir,
// sekme degistirilince kapanmaz. Arac cubugu simgesi eskisi gibi popup acar;
// panel, Ayarlar -> "Sağ panele göm" ile (veya panel simgesinden) acilir.
function yanPaneliHazirla() {
  if (!chrome.sidePanel) return;
  try {
    chrome.sidePanel.setOptions({ path: "popup/pencere.html", enabled: true });
  } catch (e) { /* eski Chrome */ }
  try {
    const p = chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
    if (p && p.catch) p.catch(() => {});
  } catch (e) { /* eski Chrome */ }
}

chrome.runtime.onInstalled.addListener(yanPaneliHazirla);
chrome.runtime.onStartup.addListener(yanPaneliHazirla);

// 5. aşama (tam otomatik akış) yukarıdaki yardımcıları kullanır.
importScripts("asama5.js");