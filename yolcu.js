// YOLCU — 4. aşama (Yolcu Listesi -> Excel'den Yükle).
// Tek yolcu Excel'ini (örn. Sedna dökümü) GrupKodu sütununa göre böler, her grup
// için aynı başlık/sütun düzeninde GrupKodu.xls üretir ve GTS'nin "Dosya Seç"
// alanına ekler. Saf JS + SheetJS (vendors/xlsx.full.min.js): popup (script tag)
// ve service worker (importScripts) birlikte kullanır.
const YOLCU = (() => {
  const xlsx = () => {
    if (typeof XLSX === "undefined") throw new Error("Excel kütüphanesi yüklenemedi (vendors/xlsx.full.min.js).");
    return XLSX;
  };

  // Başlık karşılaştırması: "Soyİsim", "SOYISIM", "Soy isim" -> "SOYISIM"
  const katla = (s) => String(s || "")
    .replace(/[İIıi]/g, "I").toUpperCase()
    .replace(/Ş/g, "S").replace(/Ğ/g, "G").replace(/Ü/g, "U").replace(/Ö/g, "O").replace(/Ç/g, "C")
    .replace(/[^A-Z0-9]/g, "");

  // Bilinen sütunlar (yalnız GrupKodu zorunlu; diğerleri doğrulama ve önizleme için)
  const SUTUNLAR = {
    grup: ["GRUPKODU", "GRUPKOD", "GRUPADI", "GRUP"],
    ulke: ["UETDSULKEKODU", "ULKEKODU", "ULKE", "UYRUK"],
    isim: ["ISIM", "AD", "ADI"],
    soyisim: ["SOYISIM", "SOYAD", "SOYADI"],
    tarih: ["TARIH", "TARIHSAAT"],
    cinsiyet: ["CINSIYET"],
    plaka: ["PLAKA", "ARACPLAKA", "ARACPLAKASI"]
  };

  const hucreMetni = (c) => (c == null ? "" : String(c.w != null ? c.w : c.v != null ? c.v : "").trim());

  // Excel dosyasını okur, satırları grup koduna göre ayırır.
  // Dönen veri JSON'a çevrilebilir (chrome.storage'a yazılır).
  function oku(buf, dosyaAdi) {
    const X = xlsx();
    const wb = X.read(buf, { type: "array", cellNF: true, cellDates: false });
    const sayfaAdi = wb.SheetNames[0];
    const ws = wb.Sheets[sayfaAdi];
    if (!ws || !ws["!ref"]) throw new Error("Excel'de dolu sayfa yok.");
    const alan = X.utils.decode_range(ws["!ref"]);

    // Başlık satırı: GrupKodu sütununu içeren ilk satır (üstte boş/başlık satırları olabilir)
    let basSatir = -1, sutun = {};
    for (let r = alan.s.r; r <= Math.min(alan.e.r, alan.s.r + 10) && basSatir < 0; r++) {
      const bulunan = {};
      for (let c = alan.s.c; c <= alan.e.c; c++) {
        const ad = katla(hucreMetni(ws[X.utils.encode_cell({ r, c })]));
        for (const [anahtar, adlar] of Object.entries(SUTUNLAR)) {
          if (bulunan[anahtar] == null && adlar.includes(ad)) bulunan[anahtar] = c - alan.s.c;
        }
      }
      if (bulunan.grup != null) { basSatir = r; sutun = bulunan; }
    }
    if (basSatir < 0) throw new Error("\"GrupKodu\" sütunu bulunamadı. İlk satırda sütun başlıkları olmalı.");

    const hucre = (r, c) => {
      const h = ws[X.utils.encode_cell({ r, c })];
      if (!h || h.v == null || h.v === "") return null;
      const o = { t: h.t, v: h.v };
      if (h.z && h.z !== "General") o.z = h.z;
      return o;
    };

    const basliklar = [];
    for (let c = alan.s.c; c <= alan.e.c; c++) basliklar.push(hucre(basSatir, c));

    const gruplar = {}, sira = [];
    let kirpilan = 0, grupsuz = 0;
    for (let r = basSatir + 1; r <= alan.e.r; r++) {
      const satir = [];
      for (let c = alan.s.c; c <= alan.e.c; c++) {
        const h = hucre(r, c);
        // Ad/soyad/plaka hücrelerindeki baş-son ve çift boşlukları temizle
        if (h && h.t === "s") {
          const temiz = String(h.v).replace(/\s+/g, " ").trim();
          if (temiz !== h.v) { kirpilan++; h.v = temiz; }
          if (!temiz) { satir.push(null); continue; }
        }
        satir.push(h);
      }
      if (satir.every((h) => h == null)) continue; // boş satır
      const grup = hucreMetni(satir[sutun.grup]).toUpperCase();
      if (!grup) { grupsuz++; continue; }
      if (!gruplar[grup]) { gruplar[grup] = []; sira.push(grup); }
      gruplar[grup].push(satir);
    }
    if (!sira.length) throw new Error("Excel'de grup kodlu yolcu satırı yok.");

    return {
      dosyaAdi: dosyaAdi || "", yuklenme: new Date().toISOString(), sayfaAdi,
      basliklar, sutun, gruplar, sira,
      toplam: sira.reduce((t, g) => t + gruplar[g].length, 0),
      kirpilan, grupsuz
    };
  }

  // Bir grubun özet bilgisi (önizleme / doğrulama)
  function grupOzeti(veri, grup) {
    const satirlar = (veri && veri.gruplar && veri.gruplar[grup]) || [];
    const s = (veri && veri.sutun) || {};
    const kume = (c) => (c == null ? [] : [...new Set(satirlar.map((x) => hucreMetni(x[c])).filter(Boolean))]);
    const saatler = s.tarih == null ? [] : [...new Set(satirlar.map((x) => {
      const h = x[s.tarih];
      if (!h) return "";
      if (h.t === "n") { // Excel seri tarihi -> SS:DD
        const dk = Math.round((h.v % 1) * 24 * 60);
        return String(Math.floor(dk / 60) % 24).padStart(2, "0") + ":" + String(dk % 60).padStart(2, "0");
      }
      const m = String(h.v).match(/(\d{1,2}):(\d{2})/);
      return m ? m[1].padStart(2, "0") + ":" + m[2] : "";
    }).filter(Boolean))];
    return { grup, yolcu: satirlar.length, plakalar: kume(s.plaka), saatler };
  }

  // Listedeki ilk geçerli tarih (YYYY-AA-GG); klasör adında kullanılır.
  function tarihi(veri) {
    const c = veri && veri.sutun && veri.sutun.tarih;
    if (c == null) return "";
    for (const g of veri.sira || []) {
      for (const satir of veri.gruplar[g]) {
        const h = satir[c];
        if (h && h.t === "n" && h.v > 0) {
          return new Date(Math.round((h.v - 25569) * 86400000)).toISOString().slice(0, 10);
        }
        const m = h && String(h.v).match(/(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
        if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
      }
    }
    return "";
  }

  // Windows/Chrome dosya adına uygun "GrupKodu.xls"
  const dosyaAdi = (grup, uzanti = "xls") => String(grup || "GRUP").replace(/[\\/:*?"<>|\s]+/g, "_") + "." + uzanti;

  // Grubun Excel'i: başlık satırı + yalnız o grubun satırları, orijinal hücre türleri/biçimleriyle.
  function grupExcel(veri, grup, uzanti = "xls") {
    const X = xlsx();
    const satirlar = veri && veri.gruplar && veri.gruplar[grup];
    if (!satirlar || !satirlar.length) throw new Error(`Yolcu listesinde "${grup}" grubu yok.`);
    const tumu = [veri.basliklar].concat(satirlar);
    const ws = {};
    let enSutun = 0;
    tumu.forEach((satir, r) => {
      satir.forEach((h, c) => {
        if (!h) return;
        const cell = { t: h.t, v: h.v };
        if (h.z) cell.z = h.z;
        ws[X.utils.encode_cell({ r, c })] = cell;
        if (c > enSutun) enSutun = c;
      });
    });
    ws["!ref"] = X.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: tumu.length - 1, c: Math.max(enSutun, veri.basliklar.length - 1) } });
    const wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, ws, veri.sayfaAdi || "Sheet");
    const out = X.write(wb, { bookType: uzanti === "xlsx" ? "xlsx" : "biff8", type: "array" });
    return new Uint8Array(out);
  }

  // Tüm grupları klasör/<tarih>/<GrupKodu>.xls olarak yazar; yazılan dosya sayısını döner.
  async function klasoreYaz(klasor, h, veri, tarih) {
    for (const g of veri.sira) await klasor.yaz(h, tarih ? [tarih] : [], dosyaAdi(g), grupExcel(veri, g));
    return veri.sira.length;
  }

  // Klasör erişimi olmayan tarayıcılar için: tüm grup dosyaları tek ZIP'te
  // (<tarih>/<GrupKodu>.xls); tek indirme, açınca aynı klasör düzeni çıkar.
  function zipUret(veri, tarih) {
    const C = xlsx().CFB;
    const z = C.utils.cfb_new();
    for (const g of veri.sira) C.utils.cfb_add(z, (tarih ? "/" + tarih : "") + "/" + dosyaAdi(g), grupExcel(veri, g));
    return new Uint8Array(C.write(z, { fileType: "zip", type: "array" }));
  }

  // Kullanıcının klasöründeki grup dosyası (Excel'de düzeltilmiş olabilir): önce
  // tarih alt klasörü, sonra kök. Yalnız o grubun yolcularını içeriyorsa kabul edilir.
  // Dosya yoksa null döner.
  async function klasordenGrup(klasor, h, alt, grup) {
    const adlar = [dosyaAdi(grup), dosyaAdi(grup, "xlsx")];
    const bul = (await klasor.oku(h, alt, adlar)) || (await klasor.oku(h, [], adlar));
    if (!bul) return null;
    let v;
    try { v = oku(bul.bayt, bul.ad); } catch (e) { throw new Error(`Klasördeki ${bul.ad} okunamadı: ${e.message}`); }
    if (v.sira.length !== 1 || v.sira[0] !== String(grup).toUpperCase()) {
      throw new Error(`Klasördeki ${bul.ad} başka grup kodu içeriyor (${v.sira.join(", ")}); dosya yüklenmedi.`);
    }
    return { ad: bul.ad, b64: base64(bul.bayt), yolcu: v.toplam };
  }

  function base64(bayt) {
    let s = "";
    for (let i = 0; i < bayt.length; i += 0x8000) s += String.fromCharCode.apply(null, bayt.subarray(i, i + 0x8000));
    return btoa(s);
  }

  // GTS sayfasında çalışır (chrome.scripting.executeScript func): kendi başına
  // yeterli olmalı, dış değişken kullanamaz. Dosyayı "Dosya Seç" alanına koyar,
  // istenirse aynı formdaki "Kaydet"e basar.
  function dosyaEkle(b64, ad, otoKaydet, grup, kodlar) {
    const input = document.querySelector("input[type='file'][name='file']")
      || document.querySelector("input[type='file']#file")
      || document.querySelector("input[type='file']");
    if (!input) return { tamam: false, mesaj: "Bu sayfada dosya seçme alanı yok." };

    // Sayfada harf içeren başka bir grup kodu yazıyorsa (örn. A15) yanlış gruba yüklemeyi engelle.
    const sozcukler = new Set(String(document.body ? document.body.innerText : "").toUpperCase().split(/[^A-Z0-9ÇĞİÖŞÜ]+/));
    const sayfadaki = (kodlar || []).filter((k) => /[A-Z]/.test(k) && sozcukler.has(k));
    if (sayfadaki.length === 1 && sayfadaki[0] !== grup) {
      return { tamam: false, mesaj: `Sayfa ${sayfadaki[0]} grubuna ait görünüyor, seçili uçuş ${grup}. Dosya eklenmedi.` };
    }

    const bin = atob(b64);
    const bayt = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bayt[i] = bin.charCodeAt(i);
    const tip = /\.xlsx$/i.test(ad)
      ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      : "application/vnd.ms-excel";
    const dt = new DataTransfer();
    dt.items.add(new File([bayt], ad, { type: tip, lastModified: Date.now() }));
    input.files = dt.files;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    if (!input.files || !input.files.length) return { tamam: false, mesaj: "Dosya alana eklenemedi." };

    let kaydet = false;
    if (otoKaydet) {
      const form = input.form || input.closest("form");
      const dugme = form && (form.querySelector("input[type='submit'][value='Kaydet']")
        || form.querySelector("input[type='submit'], button[type='submit']"));
      if (dugme) {
        // Sayfa gönderilince betik sonucu kaybolmasın diye tıklama bir an sonra
        setTimeout(() => dugme.click(), 400);
        kaydet = true;
      }
    }
    return { tamam: true, dosya: ad, boyut: bayt.length, kaydet };
  }

  return { oku, grupOzeti, grupExcel, tarihi, dosyaAdi, klasoreYaz, zipUret, klasordenGrup, base64, dosyaEkle, hucreMetni, katla };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = YOLCU;
}
