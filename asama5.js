// 5. aşama: tam otomatik akış (background.js içinden importScripts ile yüklenir).
// Seçili uçuştan listenin sonuna kadar her uçuş için GTS'de sırayla:
//   Yeni Sefer (1. aşama) -> Personel (2. aşama) -> Grup (3. aşama) -> Yolcu Excel'i (4. aşama)
// Her adımdan önce GTS'de o iş zaten yapılmış mı bakılır; akış yarıda kalıp yeniden
// başlatıldığında kopya sefer/personel/grup/yolcu oluşturmadan kaldığı yerden sürer.

const A5_SAYFA = "/UAB_TARIFESIZ?page=tarifesiz-yolcu-tasimaciligi-islemleri";
const A5_YUKLEME_MS = 45000;
const A5_ARDISIK_HATA = 3;

let a5 = null; // çalışan akışın durumu (aynı anda tek akış)

class A5Dur extends Error {}

const a5Bekle = (ms) => new Promise((r) => setTimeout(r, ms));

const a5Katla = (s) => String(s || "")
  .replace(/[İIı]/g, "I").replace(/i/g, "I")
  .replace(/[Şş]/g, "S").replace(/[Ğğ]/g, "G").replace(/[Üü]/g, "U")
  .replace(/[Öö]/g, "O").replace(/[Çç]/g, "C")
  .toUpperCase().replace(/\s+/g, " ").trim();

// ---- sayfa tarafı (executeScript func: kendi başına yeterli olmalı) ----

function a5Sayfa() {
  const temiz = (s) => String(s || "").replace(/\s+/g, " ").trim();
  const q = (s) => { try { return document.querySelector(s); } catch (e) { return null; } };
  const gorunur = (e) => !!(e && (e.offsetParent !== null || e.getClientRects().length));
  const metinler = (sel) => Array.from(document.querySelectorAll(sel))
    .filter(gorunur).map((e) => temiz(e.innerText)).filter(Boolean).slice(0, 10);
  const girdi = (id) => { const e = q("#" + id); return !!e && e.type !== "hidden"; };
  const asamaLink = (a) => { const e = q(`a[href*='asama=${a}']`); return e ? e.href : ""; };
  const linkler = (tr) => {
    const l = {};
    tr.querySelectorAll("a[href*='asama=']").forEach((a) => {
      const m = a.href.match(/[?&]asama=([^&]+)/);
      if (m && !l[m[1]]) l[m[1]] = a.href;
    });
    return l;
  };
  const hucreler = (tr) => Array.from(tr.cells).map((td) => temiz(td.innerText));

  const seferler = Array.from(document.querySelectorAll("#searchTable tbody tr"))
    .map((tr) => ({ h: hucreler(tr), l: linkler(tr) }))
    .filter((s) => s.h.length >= 4);

  const grupSatirlari = Array.from(document.querySelectorAll("a[href*='asama=yolcuListesi']"))
    .map((a) => {
      const tr = a.closest("tr");
      return { href: a.href, hucreler: tr ? hucreler(tr).filter(Boolean) : [] };
    })
    .filter((g) => g.hucreler.length);

  // Kişi tabloları (personel / yolcu): başlığında "Soyad" geçen tabloların veri satırları
  const kisiSatirlari = [];
  document.querySelectorAll("table").forEach((t) => {
    if (t.id === "searchTable") return;
    const baslik = temiz((t.tHead && t.tHead.innerText) || (t.rows[0] && t.rows[0].innerText) || "");
    if (!/soyad/i.test(baslik)) return;
    Array.from(t.tBodies.length ? t.tBodies : [t]).forEach((b) => {
      Array.from(b.rows).forEach((tr) => {
        const h = hucreler(tr);
        if (tr.querySelector("th") || h.filter(Boolean).length < 2) return;
        if (/kay[ıi]t (bulunamad|yok)/i.test(h.join(" "))) return;
        kisiSatirlari.push(h.join(" | "));
      });
    });
  });

  return {
    url: location.href,
    asama: new URLSearchParams(location.search).get("asama") || "",
    hata: metinler(".errorContainer, .warningContainer, .fieldError, .formError, .errorMessage, .alert-danger, ul.errorList li, [role='alert']"),
    basari: metinler(".successContainer, .alert-success"),
    dugmeler: Array.from(document.querySelectorAll("input[type='submit'], button[type='submit']"))
      .filter(gorunur).map((b) => temiz(b.value || b.innerText)),
    form: {
      sefer: girdi("seferHareketSaati"),
      personel: girdi("tckn"),
      grup: girdi("grupAdi"),
      dosya: !!q("input[type='file']")
    },
    link: {
      yeniPersonel: asamaLink("yeniPersonel"),
      yeniGrup: asamaLink("yeniGrup"),
      excelYukle: asamaLink("excelYukle")
    },
    seferler,
    grupSatirlari,
    kisiSatirlari: kisiSatirlari.slice(0, 500)
  };
}

// Düğmeye bir an sonra basar ki betik sonucu sayfa gönderilmeden dönsün.
function a5Bas(degerler, dosyaFormu) {
  const temiz = (s) => String(s || "").replace(/\s+/g, " ").trim();
  let kapsam = document;
  if (dosyaFormu) {
    const f = document.querySelector("input[type='file']");
    kapsam = (f && (f.form || f.closest("form"))) || document;
  }
  const tum = Array.from(kapsam.querySelectorAll("input[type='submit'], button[type='submit'], button"))
    .filter((b) => !b.disabled);
  let b = null;
  for (const d of degerler) {
    b = tum.find((x) => temiz(x.value || x.innerText) === d);
    if (b) break;
  }
  if (!b && dosyaFormu) b = tum.find((x) => x.type === "submit");
  if (!b) return false;
  setTimeout(() => b.click(), 150);
  return true;
}

// ---- gezinme ----

async function a5Oku(tabId) {
  const r = await chrome.scripting.executeScript({ target: { tabId }, func: a5Sayfa });
  const s = r && r[0] && r[0].result;
  if (!s) throw new Error("Sayfa okunamadı.");
  if (!/UAB_TARIFESIZ/i.test(s.url)) {
    throw new A5Dur("GTS oturumu kapanmış görünüyor (açılan sayfa: " + s.url + "). Giriş yapıp tekrar başlatın.");
  }
  return s;
}

async function a5Git(tabId, url) {
  a5Kontrol();
  const bekle = sekmeYuklenince(tabId, A5_YUKLEME_MS);
  await chrome.tabs.update(tabId, { url });
  await bekle;
  return a5Oku(tabId);
}

async function a5Gonder(tabId, degerler, dosyaFormu = false) {
  a5Kontrol();
  const bekle = sekmeYuklenince(tabId, A5_YUKLEME_MS);
  bekle.catch(() => {});
  const r = await chrome.scripting.executeScript({ target: { tabId }, func: a5Bas, args: [degerler, dosyaFormu] });
  if (!(r && r[0] && r[0].result)) throw new Error(`"${degerler[0]}" düğmesi bulunamadı.`);
  try {
    await bekle;
  } catch (e) {
    const s = await a5Oku(tabId);
    throw new Error(`"${degerler[0]}" sonrası sayfa yenilenmedi` + (s.hata.length ? ": " + s.hata.join(" | ") : "."));
  }
  return a5Oku(tabId);
}

async function a5Doldur(tabId, tarif) {
  let sonuc;
  try {
    await chrome.scripting.executeScript({
      target: { tabId }, world: "MAIN", func: (rc) => { window.__dx_recipe = rc; }, args: [tarif]
    });
    sonuc = await chrome.scripting.executeScript({ target: { tabId }, files: ["inject.js"], world: "MAIN" });
  } catch (e) {
    await chrome.storage.local.set({ dx_recipe: tarif });
    sonuc = await chrome.scripting.executeScript({ target: { tabId }, files: ["inject.js"] });
  }
  const r = sonuc && sonuc[0] && sonuc[0].result;
  if (!r || r.tamam === false) throw new Error((r && r.mesaj) || "Form doldurulamadı.");
  return r;
}

// ---- eşleştirme ----

// Sefer listesinde uçuşun satırı: firma sefer no + başlangıç tarih/saat + plaka birebir.
// "1/11/2026 8:05" ve "01.11.2026 08:05" -> "01/11/2026 08:05"
function a5Zaman(s) {
  const m = String(s || "").match(/(\d{1,2})[./-](\d{1,2})[./-](\d{4})\s+(\d{1,2}):(\d{2})/);
  if (!m) return String(s || "").trim();
  const p = (x) => x.padStart(2, "0");
  return `${p(m[1])}/${p(m[2])}/${m[3]} ${p(m[4])}:${m[5]}`;
}

function a5SeferBul(seferler, an) {
  const bas = a5Zaman(`${an.tarih} ${an.saat}`);
  return (seferler || []).find((s) =>
    a5Katla(s.h[0]) === a5Katla(an.gno)
    && a5Zaman(s.h[1]) === bas
    && (!an.plaka || NORM(s.h[3]) === NORM(an.plaka))
    && !/iptal/i.test(s.h[6] || "")) || null;
}

function a5KisiVar(satirlar, adSoyad) {
  const parcalar = a5Katla(adSoyad).split(" ").filter(Boolean);
  if (!parcalar.length) return false;
  return (satirlar || []).some((r) => {
    const k = " " + a5Katla(r).replace(/[^A-Z0-9 ]/g, " ") + " ";
    return parcalar.every((p) => k.includes(" " + p + " "));
  });
}

function a5Sofor(liste, plaka, aracKodu) {
  const np = NORM(plaka);
  let s = np ? (liste || []).find((x) => NORM(x.plaka) === np) : null;
  const nk = String(aracKodu || "").trim().toUpperCase();
  if (!s && nk) s = (liste || []).find((x) => String(x.kodu || "").trim().toUpperCase().startsWith(nk));
  return s || {};
}

// ---- durum ----

function a5Kontrol() {
  if (a5 && a5.durdur) throw new A5Dur("Kullanıcı durdurdu.");
}

async function a5Kaydet() {
  if (!a5) return;
  const { durdur, dosyalar, ...kalici } = a5;
  try { await chrome.storage.local.set({ dx_a5: kalici }); } catch (e) {}
}

async function a5Adim(metin) {
  a5Kontrol();
  a5.adim = metin;
  await a5Kaydet();
}

function a5Not(metin) {
  const r = a5.sonuclar[a5.sonuclar.length - 1];
  if (r) r.notlar.push(metin);
}

// ---- tek uçuş ----

async function a5Ucus(tabId, o, i) {
  const k = o.dx_kayitlar[i];
  const G = String(k.gno || "").trim().toUpperCase();
  const taban = new URL(o.tabUrl).origin + A5_SAYFA;
  const eski = o.dx_anahtarlar || [];
  const ortak = {
    kayit: k, indeks: i, tarih: fmtTarih(o.dx_tarih), yon: o.dx_yon || k.yon || "arrival",
    sabit: o.dx_sabit || {}, refs: o.dx_refs || {}, ilSecili: o.dx_ilSecili || "",
    anahtarlar: eski, anahtarlar1: o.dx_anahtarlar_a1 || eski, anahtarlar2: o.dx_anahtarlar_a2 || eski
  };
  const t1 = KURAL.tarifUret({ ...ortak, asama: "asama1" });
  const deger = (t, id) => ((t.alanlar.find((a) => a.id === id) || {}).deger || "");
  const an = {
    gno: G,
    tarih: deger(t1, "seferBaslangicTarihi"),
    saat: deger(t1, "seferHareketSaati"),
    plaka: deger(t1, "aracPlakasi")
  };
  if (!an.gno || !an.tarih || !an.saat) throw new Error("Uçuşun grup kodu, tarihi ya da saati eksik.");
  const dolumNotu = (r) => (r.hata && r.hata.length ? " (doldurulamayan: " + r.hata.join(", ") + ")" : "");
  const hataMetni = (s) => (s.hata.length ? ": " + s.hata.join(" | ") : "");

  // 1) Sefer
  await a5Adim("sefer listesi kontrol ediliyor");
  let s = await a5Git(tabId, taban + "&asama=seferListesi");
  let sefer = a5SeferBul(s.seferler, an);
  if (sefer) {
    a5Not("sefer zaten var");
  } else {
    await a5Adim("yeni sefer giriliyor");
    s = await a5Git(tabId, taban + "&asama=yeniSefer");
    if (!s.form.sefer) throw new Error("Yeni Sefer formu açılamadı" + hataMetni(s));
    const r = await a5Doldur(tabId, t1);
    await a5Bekle(400);
    s = await a5Gonder(tabId, ["Devam Et"]);
    if (!s.dugmeler.includes("Kaydet")) {
      throw new Error("Sefer formu kabul edilmedi" + hataMetni(s) + dolumNotu(r));
    }
    await a5Adim("sefer kaydediliyor");
    s = await a5Gonder(tabId, ["Kaydet"]);
    if (s.dugmeler.includes("Kaydet") && s.hata.length) throw new Error("Sefer kaydedilemedi" + hataMetni(s));
    s = await a5Git(tabId, taban + "&asama=seferListesi");
    sefer = a5SeferBul(s.seferler, an);
    if (!sefer) throw new Error(`Sefer kaydedildi ama listede bulunamadı (${an.gno} ${an.tarih} ${an.saat}).`);
    a5Not("sefer eklendi");
  }

  // 2) Personel (şoför)
  const sofor = a5Sofor(o.dx_soforler, an.plaka || k.plaka, k.aracKodu);
  if (!sofor.sofor) {
    a5Not(`şoför bulunamadı (plaka ${an.plaka || "-"}), personel eklenmedi`);
    a5.sonuclar[a5.sonuclar.length - 1].uyari = true;
  } else if (!sefer.l.personelListesi) {
    throw new Error("Seferin Personel Listesi bağlantısı yok.");
  } else {
    await a5Adim("personel kontrol ediliyor");
    s = await a5Git(tabId, sefer.l.personelListesi);
    if (a5KisiVar(s.kisiSatirlari, sofor.sofor)) {
      a5Not("personel zaten var");
    } else {
      if (!s.link.yeniPersonel) throw new Error("Yeni Personel bağlantısı bulunamadı" + hataMetni(s));
      await a5Adim("personel giriliyor");
      s = await a5Git(tabId, s.link.yeniPersonel);
      if (!s.form.personel) throw new Error("Yeni Personel formu açılamadı" + hataMetni(s));
      const t2 = KURAL.tarifUret({ ...ortak, asama: "asama2", sofor, sayfaPlaka: an.plaka });
      const r = await a5Doldur(tabId, t2);
      await a5Bekle(300);
      s = await a5Gonder(tabId, ["Ekle"]);
      if (s.form.personel && s.hata.length) throw new Error("Personel eklenemedi" + hataMetni(s) + dolumNotu(r));
      a5Not(`personel eklendi (${sofor.sofor})`);
    }
  }

  // 3) Grup — sefer listesine dönülür, uçuşun satırı yeniden bulunur
  await a5Adim("grup kontrol ediliyor");
  s = await a5Git(tabId, taban + "&asama=seferListesi");
  sefer = a5SeferBul(s.seferler, an);
  if (!sefer || !sefer.l.grupListesi) throw new Error("Sefer listesinde uçuş yeniden bulunamadı.");
  s = await a5Git(tabId, sefer.l.grupListesi);
  let grup = grupSatiri(s.grupSatirlari, G);
  if (grup.length) {
    a5Not("grup zaten var");
  } else {
    if (!s.link.yeniGrup) throw new Error("Yeni Grup bağlantısı bulunamadı" + hataMetni(s));
    await a5Adim("grup giriliyor");
    s = await a5Git(tabId, s.link.yeniGrup);
    if (!s.form.grup) throw new Error("Yeni Grup formu açılamadı" + hataMetni(s));
    const t3 = KURAL.tarifUret({ ...ortak, asama: "asama3" });
    const r = await a5Doldur(tabId, t3);
    await a5Bekle(400);
    s = await a5Gonder(tabId, ["Ekle"]);
    if (s.form.grup && s.hata.length) throw new Error("Grup eklenemedi" + hataMetni(s) + dolumNotu(r));
    s = await a5Git(tabId, sefer.l.grupListesi);
    grup = grupSatiri(s.grupSatirlari, G);
    if (!grup.length) throw new Error(`Grup eklendi ama grup listesinde ${G} bulunamadı` + dolumNotu(r));
    a5Not("grup eklendi");
  }
  if (grup.length > 1) a5Not(`listede ${grup.length} adet ${G} grubu var, ilki kullanıldı`);

  // 4) Yolcular
  const veri = o.dx_yolcu;
  if (!veri || !veri.gruplar || !veri.gruplar[G]) {
    a5Not("yolcu Excel'inde bu grup yok, yolcu yüklenmedi");
    a5.sonuclar[a5.sonuclar.length - 1].uyari = true;
    return;
  }
  await a5Adim("yolcu listesi kontrol ediliyor");
  const yolcuUrl = grup[0].href;
  s = await a5Git(tabId, yolcuUrl);
  if (s.kisiSatirlari.length) {
    a5Not(`yolcular zaten yüklü (${s.kisiSatirlari.length})`);
    return;
  }
  if (!s.link.excelYukle) throw new Error("Excel'den Yükle bağlantısı bulunamadı" + hataMetni(s));
  const dosya = (a5.dosyalar && a5.dosyalar[G])
    ? { ...a5.dosyalar[G], kaynak: "klasörden" }
    : await grupDosyasi(veri, G, null, o.dx_yolcuAltKlasor);
  await a5Adim("yolcu Excel'i yükleniyor");
  s = await a5Git(tabId, s.link.excelYukle);
  if (!s.form.dosya) throw new Error("Excel'den Yükle formu açılamadı" + hataMetni(s));
  const ek = await chrome.scripting.executeScript({
    target: { tabId }, func: YOLCU.dosyaEkle, args: [dosya.b64, dosya.ad, false, G, veri.sira || []]
  });
  const ekS = (ek && ek[0] && ek[0].result) || { tamam: false, mesaj: "Sayfa yanıt vermedi." };
  if (!ekS.tamam) throw new Error(ekS.mesaj);
  await a5Bekle(300);
  s = await a5Gonder(tabId, ["Kaydet", "Yükle", "Devam Et"], true);
  if (s.form.dosya && s.hata.length) throw new Error("Yolcu Excel'i kabul edilmedi" + hataMetni(s));
  const sonra = await a5Git(tabId, yolcuUrl);
  a5Not(`${dosya.yolcu} yolcu yüklendi (${dosya.kaynak})`
    + (sonra.kisiSatirlari.length ? `, listede ${sonra.kisiSatirlari.length}` : ", listede doğrulanamadı")
    + (s.hata.length ? " — GTS uyarısı: " + s.hata.join(" | ") : ""));
  if (sonra.kisiSatirlari.length && sonra.kisiSatirlari.length !== dosya.yolcu) {
    a5.sonuclar[a5.sonuclar.length - 1].uyari = true;
  }
}

// ---- akış ----

async function a5SekmeBul() {
  const tum = await chrome.tabs.query({});
  const gts = (tum || []).filter((t) => t.id && /UAB_TARIFESIZ/i.test(t.url || ""));
  gts.sort((a, b) => (b.active ? 1 : 0) - (a.active ? 1 : 0));
  return gts[0] || null;
}

async function a5Hazirla(baslangic, dosyalar) {
  if (a5 && a5.calisiyor) return { tamam: false, mesaj: "5. aşama zaten çalışıyor." };
  const o = await chrome.storage.local.get([
    "dx_kayitlar", "dx_tarih", "dx_yon", "dx_soforler", "dx_sabit", "dx_refs", "dx_ilSecili",
    "dx_anahtarlar", "dx_anahtarlar_a1", "dx_anahtarlar_a2", "dx_yolcu", "dx_yolcuAltKlasor"]);
  const kayitlar = o.dx_kayitlar || [];
  const bas = Math.min(Math.max(Number(baslangic) || 0, 0), kayitlar.length);
  if (!kayitlar.length || bas >= kayitlar.length) return { tamam: false, mesaj: "İşlenecek uçuş yok. Önce PDF yükleyin." };
  if (!o.dx_tarih) return { tamam: false, mesaj: "Sefer tarihi seçilmedi." };
  const tab = await a5SekmeBul();
  if (!tab) return { tamam: false, mesaj: "GTS (UETDS Tarifesiz) sayfası açık bir sekme bulunamadı. Sefer Listesi'ni açıp tekrar deneyin." };
  o.tabUrl = tab.url;

  const sira = [];
  for (let i = bas; i < kayitlar.length; i++) sira.push(i);
  a5 = {
    calisiyor: true, durdur: false, dosyalar: dosyalar || {},
    baslangicZamani: Date.now(), toplam: sira.length, aktif: "", adim: "başlıyor",
    sonuclar: [], mesaj: ""
  };
  await a5Kaydet();
  a5Calistir(tab.id, o, sira);
  return { tamam: true, toplam: sira.length };
}

async function a5Calistir(tabId, o, sira) {
  // Sayfa yüklenirken servis çalışanı uykuya geçmesin
  const canli = setInterval(() => { chrome.runtime.getPlatformInfo(() => {}); }, 20000);
  let ardisik = 0;
  try {
    for (const i of sira) {
      const k = o.dx_kayitlar[i];
      a5.aktif = k.gno || String(i + 1);
      a5.sonuclar.push({ gno: a5.aktif, durum: "calisiyor", notlar: [] });
      const r = a5.sonuclar[a5.sonuclar.length - 1];
      rozet(`${a5.sonuclar.length}/${a5.toplam}`, "#0d6efd");
      try {
        await a5Ucus(tabId, o, i);
        r.durum = r.uyari ? "uyari" : "tamam";
        ardisik = 0;
      } catch (e) {
        if (e instanceof A5Dur) { r.durum = "durdu"; r.notlar.push(e.message); a5.mesaj = e.message; break; }
        r.durum = "hata";
        r.notlar.push(e.message);
        if (++ardisik >= A5_ARDISIK_HATA) {
          a5.mesaj = `Art arda ${A5_ARDISIK_HATA} uçuşta hata oluştu; akış durduruldu.`;
          break;
        }
      }
      await a5Kaydet();
    }
    // Akış sonunda kullanıcı sefer listesine döner
    try {
      if (!a5.durdur) await a5Git(tabId, new URL(o.tabUrl).origin + A5_SAYFA + "&asama=seferListesi");
    } catch (e) {}
  } catch (e) {
    a5.mesaj = "Beklenmeyen hata: " + e.message;
  } finally {
    clearInterval(canli);
    const say = (d) => a5.sonuclar.filter((x) => x.durum === d).length;
    const hata = say("hata") + say("durdu");
    if (!a5.mesaj) a5.mesaj = "Bitti.";
    a5.ozet = `${say("tamam")} tamam, ${say("uyari")} uyarılı, ${hata} hatalı / ${a5.toplam} uçuş`;
    a5.calisiyor = false;
    a5.adim = "";
    a5.bitisZamani = Date.now();
    rozet(hata ? "!" + hata : "OK", hata ? "#b42318" : "#188038");
    await a5Kaydet();
  }
}

// Servis çalışanı yeniden başladıysa yarıda kalan akışın kaydı "çalışıyor" kalmasın
chrome.storage.local.get(["dx_a5"]).then((o) => {
  if (o.dx_a5 && o.dx_a5.calisiyor && !a5) {
    chrome.storage.local.set({
      dx_a5: { ...o.dx_a5, calisiyor: false, adim: "", mesaj: "Akış yarıda kesildi (tarayıcı/eklenti yeniden başladı). Tekrar başlatınca kaldığı yerden sürer." }
    });
  }
});

chrome.runtime.onMessage.addListener((mesaj, gonderen, yanit) => {
  if (!mesaj) return false;
  if (mesaj.tur === "asama5Dur") {
    if (a5 && a5.calisiyor) { a5.durdur = true; a5.adim = "durduruluyor..."; a5Kaydet(); }
    yanit({ tamam: true });
    return false;
  }
  if (mesaj.tur !== "asama5") return false;
  a5Hazirla(mesaj.baslangic, mesaj.dosyalar)
    .then(yanit)
    .catch((e) => yanit({ tamam: false, mesaj: e.message }));
  return true;
});
