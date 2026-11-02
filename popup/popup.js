const S = {};
const $ = (id) => document.getElementById(id);

const durum = (id, cls, metin) => {
  const el = $(id);
  if (!el) return; // POC-TEST: kaldirilan alanlara yazim guvenli gecilir.
  el.innerHTML = cls ? `<span class="${cls}">${esc(metin)}</span>` : esc(metin);
};
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmtTarih = (d) => {
  const p = new Date(d);
  if (isNaN(p)) return "";
  const y = String(p.getDate()); const m = String(p.getMonth() + 1); const g = String(p.getFullYear());
  return `${y.padStart(2, "0")}/${m.padStart(2, "0")}/${g}`;
};
const normPlaka = (s) => (String(s || "").toUpperCase().replace(/[^A-Z0-9ÇĞİÖŞÜ]/g, ""));
const yarinIso = () => {
  const y = new Date(); y.setDate(y.getDate() + 1);
  return y.toISOString().slice(0, 10);
};

const IMZALAR = { asama1: "seferHareketSaati", asama2: "tckn", asama3: "grupAdi" };
const sekmeKisa = (t) => {
  const b = String(t.title || t.url || "(başlıksız)").replace(/\s+/g, " ").trim();
  return b.length > 44 ? b.slice(0, 44) + "…" : b;
};

// Her web sekmesine minik "imza probu" atar; hızlı prob:
async function probSekme(t) {
  try {
    const r = await chrome.scripting.executeScript({ target: { tabId: t.id }, files: ["tabImza.js"] });
    return { tab: t, sonuc: (r && r[0] && r[0].result) || null };
  } catch (e) {
    return { tab: t, sonuc: null, hata: e.message };
  }
}

async function sekmeSondaj() {
  const tum = await chrome.tabs.query({});
  const web = (tum || []).filter((t) => t.id
    && !/^(chrome|chrome-extension|edge|about|devtools):/i.test(t.url || ""));
  return Promise.all(web.map(probSekme));
}

async function gtsBul(asama) {
  const anahtar = IMZALAR[asama] || "";
  // 1) Önce aktif sekmede dene (çoğu zaman form aktif sekmededir, ~10ms döner)
  try {
    const [aktif] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (aktif && aktif.id && !/^(chrome|chrome-extension|edge|about|devtools):/i.test(aktif.url || "")) {
      const p = await probSekme(aktif);
      if (p.sonuc && p.sonuc.imza && p.sonuc.imza[anahtar]) {
        return { tab: aktif, liste: [p] };
      }
    }
  } catch (e) {}
  // 2) Aktif sekmede değilse tüm web sekmelerini paralel tara
  const liste = await sekmeSondaj();
  const bul = liste.find((x) => x.sonuc && x.sonuc.imza && x.sonuc.imza[anahtar]);
  return { tab: bul ? bul.tab : null, liste };
}

function sondajOzeti(liste) {
  return liste.map((x) => {
    if (!x.sonuc) return "• " + sekmeKisa(x.tab) + " → " + (x.hata || "yanıt yok");
    const im = x.sonuc.imza || {};
    const es = Object.keys(im).filter((k) => im[k]);
    return "• " + sekmeKisa(x.tab) + " → " + (es.length ? "form: " + es.join(", ") : "form yok")
      + (x.sonuc.iframe ? " | iframe VAR" : "") + (x.tab.incognito ? " | gizli" : "");
  }).join("\n");
}

async function sayfaTara() {
  durum("dolDurum", "", "Sekmeler taranıyor...");
  try {
    const liste = await sekmeSondaj();
    const ilkForm = liste.find((x) => x.sonuc && x.sonuc.imza && Object.keys(x.sonuc.imza).some((k) => x.sonuc.imza[k]));
    let ilkDetay = null;
    if (ilkForm) {
      try {
        const r = await chrome.scripting.executeScript({ target: { tabId: ilkForm.tab.id }, files: ["inject_probe.js"] });
        ilkDetay = (r && r[0] && r[0].result) || null;
      } catch (eF) { ilkDetay = { hata: eF.message }; }
    }
    const out = {
      zaman: new Date().toISOString(),
      sekmeler: liste.map((x) => ({
        sekme: sekmeKisa(x.tab),
        url: x.tab.url || null,
        gizli: !!x.tab.incognito,
        sondaj: x.sonuc,
        hata: x.hata || null
      })),
      ilkFormDetayi: ilkDetay
    };
    $("taramaSonuc").classList.remove("d-none");
    $("taramaSonuc").value = JSON.stringify(out, null, 1);
    durum("dolDurum", "", "Tarama bitti — dökümü kopyalayıp paylaşabilirsiniz.");
  } catch (e) {
    durum("dolDurum", "text-danger", "Taranamadı: " + e.message);
  }
}

async function yukle() {
  const o = await chrome.storage.local.get([
    "dx_server", "dx_kod", "dx_token", "dx_bitis", "dx_device",
    "dx_islemeId", "dx_yon", "dx_kayitlar", "dx_secili",
    "dx_soforler", "dx_sabit", "dx_tarih", "dx_refs", "dx_genelAnahtar",
    "dx_anahtarlar", "dx_anahtarlar_a1", "dx_anahtarlar_a2", "dx_ilSecili",
    "dx_yolcu", "dx_yolcuKlasor", "dx_otoKaydet", "dx_yolcuAltKlasor"
  ]);
  Object.assign(S, o);
  // Eski sürümün kayıtlara gömdüğü elle bölge/ilçe değerlerini bir kez temizle.
  if (Array.isArray(S.dx_kayitlar) && eskiManuelTemizle(S.dx_kayitlar)) {
    try { await chrome.storage.local.set({ dx_kayitlar: S.dx_kayitlar }); } catch (e) {}
  }
  if ($("selIl")) $("selIl").value = S.dx_ilSecili || "";
  if ($("yolcuKlasor")) $("yolcuKlasor").value = S.dx_yolcuKlasor || VARSAYILAN_YOLCU_KLASOR;
  if ($("otoKaydet")) $("otoKaydet").checked = S.dx_otoKaydet !== false;
  yolcuDurumRender();
  klasorDurumRender();
  S.dx_anahtarlar = S.dx_anahtarlar || [];
  S.dx_anahtarlar_a1 = S.dx_anahtarlar_a1 || (S.dx_anahtarlar.length ? [...S.dx_anahtarlar] : []);
  S.dx_anahtarlar_a2 = S.dx_anahtarlar_a2 || (S.dx_anahtarlar.length ? [...S.dx_anahtarlar] : []);
  if (S.dx_genelAnahtar && $("selAnahtar")) $("selAnahtar").value = S.dx_genelAnahtar;
  // POC-TEST: lisans kaldirildi — eklenti lisans sormadan direkt calisir.
  if (!S.dx_token) { S.dx_token = "YEREL"; try { await chrome.storage.local.set({ dx_token: "YEREL" }); } catch (e) {} }
  if (!S.dx_kod) { S.dx_kod = "YEREL"; try { await chrome.storage.local.set({ dx_kod: "YEREL" }); } catch (e) {} }
  $("sVer").textContent = "v" + chrome.runtime.getManifest().version;
  $("srv").value = S.dx_server || "";

  $("tarih").value = S.dx_tarih || yarinIso();
  S.dx_tarih = $("tarih").value;
  await chrome.storage.local.set({ dx_tarih: S.dx_tarih });

  if ($("sabitTel")) $("sabitTel").value = (S.dx_sabit && S.dx_sabit.aracTelNo) || "";
  if ($("sabitUcret")) $("sabitUcret").value = (S.dx_sabit && S.dx_sabit.grupUcret) || "";
  if ($("sabitAnahtar")) $("sabitAnahtar").value = (S.dx_sabit && S.dx_sabit.sabitAnahtar) || "";
  if ($("sabitIlce")) $("sabitIlce").value = (S.dx_sabit && S.dx_sabit.sabitIlce) || "";
  ayrAnahtarRender();
  // POC-TEST: lisans alani kaldirildi (kod inputu yok).
  lisansBilgi();
  if (S.dx_token) {
    if (S.dx_islemeId && Array.isArray(S.dx_kayitlar)) {
      durum("pdfDurum", "", `Kayıtlar yüklü (${S.dx_kayitlar.length} kayıt).`);
      listeRender(); detayRender(); xmlRender();
    }
    guncelleKontrol();
  }
  soforRender();
  soforSelectGuncelle();
  seciliSoforSec();
  navRender();
}

const normalizeSrv = (raw) => {
  let s = (raw || "").trim();
  if (!s) return "";
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  try { return new URL(s).origin; } catch { return ""; }
};

const srvKaydet = async () => {
  const srv = normalizeSrv($("srv").value);
  if (!srv) return durum("lisDurum", "text-danger", "Sunucu adresi geçersiz. Ör: https://sunucu.alanadiniz.com");
  const eskiKod = S.dx_kod;
  // POC-TEST: lisans kaldirildi — sunucu degisince token silinmez.
  await chrome.storage.local.set({ dx_server: srv });
  S.dx_server = srv;
  $("srv").value = srv;
  durum("lisDurum", "text-success", "Sunucu kaydedildi.");
  lisansBilgi();
};

async function api(path, { method = "GET", json, form } = {}) {
  const srv = normalizeSrv(S.dx_server || "");
  if (!srv) throw new Error("Sunucu adresi kayıtlı değil (Ayarlar → Sunucu).");
  const h = {};
  if (S.dx_token) h["X-Oturum-Token"] = S.dx_token;
  let g = null;
  if (form) { g = form; } else if (json !== undefined) { h["Content-Type"] = "application/json"; g = JSON.stringify(json); }
  const r = await fetch(srv + path, { method, headers: h, body: g });
  let t;
  try { t = await r.json(); } catch { t = null; }
  if (!r.ok || (t && t.error)) {
    const m = (t && (t.detail || t.error)) || ("HTTP " + r.status);
    const msg = typeof m === "string" ? m : JSON.stringify(m);
    throw new Error(msg);
  }
  return t;
}

// Makine/cihaz parmak izi: ayni bilgisayarda eklenti silinip tekrar yuklense de
// (storage.local kaldirmada silinir) ayni kimlik uretilsin ki lisans limiti
// tekrar dolmasin. Tarayici + makineye ozgu stabil ozelliklerden hash uretir.
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
  // Onceden parmak-izi tabanli bir kimlik kaydedildiyse onu kullan
  try {
    const o = await chrome.storage.local.get(["dx_device"]);
    if (o.dx_device && String(o.dx_device).startsWith("FP")) {
      S.dx_device = o.dx_device;
      return o.dx_device;
    }
  } catch (e) {}
  const fp = await parmakIzi();
  if (fp) {
    S.dx_device = fp;
    try { await chrome.storage.local.set({ dx_device: fp }); } catch (e) {}
    return fp;
  }
  // Parmak izi uretilemezse eski davranis (rastgele, guncellemede stabil)
  if (S.dx_device) return S.dx_device;
  const o = await chrome.storage.local.get(["dx_device"]);
  if (o.dx_device) { S.dx_device = o.dx_device; return o.dx_device; }
  S.dx_device = (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(16) + Math.random().toString(16).slice(2));
  await chrome.storage.local.set({ dx_device: S.dx_device });
  return S.dx_device;
}

// POC-TEST: lisans kaldirildi — rozet her zaman aktif.
function lisansBilgi() {
  const b = $("lisOnay");
  if (b) { b.className = "badge bg-success"; b.textContent = "Lisans aktif"; }
}

async function lisans() {
  const kod = $("kod").value.trim();
  if (!kod) return durum("lisDurum", "text-danger", "Lisans kodu girin.");
  durum("lisDurum", "", "Doğrulanıyor...");
  try {
    let r = await api("/v1/lisans/dogrula", { method: "POST", json: { p_code: kod, p_device: await cihazId() } });
    // "Başka bilgisayarda kullanılıyor" -> inaktif cihazlar sunucuda düşmüş olabilir;
    // kısa bir beklemeyle tekrar istek at (tarayıcı/cihaz geçişlerinde anahtarı kurtar).
    if (r && r.durum === "cihaz") {
      await new Promise((res) => setTimeout(res, 1000));
      r = await api("/v1/lisans/dogrula", { method: "POST", json: { p_code: kod, p_device: await cihazId() } });
    }
    if (r.durum === "ok") {
      await chrome.storage.local.set({ dx_kod: kod, dx_token: r.token, dx_bitis: r.bitis });
      S.dx_kod = kod; S.dx_token = r.token; S.dx_bitis = r.bitis;
      durum("lisDurum", "text-success", "Lisans geçerli. Bitiş: " + r.bitis);
      lisansBilgi();
      guncelleKontrol();
    } else {
      durum("lisDurum", "text-danger", r.mesaj || r.durum);
    }
  } catch (e) { durum("lisDurum", "text-danger", "Sunucuya ulaşılamadı: " + e.message); }
}

// Seçili kaydın 1. ve 3. aşama tariflerini forma gidecek değerlerle birebir
// hesaplar. Kayda hiçbir şey yazmaz: bölge/ilçe her seferinde PDF verisinden
// ve Ayarlar'daki kurallardan yeniden türetilir.
function onizleme(k, i) {
  const ortak = {
    kayit: k, indeks: i, tarih: fmtTarih($("tarih").value),
    yon: S.dx_yon || k.yon || "arrival",
    sabit: S.dx_sabit || {}, refs: S.dx_refs || {},
    ilSecili: ($("selIl") && $("selIl").value) || "",
    anahtarlar1: S.dx_anahtarlar_a1 || [], anahtarlar2: S.dx_anahtarlar_a2 || []
  };
  return {
    t1: KURAL.tarifUret({ ...ortak, asama: "asama1" }),
    t3: KURAL.tarifUret({ ...ortak, asama: "asama3" })
  };
}

// Eski sürümlerin kayıtlara kalıcı yazdığı elle bölge/ilçe alanları.
// Bunlar "Tümüne" ile tüm uçuşlara yayılıp yanlış ilçe girilmesine yol açıyordu.
const ESKI_MANUEL_ALANLAR = ["manuelAnahtar", "manuelIlce", "manuelAnahtar1", "manuelIlce1", "manuelAnahtar2", "manuelIlce2"];
function eskiManuelTemizle(kayitlar) {
  let degisti = false;
  for (const k of kayitlar || []) {
    for (const a of ESKI_MANUEL_ALANLAR) {
      if (a in k) { delete k[a]; degisti = true; }
    }
  }
  return degisti;
}

function xmlUret(yon) {
  S.beklenen_yon = yon;
  const dosyaEl = $("pdf");
  dosyaEl.value = "";
  dosyaEl.click();
}

async function pdfYukle() {
  const dosya = $("pdf").files[0];
  if (!dosya) return;
  const yon = S.beklenen_yon || "arrival";
  // POC-TEST: lokal lisans kapisi bilerek acildi (sadece bu kopyada).
  // if (!S.dx_token) return durum("pdfDurum", "text-danger", "Önce lisansı doğrulayın (Ayarlar).");
  durum("pdfDurum", "", "Yerelde okunuyor (sunucusuz)...");
  try {
    const buf = await dosya.arrayBuffer();
    const r = await KURAL.pdfOku(buf, yon);
    if (!r.kayitlar.length) {
      $("taramaSonuc").classList.remove("d-none");
      $("taramaSonuc").value = "PDF okundu (" + r.hamSatirSayisi + " satir) ama kayit cikarilamadi.\n"
        + "KURAL-v1 kalibrasyonu icin ilk satirlar:\n" + r.ornek.join("\n");
      return durum("pdfDurum", "text-danger", "Kayit bulunamadi — ham metin asagida, kurali birlikte kalibre edelim.");
    }
    // Bölge/ilçe kayda yazılmaz; önizleme ve doldurma anında hesaplanır.
    r.kayitlar.forEach((k) => { k.yon = yon; });
    const islemeId = "YEREL-" + Date.now().toString(36).toUpperCase();
    S.dx_islemeId = islemeId; S.dx_yon = yon; S.dx_kayitlar = r.kayitlar; S.dx_secili = 0;
    await chrome.storage.local.set({ dx_islemeId: islemeId, dx_yon: yon, dx_kayitlar: r.kayitlar, dx_secili: 0 });
    const tanınmayan = r.kayitlar.filter((k, i) => !onizleme(k, i).t3.bilgi.otel.kesin).length;
    durum("pdfDurum", tanınmayan ? "text-danger" : "text-success", "Yerelde okundu: " + r.kayitlar.length + " kayıt (" + yon + ")"
      + (tanınmayan ? ` — ${tanınmayan} kaydın bölgesi tanınmadı, listede işaretli.` : ""));
    listeRender(); detayRender(); xmlRender(); yolcuDurumRender();
  } catch (e) { durum("pdfDurum", "text-danger", "Hata: " + e.message); }
}

// Seçili uçuş gezinme çubuğu (Geri / sayaç / İleri)
function navRender() {
  const g = $("btnGeri");
  const il = $("btnIleri");
  const s = $("secSayac");
  if (!g || !il || !s) return;
  const n = (S.dx_kayitlar || []).length;
  if (!n) {
    s.textContent = "Kayıt yok";
    g.disabled = true;
    il.disabled = true;
    return;
  }
  const i = Math.min(Math.max(Number(S.dx_secili) || 0, 0), n - 1);
  const k = S.dx_kayitlar[i] || {};
  s.textContent = `${i + 1} / ${n}` + (k.gno ? " · " + k.gno : "");
  g.disabled = i <= 0;
  il.disabled = i >= n - 1;
}

// Listeye tıklamadan önceki/sonraki uçuşa geç
async function seciliGit(adim) {
  const n = (S.dx_kayitlar || []).length;
  if (!n) return;
  const eski = Math.min(Math.max(Number(S.dx_secili) || 0, 0), n - 1);
  const i = Math.min(Math.max(eski + adim, 0), n - 1);
  if (i === eski) return;
  S.dx_secili = i;
  await chrome.storage.local.set({ dx_secili: i });
  listeRender(); detayRender(); xmlRender();
  durum("dolDurum", "", "Seçildi: " + ((S.dx_kayitlar[i] || {}).gno || i + 1));
}

function detayRender() {
  navRender();
  const k = S.dx_kayitlar && S.dx_kayitlar[S.dx_secili];
  if (!k) {
    $("detay").innerHTML = '<span class="minik">Seçili uçuş yok — PDF yükleyip listeden seçin.</span>';
    return;
  }
  const { t1, t3 } = onizleme(k, S.dx_secili);
  const b1 = t1.bilgi.bolge, b3 = t3.bilgi;
  const saatStr = `Saat <b>${esc(k.uisaat || k.teslimSaat || "")}</b>`;
  const aracStr = (k.aracKodu || k.plaka) ? ` · Araç: <b>${esc(k.aracKodu || "")} ${esc(k.plaka ? "(" + k.plaka + ")" : "")}</b>` : "";
  const yer = (x) => esc([x.il, x.ilce].filter(Boolean).join(" / ") || "-");
  const uyari = (c) => c.kesin ? "" : ` <span class="badge bg-danger">kontrol et</span>`;
  const kaynak = (c) => `<span class="minik">(${esc(c.kaynak)})</span>`;
  $("detay").innerHTML =
    `<b>${esc(k.gno)}</b> · ${esc(k.pist || "")} · ${saatStr}${aracStr}<br>` +
    `${esc(k.otel || "")}<br>` +
    `<div class="mt-1 pt-1 border-top">` +
    `<span class="text-success">1. aşama açıklaması: <b>${esc(t1.bilgi.aciklama)}</b></span> ${kaynak(b1)}${uyari(b1)}<br>` +
    `<span class="text-info">3. aşama: <b>${yer(b3.baslangic)}</b> → <b>${yer(b3.bitis)}</b></span> ${kaynak(b3.otel)}${uyari(b3.otel)}` +
    (b3.otel.kesin ? "" : `<div class="minik text-danger">Otel bölgesi tanınmadı; `
      + (b3.otel.ilceAday.length
        ? `Ayarlar'daki varsayılan ilçe (${esc(b3.otel.ilceAday[0])}) kullanılacak, doğruluğunu kontrol edin.`
        : "ilçe forma doldurulmaz.")
      + ` Kalıcı çözüm: Ayarlar → 2. Aşama listesine bölgeyi ekleyin.</div>`) +
    yolcuSatiri(k) +
    `</div>`;
}

// Detay panelinde 4. aşama satırı: grubun dosyası ve PDF ile uyumu
function yolcuSatiri(k) {
  if (!S.dx_yolcu) return `<br><span class="text-primary">4. aşama:</span> <span class="minik">yolcu Excel'i yüklenmedi</span>`;
  const g = String(k.gno || "").toUpperCase();
  if (!S.dx_yolcu.gruplar[g]) {
    return `<br><span class="text-primary">4. aşama:</span> <span class="badge bg-danger">yolcu listesinde ${esc(k.gno)} yok</span>`;
  }
  const o = YOLCU.grupOzeti(S.dx_yolcu, g);
  const paxUyumsuz = k.pax && Number(k.pax) !== o.yolcu;
  return `<br><span class="text-primary">4. aşama: <b>${esc(YOLCU.dosyaAdi(g))}</b> · ${o.yolcu} yolcu`
    + (o.plakalar.length ? ` · ${esc(o.plakalar.join(", "))}` : "") + `</span>`
    + (paxUyumsuz ? ` <span class="badge bg-danger">PDF'te ${esc(k.pax)} kişi</span>` : "");
}

function xmlRender() {
  const v = $("xmlView");
  if (!S.dx_kayitlar || !S.dx_kayitlar.length) {
    v.value = "Henüz PDF üretilmedi. Arrival / Departure ile PDF seçin.";
    return;
  }
  const satirlar = [`[${(S.dx_yon || "").toUpperCase()}] ${S.dx_kayitlar.length} kayıt`];
  S.dx_kayitlar.forEach((k) => {
    const detay = [k.gno, k.pist, k.uisaat, (k.otel ? k.otel + " (" + (k.otelbolge || "") + ")" : "")];
    satirlar.push(detay.filter(Boolean).join(" | "));
  });
  v.value = satirlar.join("\n");
}

function jsonDosyasiIndir(veri, dosyaAdi) {
  try {
    const jsonStr = typeof veri === "string" ? veri : JSON.stringify(veri, null, 2);
    const blob = new Blob([jsonStr], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = dosyaAdi;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      a.remove();
      URL.revokeObjectURL(url);
    }, 1000);
  } catch (err) {
    console.error("İndirme hatası:", err);
  }
}

async function kayitlarJsonAktar1() {
  if (!S.dx_kayitlar || !S.dx_kayitlar.length) {
    durum("dolDurum", "text-danger", "Dışa aktarılacak kayıt yok. Önce PDF yükleyin.");
    return;
  }
  const tarih = $("tarih").value || new Date().toISOString().slice(0, 10);
  const cikti = {
    tarih: tarih,
    asama: "1. Aşama (Sefer Bilgileri)",
    yon: S.dx_yon || "arrival",
    toplamKayit: S.dx_kayitlar.length,
    kayitlar: S.dx_kayitlar.map((k, idx) => {
      const { t1 } = onizleme(k, idx);
      return {
        gno: k.gno,
        pist: k.pist,
        uisaat: k.uisaat,
        otel: k.otel,
        bolge: t1.bilgi.bolge.bolge,
        bolgeKaynagi: t1.bilgi.bolge.kaynak,
        seferAciklamasi: t1.bilgi.aciklama,
        alanlar: t1.alanlar
      };
    })
  };
  const dosyaAdi = `transferler_1asama_${S.dx_yon || "liste"}_${tarih}.json`;
  jsonDosyasiIndir(cikti, dosyaAdi);
  durum("dolDurum", "text-success", `1. Aşama JSON indirildi: ${dosyaAdi}`);
}

async function kayitlarJsonAktar2() {
  if (!S.dx_kayitlar || !S.dx_kayitlar.length) {
    durum("dolDurum", "text-danger", "Dışa aktarılacak kayıt yok. Önce PDF yükleyin.");
    return;
  }
  const tarih = $("tarih").value || new Date().toISOString().slice(0, 10);
  const cikti = {
    tarih: tarih,
    asama: "2. Aşama (Grup Bilgileri / İlçe)",
    yon: S.dx_yon || "arrival",
    toplamKayit: S.dx_kayitlar.length,
    kayitlar: S.dx_kayitlar.map((k, idx) => {
      const { t3 } = onizleme(k, idx);
      const o = t3.bilgi.otel;
      return {
        gno: k.gno,
        pist: k.pist,
        uisaat: k.uisaat,
        otel: k.otel,
        bolge: o.bolge,
        il: o.ilAdi,
        ilce: o.ilceAday[0] || "",
        bolgeKaynagi: o.kaynak,
        bolgeTanindi: o.kesin,
        grupAciklamasi: t3.bilgi.aciklama,
        alanlar: t3.alanlar
      };
    })
  };
  const dosyaAdi = `transferler_2asama_${S.dx_yon || "liste"}_${tarih}.json`;
  jsonDosyasiIndir(cikti, dosyaAdi);
  durum("dolDurum", "text-success", `2. Aşama JSON indirildi: ${dosyaAdi}`);
}

async function kayitlarJsonAktar() {
  if (!S.dx_kayitlar || !S.dx_kayitlar.length) {
    durum("dolDurum", "text-danger", "Dışa aktarılacak kayıt yok. Önce PDF yükleyin.");
    return;
  }
  const tarih = $("tarih").value || new Date().toISOString().slice(0, 10);
  const cikti = {
    tarih: tarih,
    yon: S.dx_yon || "arrival",
    toplamKayit: S.dx_kayitlar.length,
    kayitlar: S.dx_kayitlar.map((k, idx) => {
      const { t1, t3 } = onizleme(k, idx);
      return {
        ...k,
        asama1: t1.alanlar,
        asama3: t3.alanlar
      };
    })
  };
  const dosyaAdi = `transferler_${S.dx_yon || "liste"}_${tarih}.json`;
  jsonDosyasiIndir(cikti, dosyaAdi);
  durum("dolDurum", "text-success", `JSON dışa aktarıldı: ${dosyaAdi}`);
}

function soforlerJsonAktar() {
  const liste = S.dx_soforler || [];
  if (!liste.length) {
    durum("soforDurum", "text-danger", "Dışa aktarılacak şoför yok.");
    return;
  }
  const cikti = {
    soforler: liste,
    refs: S.dx_refs || KURAL.VARSAYILAN_REFS
  };
  jsonDosyasiIndir(cikti, "sofor_listesi.json");
  durum("soforDurum", "text-success", "Şoför listesi JSON olarak indirildi.");
}

function listeRender() {
  const kutu = $("liste");
  kutu.innerHTML = "";
  let seciliEl = null;
  (S.dx_kayitlar || []).forEach((k, i) => {
    const d = document.createElement("div");
    d.className = "kayit" + (S.dx_secili === i ? " sec" : "");
    const aracHtml = k.aracKodu ? ` <span class="badge bg-secondary me-1" style="font-size:0.7em;">${esc(k.aracKodu)}</span>` : "";
    const o = onizleme(k, i).t3.bilgi.otel;
    const ilceHtml = o.kesin
      ? `<span class="badge bg-light text-dark border" style="font-size:0.7em;" title="${esc(o.kaynak)}">${esc(o.ilceAday[0] || "")}</span>`
      : `<span class="badge bg-danger" style="font-size:0.7em;" title="${esc(o.kaynak)}">bölge?</span>`;
    d.innerHTML = `<b>${esc(k.gno)}</b>${aracHtml}<span>${esc(k.otel)} · ${esc(k.uisaat)}</span>${ilceHtml}`;
    d.onclick = async () => {
      S.dx_secili = i;
      await chrome.storage.local.set({ dx_secili: i });
      listeRender(); detayRender(); xmlRender();
      durum("dolDurum", "", "Seçildi: " + k.gno);
    };
    if (S.dx_secili === i) seciliEl = d;
    kutu.appendChild(d);
  });
  if (!S.dx_kayitlar || !S.dx_kayitlar.length) kutu.innerHTML = '<div class="minik">Henüz kayıt yok.</div>';
  seciliSoforSec();
  // Geri/İleri ile gezinirken seçili satır görünür kalsın
  if (seciliEl && seciliEl.scrollIntoView) seciliEl.scrollIntoView({ block: "nearest" });
}

async function plakaOku(tab) {
  if (!tab || !tab.id) return "";
  try {
    const r = await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["inject_plaka.js"] });
    return (r && r[0] && r[0].result) || "";
  } catch { return ""; }
}

async function soforBul(plaka, aracKodu) {
  const liste = S.dx_soforler || [];
  if (!liste.length) return {};
  const np = normPlaka(plaka);
  if (np) {
    const bul = liste.find((s) => normPlaka(s.plaka) === np);
    if (bul) return bul;
  }
  // Plaka tutmadıysa araç koduna göre ara (örn: "M2" -> "M2 SPRINTER")
  const nk = String(aracKodu || "").trim().toUpperCase();
  if (nk) {
    const bulKod = liste.find((s) => {
      const sk = String(s.kodu || "").trim().toUpperCase();
      return sk.startsWith(nk) || sk.includes(nk);
    });
    if (bulKod) return bulKod;
  }
  return {};
}

function soforSelectGuncelle() {
  const sel = $("selSofor");
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">Otomatik (Plakaya Göre)</option>';
  (S.dx_soforler || []).forEach((s) => {
    const opt = document.createElement("option");
    opt.value = normPlaka(s.plaka);
    const kod = s.kodu ? `[${s.kodu}] ` : "";
    opt.textContent = `${kod}${s.sofor} (${s.plaka})`;
    sel.appendChild(opt);
  });
  if (cur) sel.value = cur;
}

function seciliSoforSec() {
  const sel = $("selSofor");
  if (!sel) return;
  const k = S.dx_kayitlar && S.dx_kayitlar[S.dx_secili];
  if (!k) return;
  const np = normPlaka(k.plaka);
  const nk = String(k.aracKodu || "").trim().toUpperCase();
  const es = (S.dx_soforler || []).find((s) => {
    if (np && normPlaka(s.plaka) === np) return true;
    if (nk && String(s.kodu || "").toUpperCase().startsWith(nk)) return true;
    return false;
  });
  if (es) {
    sel.value = normPlaka(es.plaka);
  } else {
    sel.value = "";
  }
}

async function doldur(asama) {
  durum("dolDurum", "", "");
  $("imzaNotu").innerHTML = "";
  if (asama === "asama4") return asama4Calistir();
  if (!S.dx_islemeId || !S.dx_kayitlar) return durum("dolDurum", "text-danger", "Önce PDF yükleyin.");
  if (S.dx_secili === undefined) S.dx_secili = 0;
  const tarih = fmtTarih($("tarih").value);

  // Hedef formu ara (aktif sekme öncelikli, anında)
  let hedefAsama = asama;
  let { tab, liste } = await gtsBul(asama);

  // Eğer 2. aşama (#tckn) istendiyse ama sekmede Grup Bilgileri (#grupAdi) açıksa otomatik Grup formunu doldur:
  if (asama === "asama2" && (!tab || !tab.id)) {
    const grupTab = await gtsBul("asama3");
    if (grupTab.tab && grupTab.tab.id) {
      tab = grupTab.tab;
      liste = grupTab.liste;
      hedefAsama = "asama3";
    }
  }

  if (!tab || !tab.id) {
    const ozet = sondajOzeti(liste);
    if (ozet) {
      $("taramaSonuc").classList.remove("d-none");
      $("taramaSonuc").value = ozet;
    }
    return durum("dolDurum", "text-danger",
      (asama === "asama1" ? "1. aşama formu" : asama === "asama2" ? "2. aşama formu" : "3. aşama formu")
      + " hiçbir sekmede bulunamadı (#" + IMZALAR[asama] + " açık değil). Aşama sayfasını açık bir sekmede bırakın. Detay aşağıda.");
  }

  const kayit0 = ((S.dx_kayitlar || [])[S.dx_secili]) || {};

  let sayfaPlaka = "";
  if (hedefAsama === "asama2") {
    sayfaPlaka = await plakaOku(tab);
  }

  // Şoför seçimi: önce arayüz dropdown'ı, yoksa sayfa/kayıt plakası veya araç kodundan otomatik
  const plakaAday = sayfaPlaka || kayit0.plaka || "";
  const soforSecili = ($("selSofor") && $("selSofor").value) || "";
  let sofor = {};
  if (soforSecili) {
    sofor = (S.dx_soforler || []).find((s) => normPlaka(s.plaka) === normPlaka(soforSecili)) || {};
  }
  if (!sofor.sofor) {
    sofor = await soforBul(plakaAday, kayit0.aracKodu);
  }

  durum("dolDurum", "", asama + " hesaplanıyor...");
  // Sabit telefon ve ücret: her zaman eklentideki girişten alınsın (boşsa gönderilmesin).
  const tel = ($("sabitTel").value || "").trim();
  const ucret = ($("sabitUcret").value || "").trim();
  S.dx_sabit = { ...(S.dx_sabit || {}), aracTelNo: tel, grupUcret: ucret };
  try { await chrome.storage.local.set({ dx_sabit: S.dx_sabit }); } catch (e) {}

  const ilSecili = ($("selIl") && $("selIl").value) || "";
  try {
    const tarif = KURAL.tarifUret({
      kayit: kayit0,
      indeks: S.dx_secili,
      asama: hedefAsama,
      tarih,
      yon: S.dx_yon || kayit0.yon || "arrival",
      sayfaPlaka: plakaAday,
      sofor,
      sabit: S.dx_sabit || {},
      refs: S.dx_refs || {},
      ilSecili,
      anahtarlar: S.dx_anahtarlar || [],
      anahtarlar1: S.dx_anahtarlar_a1 || [],
      anahtarlar2: S.dx_anahtarlar_a2 || []
    });
    durum("dolDurum", "", "Forma uygulanıyor...");
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
    $("imzaNotu").innerHTML = "Hedef form: " + (tarif.imza || "-");
    if (!r) return durum("dolDurum", "text-danger", "Eklenti sonuç döndürmedi.");
    if (r.tamam === false) {
      if ((r.mesaj || "").indexOf("imza yok") >= 0) {
        $("taramaSonuc").classList.remove("d-none");
        $("taramaSonuc").value = sondajOzeti(liste) || "Sekme listesi boş.";
      }
      return durum("dolDurum", "text-danger", r.mesaj || "Forma uygulanamadı.");
    }
    const soforNot = sofor.sofor ? ` (${sofor.sofor})` : "";
    if (r.hata && r.hata.length) {
      durum("dolDurum", "text-danger", r.tamam + " alan dolduruldu" + soforNot + "; hatalar: " + r.hata.join(", "));
    } else {
      durum("dolDurum", "text-success", r.tamam + " alan dolduruldu" + soforNot + ". Onaylayıp kaydedebilirsiniz.");
    }
  } catch (e) { durum("dolDurum", "text-danger", "Hata: " + e.message); }
}

// ---- 4. aşama: yolcu Excel'i ----

const VARSAYILAN_YOLCU_KLASOR = "Rodopzer/Yolcu";

const yolcuTarihi = () => YOLCU.tarihi(S.dx_yolcu) || S.dx_tarih || new Date().toISOString().slice(0, 10);

// Klasör seçilmediğinde kullanılan İndirilenler altındaki göreli yol:
// "..", sürücü harfi ve geçersiz karakterler ayıklanır.
function indirmeKlasoru() {
  const ham = (S.dx_yolcuKlasor || VARSAYILAN_YOLCU_KLASOR).split(/[\\/]+/)
    .map((p) => p.replace(/[:*?"<>|]/g, "").trim())
    .filter((p) => p && p !== "." && p !== "..");
  return (ham.length ? ham : [VARSAYILAN_YOLCU_KLASOR]).concat(yolcuTarihi()).join("/");
}

// Seçili klasör ve izin durumu. iste=true yalnız bir tıklamanın içinde kullanılır
// (Chrome izin penceresini ancak kullanıcı etkileşimiyle gösterir).
async function klasorHazir(iste = false) {
  if (!KLASOR.destek()) return { h: null, izin: "yok" };
  let h = null;
  try { h = await KLASOR.al(); } catch (e) { return { h: null, izin: "yok" }; }
  if (!h) return { h: null, izin: "yok" };
  try { return { h, izin: await KLASOR.izin(h, iste) }; } catch (e) { return { h, izin: "denied" }; }
}

async function klasorDurumRender() {
  const el = $("klasorDurum");
  if (!el) return;
  const { h, izin } = await klasorHazir(false);
  $("btnKlasorSec").textContent = h ? "Değiştir" : "Klasör seç";
  $("btnKlasorIzin").classList.toggle("d-none", !h || izin === "granted");
  $("btnKlasorBirak").classList.toggle("d-none", !h);
  if (!KLASOR.destek()) {
    el.innerHTML = (await KLASOR.brave())
      ? '<span class="text-warning">Brave\'de klasör erişimi kapalı.</span> "Klasör seç" nasıl açılacağını adım adım gösterir.'
      : '<span class="text-danger">Bu tarayıcı klasöre yazmayı desteklemiyor.</span>';
    el.innerHTML += " Bu arada 4. aşama dosyayı doğrudan yükler; grup dosyaları istenirse tek ZIP olarak indirilir.";
  } else if (!h) {
    el.innerHTML = "Klasör seçilmedi — 4. aşama dosyayı doğrudan yükler; grup dosyaları istenirse tek ZIP olarak indirilir.";
  } else if (izin === "granted") {
    el.innerHTML = `<span class="text-success">📁 <b>${esc(h.name)}</b> — okuma/yazma izni var.</span>`;
  } else {
    el.innerHTML = `<span class="text-warning">📁 <b>${esc(h.name)}</b> — izin yenilenmeli ("İzin ver"e basın).</span>`;
  }
}

// Grupları seçili klasöre yazar (indirme yok). Klasör yoksa hiçbir şey indirmez:
// 4. aşama dosyayı bellekten yükler; arşiv istenirse zipIndir() tek dosya indirir.
async function grupDosyalariniKaydet(iste = false) {
  const veri = S.dx_yolcu;
  if (!veri || !veri.sira) throw new Error("Yolcu listesi yüklü değil.");
  const tarih = yolcuTarihi();
  const { h, izin } = await klasorHazir(iste);
  if (h && izin === "granted") {
    await YOLCU.klasoreYaz(KLASOR, h, veri, tarih);
    S.dx_yolcuAltKlasor = tarih;
    await chrome.storage.local.set({ dx_yolcuAltKlasor: tarih });
    return { n: veri.sira.length, yer: `📁 ${h.name}/${tarih}` };
  }
  if (h) return { n: 0, izinGerekli: true, yer: `📁 ${h.name}` };
  return { n: 0, klasorYok: true };
}

// Tüm grup dosyaları tek ZIP: İndirilenler/<klasör>/yolcu_<tarih>.zip
async function zipIndir() {
  const veri = S.dx_yolcu;
  if (!veri || !veri.sira) throw new Error("Yolcu listesi yüklü değil.");
  const tarih = yolcuTarihi();
  const yol = indirmeKlasoru().split("/").slice(0, -1).concat(`yolcu_${tarih}.zip`).join("/");
  await chrome.downloads.download({
    url: "data:application/zip;base64," + YOLCU.base64(YOLCU.zipUret(veri, tarih)),
    filename: yol, conflictAction: "overwrite", saveAs: false
  });
  return { n: veri.sira.length, yer: "İndirilenler/" + yol };
}

// Klasör seçme/izin pencereleri yan panelde ve araç çubuğu penceresinde açılamaz;
// bu işler eklentinin kendi sekmesinde (popup/klasor.html) yapılır.
function klasorSekmesi(islem) {
  chrome.tabs.create({ url: chrome.runtime.getURL("popup/klasor.html?islem=" + islem) });
}

// Kaydı çalıştırır ve sonucu Ana sekmede gösterir; izin gerekiyorsa tek tıkla yazdıran düğme koyar.
async function kaydetVeGoster(iste) {
  const kutu = $("yolcuDurum");
  const eskiSatir = $("yolcuKayitSatiri");
  if (eskiSatir) eskiSatir.remove();
  const satir = document.createElement("div");
  satir.id = "yolcuKayitSatiri";
  kutu.appendChild(satir);
  const sekmeDugmesi = (metin, etiket) => {
    satir.innerHTML = metin + ` <button class="btn btn-sm btn-outline-primary py-0 px-2" style="font-size:11px">${etiket}</button>`;
    satir.querySelector("button").onclick = () => klasorSekmesi("yaz");
  };
  try {
    const k = await grupDosyalariniKaydet(iste);
    if (k.izinGerekli && !iste) {
      // Önce burada izin istemeyi dene (tıklama içinde)
      satir.innerHTML = `<span class="text-warning">${esc(k.yer)} için izin gerekli.</span> `
        + `<button class="btn btn-sm btn-outline-primary py-0 px-2" style="font-size:11px">Klasöre yaz</button>`;
      satir.querySelector("button").onclick = () => kaydetVeGoster(true);
    } else if (k.izinGerekli) {
      // Bu görünüm izin penceresi açamıyor: klasör sekmesinde izin verilip yazılır
      sekmeDugmesi(`<span class="text-warning">${esc(k.yer)} izni bu panelden verilemiyor.</span>`, "Klasör sekmesinde yaz");
      klasorSekmesi("yaz");
    } else if (k.klasorYok) {
      // İndirme yapılmaz; 4. aşama dosyayı bellekten yükler
      satir.innerHTML = `<span class="text-success">${S.dx_yolcu.sira.length} grup dosyası hazır (4. aşama doğrudan yükler).</span> `
        + `<button class="btn btn-sm btn-outline-secondary py-0 px-2" style="font-size:11px">Tek ZIP indir</button>`;
      satir.querySelector("button").onclick = async () => {
        try {
          const z = await zipIndir();
          satir.innerHTML = `<span class="text-success">ZIP indirildi: ${esc(z.yer)}</span>`;
        } catch (e) { satir.innerHTML = `<span class="text-danger">ZIP indirilemedi: ${esc(e.message)}</span>`; }
      };
    } else {
      satir.innerHTML = `<span class="text-success">${k.n} grup dosyası → ${esc(k.yer)}</span>`;
      durum("yolcuAyarDurum", "text-success", `${k.n} grup dosyası kaydedildi: ${k.yer}`);
    }
  } catch (e) {
    sekmeDugmesi(`<span class="text-danger">Panelden yazılamadı: ${esc(e.message)}</span>`, "Klasör sekmesinde yaz");
  }
  klasorDurumRender();
}

// Yolcu listesi ile PDF kayıtlarını grup koduna göre karşılaştırır.
function yolcuKarsilastir() {
  const veri = S.dx_yolcu;
  const kayitlar = S.dx_kayitlar || [];
  if (!veri || !veri.sira) return [];
  const np = (s) => String(s || "").replace(/\s+/g, "").toUpperCase();
  const sorunlar = [];
  for (const k of kayitlar) {
    const g = String(k.gno || "").toUpperCase();
    if (!veri.gruplar[g]) { sorunlar.push(`${k.gno}: yolcu yok`); continue; }
    const o = YOLCU.grupOzeti(veri, g);
    if (k.pax && Number(k.pax) !== o.yolcu) sorunlar.push(`${k.gno}: PDF ${k.pax} kişi, Excel ${o.yolcu}`);
    if (k.plaka && o.plakalar.length && !o.plakalar.some((p) => np(p) === np(k.plaka))) {
      sorunlar.push(`${k.gno}: plaka PDF ${k.plaka}, Excel ${o.plakalar.join("/")}`);
    }
  }
  return sorunlar;
}

function yolcuDurumRender() {
  const veri = S.dx_yolcu;
  if (!veri || !veri.sira) { durum("yolcuDurum", "", ""); return; }
  const pdfGruplari = new Set((S.dx_kayitlar || []).map((k) => String(k.gno || "").toUpperCase()));
  const pdfteYok = veri.sira.filter((g) => pdfGruplari.size && !pdfGruplari.has(g)).length;
  const sorunlar = yolcuKarsilastir();
  const ozet = `Yolcu listesi: ${veri.toplam} yolcu, ${veri.sira.length} grup (${veri.dosyaAdi || "Excel"})`
    + (pdfteYok ? ` · ${pdfteYok} grup bu PDF'te yok (diğer yön olabilir)` : "");
  const el = $("yolcuDurum");
  el.innerHTML = esc(ozet) + (sorunlar.length
    ? `<br><span class="text-danger">Uyumsuz: ${esc(sorunlar.slice(0, 6).join(" · "))}${sorunlar.length > 6 ? " …" : ""}</span>`
    : (pdfGruplari.size ? ` · <span class="text-success">PDF ile uyumlu</span>` : ""));
}

async function yolcuYukle() {
  const dosya = $("yolcuDosya").files[0];
  if (!dosya) return;
  durum("yolcuDurum", "", "Excel okunuyor...");
  try {
    const veri = YOLCU.oku(new Uint8Array(await dosya.arrayBuffer()), dosya.name);
    S.dx_yolcu = veri;
    await chrome.storage.local.set({ dx_yolcu: veri });
    yolcuDurumRender();
    detayRender();
    await kaydetVeGoster(false);
  } catch (e) {
    durum("yolcuDurum", "text-danger", "Excel okunamadı: " + e.message);
  } finally {
    $("yolcuDosya").value = "";
  }
}

async function yolcuTemizle() {
  if (!confirm("Yüklü yolcu listesi eklentiden silinsin mi? (Kaydedilmiş grup dosyaları silinmez.)")) return;
  delete S.dx_yolcu;
  await chrome.storage.local.remove("dx_yolcu");
  yolcuDurumRender();
  detayRender();
  durum("yolcuAyarDurum", "", "Yolcu listesi silindi.");
}

// Seçme penceresi yalnız normal sekmede açılır (yan panelde ve araç çubuğu
// penceresinde yoktur); seçim her zaman klasör sekmesinde yapılır.
const klasorSec = () => klasorSekmesi("sec");

// Akış arka planda çalışır: grup listesi -> Yolcu Listesi -> Excel'den Yükle -> dosya -> Kaydet.
// Klasör izinliyse grup dosyası klasörden okunur (Excel'de yapılan düzeltmeler yüklenir).
async function asama4Calistir() {
  const k = (S.dx_kayitlar || [])[S.dx_secili];
  if (!S.dx_yolcu) return durum("dolDurum", "text-danger", "Önce yolcu Excel'ini yükleyin (Yolcu Excel).");
  if (!k) return durum("dolDurum", "text-danger", "Önce PDF yükleyip uçuş seçin.");
  const g = String(k.gno || "").toUpperCase();
  let dosya = null, izinYok = false;
  try {
    const { h, izin } = await klasorHazir(true); // tıklama içinde: gerekirse izin sorulur
    if (h && izin === "granted") {
      dosya = await YOLCU.klasordenGrup(KLASOR, h, [S.dx_yolcuAltKlasor || yolcuTarihi()], g);
    }
    izinYok = !!h && izin !== "granted";
  } catch (e) {
    return durum("dolDurum", "text-danger", e.message);
  }
  durum("dolDurum", "", `${k.gno} yolcu dosyası GTS'ye ekleniyor${dosya ? " (klasörden)" : ""}...`);
  try {
    const r = await chrome.runtime.sendMessage({ tur: "asama4", grup: k.gno, dosya });
    if (!r || !r.tamam) return durum("dolDurum", "text-danger", (r && r.mesaj) || "4. aşama tamamlanamadı.");
    durum("dolDurum", "text-success", `${r.dosya} eklendi (${r.yolcu} yolcu, ${r.kaynak})`
      + (r.kaydet ? ", Kaydet'e basıldı." : ". Kontrol edip Kaydet'e basın.")
      + (izinYok ? " Klasör izni yenilenmeli: Ayarlar → İzin ver." : ""));
  } catch (e) { durum("dolDurum", "text-danger", "Hata: " + e.message); }
}

// ---- 5. aşama: tam otomatik akış (arka planda çalışır, panel kapansa da sürer) ----

async function asama5Baslat() {
  durum("dolDurum", "", "");
  const kayitlar = S.dx_kayitlar || [];
  if (!kayitlar.length) return durum("dolDurum", "text-danger", "Önce PDF yükleyin.");
  if (!S.dx_yolcu) return durum("dolDurum", "text-danger", "Önce yolcu Excel'ini yükleyin (Yolcu Excel).");
  const bas = Math.min(Math.max(Number(S.dx_secili) || 0, 0), kayitlar.length - 1);
  const islenecek = kayitlar.slice(bas);
  const soru = `5. Aşama: ${islenecek.length} uçuş (${islenecek[0].gno} → ${islenecek[islenecek.length - 1].gno}), `
    + `sefer tarihi ${fmtTarih($("tarih").value)}.\n\n`
    + "Her uçuş için GTS'ye sefer, personel, grup ve yolcu Excel'i otomatik girilecek. "
    + "GTS'de zaten olan kayıtlar atlanır.\n\nBaşlasın mı?";
  if (!confirm(soru)) return;

  S.dx_sabit = { ...(S.dx_sabit || {}), aracTelNo: ($("sabitTel").value || "").trim(), grupUcret: ($("sabitUcret").value || "").trim() };
  await chrome.storage.local.set({ dx_sabit: S.dx_sabit, dx_tarih: $("tarih").value });

  // Klasörde Excel'de düzeltilmiş grup dosyaları varsa onlar yüklenir (izin bu tıklamada sorulur)
  const dosyalar = {};
  try {
    const { h, izin } = await klasorHazir(true);
    if (h && izin === "granted") {
      durum("dolDurum", "", "Grup dosyaları klasörden okunuyor...");
      for (const k of islenecek) {
        const g = String(k.gno || "").toUpperCase();
        if (!S.dx_yolcu.gruplar[g] || dosyalar[g]) continue;
        const d = await YOLCU.klasordenGrup(KLASOR, h, [S.dx_yolcuAltKlasor || yolcuTarihi()], g);
        if (d) dosyalar[g] = d;
      }
    }
  } catch (e) {
    return durum("dolDurum", "text-danger", e.message);
  }

  try {
    const r = await chrome.runtime.sendMessage({ tur: "asama5", baslangic: bas, dosyalar });
    if (!r || !r.tamam) return durum("dolDurum", "text-danger", (r && r.mesaj) || "5. aşama başlatılamadı.");
    durum("dolDurum", "text-success", `5. aşama başladı: ${r.toplam} uçuş. İlerleme aşağıda; panel kapansa da sürer.`);
  } catch (e) { durum("dolDurum", "text-danger", "Hata: " + e.message); }
}

const A5_RENK = { tamam: "success", uyari: "warning", hata: "danger", durdu: "secondary", calisiyor: "primary" };

function a5Render(st) {
  const kutu = $("a5Durum");
  if (!kutu) return;
  const calisiyor = !!(st && st.calisiyor);
  $("btnA5").disabled = calisiyor;
  $("btnA5Dur").classList.toggle("d-none", !calisiyor);
  if (!st) { kutu.innerHTML = ""; return; }
  const bas = calisiyor
    ? `<b>Çalışıyor ${st.sonuclar.length}/${st.toplam}</b> · ${esc(st.aktif)} · ${esc(st.adim || "")}`
    : `<b>${esc(st.mesaj || "Bitti.")}</b>${st.ozet ? " " + esc(st.ozet) : ""}`;
  const satirlar = (st.sonuclar || []).slice().reverse().map((r) =>
    `<div class="py-1 border-bottom"><span class="badge bg-${A5_RENK[r.durum] || "secondary"} me-1">${esc(r.gno)}</span>`
    + `${esc((r.notlar || []).join(" · ") || "...")}</div>`).join("");
  kutu.innerHTML = bas + (satirlar
    ? `<div class="border rounded p-1 mt-1 bg-white" style="max-height:160px;overflow:auto">${satirlar}</div>` : "");
}

async function asama5Durdur() {
  try { await chrome.runtime.sendMessage({ tur: "asama5Dur" }); } catch (e) {}
}

// ---- şoförler ----
async function soforYukle() {
  const dosya = $("soforDosya").files[0];
  if (!dosya) return;
  try {
    const txt = await dosya.text();
    const ham = JSON.parse(txt);
    // İki şekil kabul edilir: [sofor, ...] dizisi (eski) veya
    // { soforler: [...], refs: {...} } nesnesi (önerilen; refs = generic eşlemeler).
    const dizi = Array.isArray(ham) ? ham : (ham.soforler || []);
    const refs = (!Array.isArray(ham) && ham.refs) ? ham.refs : null;
    if (!Array.isArray(dizi)) throw new Error("JSON bir dizi ya da {soforler, refs} olmalı.");
    const temiz = dizi
      .map((k) => ({
        kodu: String(k.kodu || k.kod || "").trim(),
        plaka: String(k.plaka || k.plakaNo || "").trim(),
        sofor: String(k.sofor || k.ad || k.adSoyad || "").trim(),
        bolge: String(k.bolge || "").trim(),
        cinsiyet: String(k.cinsiyet || "").trim(),
        tckn: String(k.tckn || "").trim(),
        telefon: String(k.telefon || k.tel || "").trim(),
        adres: String(k.adres || "").trim(),
        ulke: String(k.ulke || "").trim(),
        personelTuru: String(k.personelTuru || k.tur || "").trim()
      }))
      .filter((k) => k.plaka && k.sofor);
    if (!temiz.length) throw new Error("İçinde plaka+şoför olan satır yok.");
    const kayit = { dx_soforler: temiz };
    if (refs) kayit.dx_refs = refs;
    await chrome.storage.local.set(kayit);
    S.dx_soforler = temiz;
    if (refs) S.dx_refs = refs;
    durum("soforDurum", "text-success", temiz.length + " şoför yüklendi. İsterseniz tek tek düzeltebilirsiniz.");
    soforRender();
    if (refs) kurallarDegisti();
  } catch (e) { durum("soforDurum", "text-danger", "Şoför yüklenemedi: " + e.message); }
}

async function soforTemizle() {
  await chrome.storage.local.remove("dx_soforler");
  S.dx_soforler = [];
  soforDuzenleIdx = -1;
  soforFormTemizle();
  durum("soforDurum", "", "Şoför listesi boşaltıldı.");
  soforRender();
}

let soforDuzenleIdx = -1;

function soforFormTemizle() {
  soforDuzenleIdx = -1;
  ["sfKodu", "sfPlaka", "sfSofor", "sfBolge", "sfCinsiyet"].forEach((i) => { $(i).value = ""; });
}

function soforRender() {
  const kutu = $("soforListe");
  kutu.innerHTML = "";
  const liste = S.dx_soforler || [];
  if (!liste.length) { kutu.innerHTML = '<div class="minik">Yüklü şoför yok. JSON yükleyin ya da alttaki formla ekleyin.</div>'; return; }
  liste.forEach((k, i) => {
    const d = document.createElement("div");
    d.className = "sofor-satir";
    d.innerHTML = `<span class="sofor-kod">${esc(k.kodu || "")}</span>` +
      `<span class="sofor-bilgi">` +
      `<span>${esc(k.plaka)} — ${esc(k.sofor)}</span>` +
      `<span class="minik">${esc(k.bolge || "")}${k.cinsiyet ? " · " + esc(k.cinsiyet) : ""}</span>` +
      `</span>` +
      `<span class="text-nowrap">` +
      `<button class="btn btn-sm btn-outline-primary me-1" data-i="${i}" data-a="duzenle">Düzenle</button>` +
      `<button class="btn btn-sm btn-outline-danger" data-i="${i}" data-a="sil">Sil</button>` +
      `</span>`;
    d.querySelector('[data-a="duzenle"]').onclick = () => soforDuzenle(i);
    d.querySelector('[data-a="sil"]').onclick = () => soforSil(i);
    kutu.appendChild(d);
  });
  soforSelectGuncelle();
  seciliSoforSec();
}

function soforDuzenle(i) {
  const k = (S.dx_soforler || [])[i];
  if (!k) return;
  soforDuzenleIdx = i;
  $("sfKodu").value = k.kodu || "";
  $("sfPlaka").value = k.plaka || "";
  $("sfSofor").value = k.sofor || "";
  $("sfBolge").value = k.bolge || "";
  $("sfCinsiyet").value = k.cinsiyet || "";
  durum("soforDurum", "", "Satır " + (i + 1) + " düzenleniyor.");
}

async function soforSil(i) {
  if (!confirm("Bu şoförü silmek istediğinize emin misiniz?")) return;
  const liste = (S.dx_soforler || []).slice();
  liste.splice(i, 1);
  await chrome.storage.local.set({ dx_soforler: liste });
  S.dx_soforler = liste;
  if (soforDuzenleIdx === i) soforFormTemizle();
  soforRender();
  durum("soforDurum", "", "Şoför silindi.");
}

async function soforKaydet() {
  const yeni = {
    kodu: $("sfKodu").value.trim(),
    plaka: $("sfPlaka").value.trim(),
    sofor: $("sfSofor").value.trim(),
    bolge: $("sfBolge").value.trim(),
    cinsiyet: $("sfCinsiyet").value.trim()
  };
  if (!yeni.plaka || !yeni.sofor) return durum("soforDurum", "text-danger", "Plaka ve şoför adı zorunlu.");
  const liste = (S.dx_soforler || []).slice();
  if (soforDuzenleIdx >= 0) {
    liste[soforDuzenleIdx] = yeni;
    durum("soforDurum", "", "Şoför güncellendi.");
  } else {
    liste.push(yeni);
    durum("soforDurum", "", "Şoför eklendi.");
  }
  await chrome.storage.local.set({ dx_soforler: liste });
  S.dx_soforler = liste;
  soforFormTemizle();
  soforRender();
}

async function sabitKaydet() {
  const tel = ($("sabitTel") ? $("sabitTel").value : "").trim();
  const ucret = ($("sabitUcret") ? $("sabitUcret").value : "").trim();
  const sabitAnahtar = ($("sabitAnahtar") ? $("sabitAnahtar").value : "").trim().toUpperCase();
  const sabitIlce = ($("sabitIlce") ? $("sabitIlce").value : "").trim().toUpperCase();

  S.dx_sabit = {
    ...(S.dx_sabit || {}),
    aracTelNo: tel,
    grupUcret: ucret,
    sabitAnahtar,
    sabitIlce
  };
  await chrome.storage.local.set({ dx_sabit: S.dx_sabit });
  durum("sabitDurum", "text-success", "Sabit değerler başarıyla kaydedildi.");
  // Varsayılan anahtar/ilçe kayıtlara yazılmaz; yalnız bölgesi tanınmayan kayıtlarda devreye girer.
  listeRender();
  detayRender();
}

// Ayarlar kuralları değişince önizlemeler yeniden hesaplanır (kayıtlar değişmez).
function kurallarDegisti() {
  listeRender();
  detayRender();
}

function ayrAnahtarRender1() {
  const box = $("ayrAnahtarListe1") || $("ayrAnahtarListe");
  if (!box) return;
  box.innerHTML = "";
  const liste = S.dx_anahtarlar_a1 || [];
  if (!liste.length) {
    box.innerHTML = '<div class="minik text-muted">1. Aşama için kayıtlı anahtar yok.</div>';
    return;
  }
  liste.forEach((item, idx) => {
    const d = document.createElement("div");
    d.className = "d-flex justify-content-between align-items-center py-1 border-bottom minik";
    d.style.cursor = "pointer";
    d.innerHTML = `<span><b>${esc(item.anahtar)}</b> → ${esc(item.ilce)}</span>`
      + `<button class="btn btn-sm btn-outline-danger py-0 px-1" style="font-size:10px" data-idx="${idx}">Sil</button>`;
    d.querySelector("button").onclick = async (e) => {
      e.stopPropagation();
      S.dx_anahtarlar_a1.splice(idx, 1);
      await chrome.storage.local.set({ dx_anahtarlar_a1: S.dx_anahtarlar_a1 });
      ayrAnahtarRender1();
      kurallarDegisti();
    };
    d.onclick = () => {
      if ($("ayrAnahtar1")) $("ayrAnahtar1").value = item.anahtar;
      if ($("ayrIlce1")) $("ayrIlce1").value = item.ilce;
    };
    box.appendChild(d);
  });
}

function ayrAnahtarRender2() {
  const box = $("ayrAnahtarListe2");
  if (!box) return;
  box.innerHTML = "";
  const liste = S.dx_anahtarlar_a2 || [];
  if (!liste.length) {
    box.innerHTML = '<div class="minik text-muted">2. Aşama için kayıtlı anahtar yok.</div>';
    return;
  }
  liste.forEach((item, idx) => {
    const d = document.createElement("div");
    d.className = "d-flex justify-content-between align-items-center py-1 border-bottom minik";
    d.style.cursor = "pointer";
    d.innerHTML = `<span><b>${esc(item.anahtar)}</b> → ${esc(item.ilce)}</span>`
      + `<button class="btn btn-sm btn-outline-danger py-0 px-1" style="font-size:10px" data-idx="${idx}">Sil</button>`;
    d.querySelector("button").onclick = async (e) => {
      e.stopPropagation();
      S.dx_anahtarlar_a2.splice(idx, 1);
      await chrome.storage.local.set({ dx_anahtarlar_a2: S.dx_anahtarlar_a2 });
      ayrAnahtarRender2();
      kurallarDegisti();
    };
    d.onclick = () => {
      if ($("ayrAnahtar2")) $("ayrAnahtar2").value = item.anahtar;
      if ($("ayrIlce2")) $("ayrIlce2").value = item.ilce;
    };
    box.appendChild(d);
  });
}

function ayrAnahtarRender() {
  ayrAnahtarRender1();
  ayrAnahtarRender2();
}

async function ayrAnahtarEkle1() {
  let an = ($("ayrAnahtar1") ? $("ayrAnahtar1").value : ($("ayrAnahtar") ? $("ayrAnahtar").value : "")).trim().toUpperCase();
  let ilce = ($("ayrIlce1") ? $("ayrIlce1").value : ($("ayrIlce") ? $("ayrIlce").value : "")).trim().toUpperCase();

  if (!ilce && an) {
    const ayir = an.match(/^([^\s,\-\/]+)[\s,\-\/]+(.+)$/);
    if (ayir) {
      an = ayir[1].trim().toUpperCase();
      ilce = ayir[2].trim().toUpperCase();
    }
  }

  if (!an || !ilce) {
    durum("ayrAnahtarDurum1", "text-danger", "Anahtar ve İlçe zorunludur.");
    return;
  }
  S.dx_anahtarlar_a1 = S.dx_anahtarlar_a1 || [];
  const idx = S.dx_anahtarlar_a1.findIndex((x) => x.anahtar === an);
  if (idx >= 0) S.dx_anahtarlar_a1[idx].ilce = ilce;
  else S.dx_anahtarlar_a1.push({ anahtar: an, ilce });
  await chrome.storage.local.set({ dx_anahtarlar_a1: S.dx_anahtarlar_a1 });
  ayrAnahtarRender1();
  kurallarDegisti();

  if ($("ayrAnahtar1")) $("ayrAnahtar1").value = "";
  if ($("ayrIlce1")) $("ayrIlce1").value = "";
  durum("ayrAnahtarDurum1", "text-success", `1. Aşama Kaydedildi: ${an} → ${ilce}`);
}

async function ayrAnahtarEkle2() {
  let an = ($("ayrAnahtar2") ? $("ayrAnahtar2").value : "").trim().toUpperCase();
  let ilce = ($("ayrIlce2") ? $("ayrIlce2").value : "").trim().toUpperCase();

  if (!ilce && an) {
    const ayir = an.match(/^([^\s,\-\/]+)[\s,\-\/]+(.+)$/);
    if (ayir) {
      an = ayir[1].trim().toUpperCase();
      ilce = ayir[2].trim().toUpperCase();
    }
  }

  if (!an || !ilce) {
    durum("ayrAnahtarDurum2", "text-danger", "Anahtar ve İlçe zorunludur.");
    return;
  }
  S.dx_anahtarlar_a2 = S.dx_anahtarlar_a2 || [];
  const idx = S.dx_anahtarlar_a2.findIndex((x) => x.anahtar === an);
  if (idx >= 0) S.dx_anahtarlar_a2[idx].ilce = ilce;
  else S.dx_anahtarlar_a2.push({ anahtar: an, ilce });
  await chrome.storage.local.set({ dx_anahtarlar_a2: S.dx_anahtarlar_a2 });
  ayrAnahtarRender2();
  kurallarDegisti();

  if ($("ayrAnahtar2")) $("ayrAnahtar2").value = "";
  if ($("ayrIlce2")) $("ayrIlce2").value = "";
  durum("ayrAnahtarDurum2", "text-success", `2. Aşama Kaydedildi: ${an} → ${ilce}`);
}

async function ayrAnahtarYukle1() {
  const f = $("ayrAnahtarDosya1") && $("ayrAnahtarDosya1").files[0];
  if (!f) return;
  try {
    const txt = await f.text();
    const data = JSON.parse(txt);
    const dizi = Array.isArray(data) ? data : (data.anahtarlar || []);
    if (!dizi.length) return durum("ayrAnahtarDurum1", "text-danger", "JSON içinde anahtar bulunamadı.");
    S.dx_anahtarlar_a1 = dizi.map((x) => ({
      anahtar: String(x.anahtar || x.key || "").trim().toUpperCase(),
      ilce: String(x.ilce || x.district || "").trim().toUpperCase()
    })).filter((x) => x.anahtar && x.ilce);
    await chrome.storage.local.set({ dx_anahtarlar_a1: S.dx_anahtarlar_a1 });
    ayrAnahtarRender1();
    kurallarDegisti();
    durum("ayrAnahtarDurum1", "text-success", `${S.dx_anahtarlar_a1.length} kural yüklendi.`);
  } catch (e) {
    durum("ayrAnahtarDurum1", "text-danger", "JSON okunamadı: " + e.message);
  }
}

async function ayrAnahtarYukle2() {
  const f = $("ayrAnahtarDosya2") && $("ayrAnahtarDosya2").files[0];
  if (!f) return;
  try {
    const txt = await f.text();
    const data = JSON.parse(txt);
    const dizi = Array.isArray(data) ? data : (data.anahtarlar || []);
    if (!dizi.length) return durum("ayrAnahtarDurum2", "text-danger", "JSON içinde anahtar bulunamadı.");
    S.dx_anahtarlar_a2 = dizi.map((x) => ({
      anahtar: String(x.anahtar || x.key || "").trim().toUpperCase(),
      ilce: String(x.ilce || x.district || "").trim().toUpperCase()
    })).filter((x) => x.anahtar && x.ilce);
    await chrome.storage.local.set({ dx_anahtarlar_a2: S.dx_anahtarlar_a2 });
    ayrAnahtarRender2();
    kurallarDegisti();
    durum("ayrAnahtarDurum2", "text-success", `${S.dx_anahtarlar_a2.length} kural yüklendi.`);
  } catch (e) {
    durum("ayrAnahtarDurum2", "text-danger", "JSON okunamadı: " + e.message);
  }
}

function ayrAnahtarIndir1() {
  const liste = S.dx_anahtarlar_a1 || [];
  if (!liste.length) return durum("ayrAnahtarDurum1", "text-danger", "Dışa aktarılacak kural yok.");
  jsonDosyasiIndir({ asama: "1. Aşama", anahtarlar: liste }, "anahtarlar_1asama.json");
  durum("ayrAnahtarDurum1", "text-success", "1. Aşama anahtar listesi indirildi.");
}

function ayrAnahtarIndir2() {
  const liste = S.dx_anahtarlar_a2 || [];
  if (!liste.length) return durum("ayrAnahtarDurum2", "text-danger", "Dışa aktarılacak kural yok.");
  jsonDosyasiIndir({ asama: "2. Aşama", anahtarlar: liste }, "anahtarlar_2asama.json");
  durum("ayrAnahtarDurum2", "text-success", "2. Aşama anahtar listesi indirildi.");
}

async function ayrAnahtarTemizle1() {
  S.dx_anahtarlar_a1 = [];
  await chrome.storage.local.set({ dx_anahtarlar_a1: [] });
  ayrAnahtarRender1();
  kurallarDegisti();
  durum("ayrAnahtarDurum1", "", "1. Aşama kuralları temizlendi.");
}

async function ayrAnahtarTemizle2() {
  S.dx_anahtarlar_a2 = [];
  await chrome.storage.local.set({ dx_anahtarlar_a2: [] });
  ayrAnahtarRender2();
  kurallarDegisti();
  durum("ayrAnahtarDurum2", "", "2. Aşama kuralları temizlendi.");
}

function kisayolRender() {
  const komut = (chrome.runtime.getManifest().commands) || {};
  const etiket = { asama1: "1. Aşama", asama2: "2. Aşama", asama3: "3. Aşama", asama4: "4. Aşama (yolcu Excel)", asama5: "5. Aşama (otomatik)" };
  const kutu = $("ksaListe");
  kutu.innerHTML = (["asama1", "asama2", "asama3", "asama4", "asama5"]).map((id) => {
    const k = komut[id];
    const tus = (k && k.suggested_key && k.suggested_key.default) || "-";
    return `<div class="minik mb-1">${esc(etiket[id] || id)}: <kbd>${esc(tus)}</kbd></div>`;
  }).join("") + '<div class="minik">GTS sekmesi açıkken çalışır; sonuç araç çubuğu rozetinde görünür.</div>';
}

// ---- güncelleme ----
async function guncelleKontrol() {
  const a = $("guncelDurum");
  a.innerHTML = "Kontrol ediliyor...";
  try {
    const srv = normalizeSrv(S.dx_server || "");
    if (!srv) { a.innerHTML = "Sunucu adresi kayıtlı değil."; return; }
    const r = await fetch(srv + "/eklenti/latest.json");
    const m = await r.json();
    const yerel = chrome.runtime.getManifest().version;
    const yeni = (m.version || "").replace(/^v/i, "");
    if (yeni && yeni !== yerel) {
      a.innerHTML = `Sunucuda <b>v${esc(yeni)}</b> var (yerel v${esc(yerel)}). İndirmek için butonu kullanın.`;
      $("btnGuncelle").disabled = false;
    } else {
      a.innerHTML = "Eklentinin en yeni sürümündesiniz (v" + esc(yerel) + ").";
      $("btnGuncelle").disabled = true;
    }
  } catch (e) { a.innerHTML = "Kontrol edilemedi: " + esc(e.message); }
}

async function guncelleIndir() {
  try {
    const srv = normalizeSrv(S.dx_server || "");
    const m = await (await fetch(srv + "/eklenti/latest.json")).json();
    const ver = (m.version || "").replace(/^v/i, "");
    await chrome.downloads.download({
      url: srv + (m.url || "/eklenti/devxpe-eklenti.zip"),
      filename: "rodopzer-eklenti-v" + ver + ".zip",
      conflictAction: "overwrite"
    });
    durum("guncelDurum", "text-success", "İndirme başladı. Zip'i çıkarıp eklentiyi yeniden yükleyin.");
  } catch (e) { durum("guncelDurum", "text-danger", "İndirilemedi: " + e.message); }
}

// ---- ayrı pencere / yan panel ----
async function ayriPencere() {
  try {
    await chrome.windows.create({ url: chrome.runtime.getURL("popup/pencere.html"), type: "popup", width: 700, height: 800 });
  } catch (e) {
    durum("pencereDurum", "text-danger", "Pencere açılamadı: " + e.message);
  }
}

// Tarayıcının sağına gömülü mod: yan panel pencereye bağlı olduğu için
// sekme değiştirince kapanmaz; kapatana kadar sağda açık kalır.
async function panelAc() {
  try {
    if (!chrome.sidePanel || !chrome.sidePanel.open) {
      throw new Error("bu Chrome sürümü yan paneli desteklemiyor (Chrome 116+ gerekir); "
        + "\"Ayrı pencerede aç\" seçeneğini kullanın");
    }
    const pencere = await chrome.windows.getCurrent();
    try {
      await chrome.sidePanel.setOptions({ path: "popup/pencere.html", enabled: true });
    } catch (e) { /* varsayılan yol manifest'ten gelir */ }
    await chrome.sidePanel.open({ windowId: pencere.id });
    // Araç çubuğu popup'ından açıldıysa popup kapanır, panel açık kalır.
    // (Panelin/ayrı pencerenin kendi içinden basıldıysa kapatma yapılmaz.)
    if (!document.body.classList.contains("pencere")) window.close();
    else durum("pencereDurum", "text-success", "Yan panel açık.");
  } catch (e) {
    durum("pencereDurum", "text-danger", "Panel açılamadı: " + e.message);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  try { chrome.action.setBadgeText({ text: "" }); } catch (e) {}
  $("btnSrv").addEventListener("click", srvKaydet);
  $("srv").addEventListener("keydown", (ev) => { if (ev.key === "Enter") srvKaydet(); });
  // POC-TEST: lisans alani kaldirildi (btnLis/kod yok).
  $("btnArr").addEventListener("click", () => xmlUret("arrival"));
  $("btnDep").addEventListener("click", () => xmlUret("departure"));
  $("btnA1").addEventListener("click", () => doldur("asama1"));
  $("btnA2").addEventListener("click", () => doldur("asama2"));
  $("btnA3").addEventListener("click", () => doldur("asama3"));
  $("btnA4").addEventListener("click", () => doldur("asama4"));
  $("btnA5").addEventListener("click", asama5Baslat);
  $("btnA5Dur").addEventListener("click", asama5Durdur);
  chrome.storage.local.get(["dx_a5"]).then((o) => a5Render(o.dx_a5));
  chrome.storage.onChanged.addListener((d, alan) => {
    if (alan === "local" && d.dx_a5) a5Render(d.dx_a5.newValue);
  });
  $("btnYolcu").addEventListener("click", () => $("yolcuDosya").click());
  $("yolcuDosya").addEventListener("change", yolcuYukle);
  $("yolcuKlasor").addEventListener("change", async () => {
    S.dx_yolcuKlasor = $("yolcuKlasor").value.trim() || VARSAYILAN_YOLCU_KLASOR;
    $("yolcuKlasor").value = S.dx_yolcuKlasor;
    await chrome.storage.local.set({ dx_yolcuKlasor: S.dx_yolcuKlasor });
    klasorDurumRender();
  });
  $("otoKaydet").addEventListener("change", async () => {
    S.dx_otoKaydet = $("otoKaydet").checked;
    await chrome.storage.local.set({ dx_otoKaydet: S.dx_otoKaydet });
  });
  $("btnYolcuKaydet").addEventListener("click", async () => {
    try {
      const k = await grupDosyalariniKaydet(true);
      if (k.izinGerekli) klasorSekmesi("yaz"); // izin bu panelden verilemiyor
      else if (k.klasorYok) {
        const z = await zipIndir();
        durum("yolcuAyarDurum", "text-success", `${z.n} grup dosyası tek ZIP olarak indirildi: ${z.yer}`);
      } else durum("yolcuAyarDurum", "text-success", `${k.n} grup dosyası kaydedildi: ${k.yer}`);
    } catch (e) { klasorSekmesi("yaz"); }
    klasorDurumRender();
  });
  $("btnKlasorSec").addEventListener("click", klasorSec);
  $("btnKlasorIzin").addEventListener("click", async () => {
    // Önce burada dene; panel izin penceresi açamıyorsa klasör sekmesine geç
    const { izin } = await klasorHazir(true);
    if (izin !== "granted") klasorSekmesi("yaz");
    klasorDurumRender();
  });
  // Klasör sekmesinde seçim/izin yapılınca panel durumu kendiliğinden yenilensin
  chrome.storage.onChanged.addListener((d, alan) => {
    if (alan !== "local") return;
    if (d.dx_yolcuAltKlasor) S.dx_yolcuAltKlasor = d.dx_yolcuAltKlasor.newValue;
    if (d.dx_klasorGuncel) {
      klasorDurumRender();
      durum("yolcuAyarDurum", "text-success", "Klasör ayarlandı.");
      const satir = $("yolcuKayitSatiri");
      if (satir) satir.innerHTML = '<span class="text-success">Grup dosyaları klasöre yazıldı.</span>';
    }
  });
  $("btnKlasorBirak").addEventListener("click", async () => {
    await KLASOR.sil();
    durum("yolcuAyarDurum", "", "Klasör bırakıldı; dosyalar yeniden İndirilenler'e indirilecek.");
    klasorDurumRender();
  });
  $("btnYolcuTemizle").addEventListener("click", yolcuTemizle);
  $("pdf").addEventListener("change", pdfYukle);
  $("tarih").addEventListener("change", async () => { S.dx_tarih = $("tarih").value; await chrome.storage.local.set({ dx_tarih: S.dx_tarih }); });
  $("sabitTel").addEventListener("change", async () => {
    S.dx_sabit = { ...(S.dx_sabit || {}), aracTelNo: $("sabitTel").value.trim() };
    await chrome.storage.local.set({ dx_sabit: S.dx_sabit });
  });
  $("sabitUcret").addEventListener("change", async () => {
    S.dx_sabit = { ...(S.dx_sabit || {}), grupUcret: $("sabitUcret").value.trim() };
    await chrome.storage.local.set({ dx_sabit: S.dx_sabit });
  });
  $("btnSoforYukle").addEventListener("click", () => $("soforDosya").click());
  $("soforDosya").addEventListener("change", soforYukle);
  $("btnSoforTemizle").addEventListener("click", soforTemizle);
  const bsi = $("btnSoforIndir");
  if (bsi) bsi.addEventListener("click", soforlerJsonAktar);
  const bja = $("btnJsonAktar");
  if (bja) bja.addEventListener("click", kayitlarJsonAktar);
  const bja1 = $("btnJsonAktar1");
  if (bja1) bja1.addEventListener("click", kayitlarJsonAktar1);
  const bja2 = $("btnJsonAktar2");
  if (bja2) bja2.addEventListener("click", kayitlarJsonAktar2);
  $("btnSoforKaydet").addEventListener("click", soforKaydet);
  $("btnSoforYeni").addEventListener("click", () => { soforFormTemizle(); durum("soforDurum", "", "Yeni şoför ekleyin."); });
  $("btnKisayol").addEventListener("click", () => {
    try { chrome.tabs.create({ url: "chrome://extensions/shortcuts" }); }
    catch (e) { durum("guncelDurum", "text-danger", "Açılamadı: " + e.message); }
  });
  kisayolRender();
  $("btnTara").addEventListener("click", sayfaTara);
  $("btnGuncelle").addEventListener("click", guncelleIndir);
  $("btnPencere").addEventListener("click", ayriPencere);
  $("btnPanel").addEventListener("click", panelAc);
  $("btnGeri").addEventListener("click", () => seciliGit(-1));
  $("btnIleri").addEventListener("click", () => seciliGit(1));
  if ($("btnSabitKaydet")) $("btnSabitKaydet").addEventListener("click", sabitKaydet);
  if ($("btnAyrAnahtarEkle1")) $("btnAyrAnahtarEkle1").addEventListener("click", ayrAnahtarEkle1);
  if ($("btnAyrAnahtarEkle2")) $("btnAyrAnahtarEkle2").addEventListener("click", ayrAnahtarEkle2);
  if ($("btnAyrAnahtarYukle1")) $("btnAyrAnahtarYukle1").addEventListener("click", () => $("ayrAnahtarDosya1") && $("ayrAnahtarDosya1").click());
  if ($("btnAyrAnahtarYukle2")) $("btnAyrAnahtarYukle2").addEventListener("click", () => $("ayrAnahtarDosya2") && $("ayrAnahtarDosya2").click());
  if ($("ayrAnahtarDosya1")) $("ayrAnahtarDosya1").addEventListener("change", ayrAnahtarYukle1);
  if ($("ayrAnahtarDosya2")) $("ayrAnahtarDosya2").addEventListener("change", ayrAnahtarYukle2);
  if ($("btnAyrAnahtarIndir1")) $("btnAyrAnahtarIndir1").addEventListener("click", ayrAnahtarIndir1);
  if ($("btnAyrAnahtarIndir2")) $("btnAyrAnahtarIndir2").addEventListener("click", ayrAnahtarIndir2);
  if ($("btnAyrAnahtarTemizle1")) $("btnAyrAnahtarTemizle1").addEventListener("click", ayrAnahtarTemizle1);
  if ($("btnAyrAnahtarTemizle2")) $("btnAyrAnahtarTemizle2").addEventListener("click", ayrAnahtarTemizle2);

  // İl seçimi kısayollarda da geçerli olsun diye saklanır
  const selIl = $("selIl");
  if (selIl) {
    selIl.addEventListener("change", async () => {
      S.dx_ilSecili = selIl.value;
      try { await chrome.storage.local.set({ dx_ilSecili: S.dx_ilSecili }); } catch (e) {}
      detayRender();
    });
  }
  $("tarih").addEventListener("change", detayRender);

  document.addEventListener("keydown", (ev) => {
    // Alt + ← / → : uçuşlar arasında hızlı geçiş (yazı alanlarını bozmaz)
    if (!ev.altKey || ev.ctrlKey || ev.metaKey) return;
    if (ev.key === "ArrowLeft") { ev.preventDefault(); seciliGit(-1); }
    else if (ev.key === "ArrowRight") { ev.preventDefault(); seciliGit(1); }
  });
  yukle();
});