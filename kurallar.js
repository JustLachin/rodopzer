// KURALLAR — çevrimdışı motor (POC).
// Saf JS: hem popup (script tag) hem service worker (importScripts) kullanir.
// KURAL-v1 = TAHMIN ile dolduruldu. Gercek sunucu kurallari / ornek PDF ile
// kalibre edilince bu dosyanin ilgili fonksiyonlari degistirilecek; geri
// kalan tesisat (pdfYukle/doldur/basla/inject) ayni kalir.
const KURAL = (() => {
  const IMZA = { asama1: "#seferHareketSaati", asama2: "#tckn", asama3: "#grupAdi" };

  // TAKİP LİSTESİ iki kolonludur: sol = ARRIVAL, sağ = DEPARTURE.
  // Ölçülen sınır (B KAPAK 18.09.pdf): sol tablo x<410, sağ tablo x>=410.
  // Y-satırı bu sınırdan bölünür; kolonlar birbirine karışmaz.
  const KOLON_X = 410;

  // Saf fonksiyon (node ile test edilebilir): pdf.js öğelerinden {t, k} satırları.
  // k: 0 = sol kolon (ARRIVAL), 1 = sağ kolon (DEPARTURE). Kolon bilgisi
  // birleştirme ve uçuş eşleşmede kullanılır; kolonlar asla karışmaz.
  function satirlariBirlestir(items) {
    const satirlar = [];
    const sirali = (items || []).filter((it) => (it.str || "").trim()).slice();
    sirali.sort((a, b) => (b.transform[5] - a.transform[5]) || (a.transform[4] - b.transform[4]));
    let curY = null, cur = [];
    const flush = () => {
      if (cur.length) {
        const sol = [], sag = [];
        for (const it of cur.slice().sort((a, b) => a.transform[4] - b.transform[4])) {
          (it.transform[4] < KOLON_X ? sol : sag).push(it.str);
        }
        const sSol = sol.join(" ").replace(/\s+/g, " ").trim();
        const sSag = sag.join(" ").replace(/\s+/g, " ").trim();
        if (sSol) satirlar.push({ t: sSol, k: 0, y: curY });
        if (sSag) satirlar.push({ t: sSag, k: 1, y: curY });
      }
      cur = [];
    };
    for (const it of sirali) {
      const y = Math.round(it.transform[5]);
      if (curY === null || Math.abs(y - curY) <= 3) { cur.push(it); if (curY === null) curY = y; }
      else { flush(); cur.push(it); curY = y; }
    }
    flush();
    return satirlar;
  }

  // Otel sütunu taşmaları: uzun otel adı alttaki satıra kayar
  // ("KEMPINSKI HOTEL THE" + "DOME/BELEK", "AKRA ANTALYA (on request)" +
  // "/ANTALYA CENTER"). Bölge çoğu zaman bu taşan parçadadır; parça uçuş
  // satırının otel hücresine geri eklenir, yoksa not sanılıp kaybolur.
  const UCUS_HUCRE_RE = /[A-Z0-9]{2}\s*\d{2,4}[A-Z]*\s*\/\s*[A-Z]{3}\s*-\s*[A-Z]{3}/;
  const SAAT_HUCRE_RE = /^\d{1,2}[:.]\d{2}$/;
  const TUR_HUCRE_RE = /^(IND|Mai|Prime|LOCAL)$/;
  const kolonu = (it) => (it.transform[4] < KOLON_X ? 0 : 1);

  // Başlıktaki "Otel" ve "Türü" hücreleri otel sütununun x aralığını verir.
  // Başlık yalnız ilk sayfada olduğundan sonuç sayfalar arasında taşınır.
  function otelSutunlari(items, onceki) {
    const out = { ...(onceki || {}) };
    for (const b of items.filter((it) => /^Otel$/i.test(String(it.str).trim()))) {
      const x = b.transform[4], y = b.transform[5];
      const tur = items
        .filter((it) => /^T[üu]r[üu]$/i.test(String(it.str).trim())
          && Math.abs(it.transform[5] - y) <= 3 && it.transform[4] > x)
        .sort((a, c) => a.transform[4] - c.transform[4])[0];
      if (tur) out[kolonu(b)] = { x0: x - 2, x1: tur.transform[4] - 1 };
    }
    return out;
  }

  function otelTasmaBirlestir(items, sutun) {
    if (!sutun || (!sutun[0] && !sutun[1])) return items;
    const liste = items.filter((it) => String(it.str || "").trim()).map((it) => ({ ...it }));
    const otelde = (it) => {
      const s = sutun[kolonu(it)];
      return !!s && it.transform[4] >= s.x0 && it.transform[4] < s.x1;
    };
    const saatliSatir = (k, y) => liste.some((s) => kolonu(s) === k
      && SAAT_HUCRE_RE.test(String(s.str).trim()) && Math.abs(s.transform[5] - y) <= 3);
    const sil = new Set(), islenen = new Set();
    for (const u of liste) {
      // Uçuş hücresi olan satırlar ve uçuşsuz yerel (LOCAL) satırlar: ikisinde de "Türü" hücresi vardır
      if (!UCUS_HUCRE_RE.test(u.str) && !TUR_HUCRE_RE.test(String(u.str).trim())) continue;
      const k = kolonu(u), uy = u.transform[5];
      const satirAnahtari = k + ":" + Math.round(uy / 3);
      if (islenen.has(satirAnahtari)) continue;
      islenen.add(satirAnahtari);
      const otel = liste.find((it) => kolonu(it) === k && otelde(it) && Math.abs(it.transform[5] - uy) <= 3);
      if (!otel) continue;
      const devam = liste.find((it) => it !== otel && !sil.has(it) && kolonu(it) === k && otelde(it)
        && uy - it.transform[5] >= 4 && uy - it.transform[5] <= 14
        && !saatliSatir(k, it.transform[5]));
      if (!devam) continue;
      const ek = String(devam.str).trim();
      otel.str = String(otel.str).trimEnd() + (ek.startsWith("/") ? "" : " ") + ek;
      sil.add(devam);
    }
    return liste.filter((it) => !sil.has(it));
  }

  // PDF -> ham metin satirlari (pdf.js, tamamiyla yerelde calisir).
  async function pdfMetin(buf) {
    if (typeof pdfjsLib === "undefined") throw new Error("pdf.js yuklenemedi (vendors/pdf.min.js).");
    try {
      if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
        const url = (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.getURL)
          ? chrome.runtime.getURL("vendors/pdf.worker.min.js")
          : "./vendors/pdf.worker.js";
        pdfjsLib.GlobalWorkerOptions.workerSrc = url;
      }
    } catch (e) { /* worker zaten ayarlıysa */ }
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
    const satirlar = [];
    let sutun = null;
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const tc = await page.getTextContent();
      const items = tc.items || [];
      sutun = otelSutunlari(items, sutun);
      for (const s of satirlariBirlestir(otelTasmaBirlestir(items, sutun))) satirlar.push(s);
      satirlar.push(""); // sayfa ayraci
    }
    return satirlar;
  }

  // VERİ NOTU: araç listesi + bölge/havalimanı eşlemeleri kodda DEĞİL;
  // şoför JSON'undaki "refs" bölümünden gelir (dx_refs). Motor generic'tir.
  const normPlaka = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9ÇĞİÖŞÜİ]/g, "");
  const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();

  // KURAL-v2: "TRANSFER TAKİP LİSTESİ" ayrıştırıcı (B KAPAK 18.09.pdf ile kalibre).
  // Satır türleri: uçuş ("ABS B2 8105/MSQ-AYT/T2 08:00 ... IND 2 00:00 +"),
  // transfer ("A16 KEMER KMR 07:30 TERMINAL 2 2"), araç ("M1 SPRINTE(07 ALM 580)").
  // Her transfer birimi en yakın uçuş satırıyla eşleşir (güzergâh yönü yon verir).
  const BASLIK_RE = /TRANSFER TAKİP|ARRIVAL DEPARTURE|Operatör Uçuş|Uçuş Saat Otel|^OPERASY(ON)?$|^ON$|Raporlayan|^Sayfa \d+|Toplam Pax|^\d{2}\.\d{2}\.\d{4}( \d{1,2}:\d{2})?$/;

  function ucusParse(s) {
    if (!s.includes("/")) return null;
    const m = s.match(/([A-Z0-9]{2})\s+(\d{2,4}[A-Z]*)\s*\/\s*([A-Z]{3})\s*-\s*([A-Z]{3})/);
    if (!m) return null;
    const operator = norm(s.slice(0, s.indexOf(m[0])));
    let rest = norm(s.slice(s.indexOf(m[0]) + m[0].length));
    let terminal = "";
    const tm = rest.match(/^\/?\s*(T\d+|IC HAT|DIŞ HAT|DIS HAT|DIS|DIŞ)\b/);
    if (tm) { terminal = tm[1]; rest = norm(rest.slice(tm[0].length)); }
    const sm = rest.match(/^(\d{1,2}[:.]\d{2})\b/);
    if (!sm) return null; // saat yoksa uçuş satırı değildir
    const saat = sm[1].replace(".", ":");
    rest = norm(rest.slice(sm[0].length));
    let otel = rest, tur = "", pax = "", alinis = "", not = "";
    const tm2 = rest.match(/\b(IND|Mai|Prime|LOCAL)\b/);
    if (tm2) {
      tur = tm2[1];
      otel = norm(rest.slice(0, tm2.index));
      const kuyruk = norm(rest.slice(tm2.index + tm2[0].length));
      const pm = kuyruk.match(/^(\d+)\s+(\d{1,2}[:.]\d{2})\b/);
      if (pm) {
        pax = pm[1]; alinis = pm[2].replace(".", ":");
        not = norm(kuyruk.slice(pm[0].length)).replace(/^\+\s*/, "");
      } else { not = kuyruk; }
    } else {
      // tür yazılmamış satırlar: sondaki "PAX SAAT +not" kuyruğunu ayıkla
      const pm = rest.match(/^(.*?)\s+(\d+)\s+(\d{1,2}[:.]\d{2})\s*(\+.*)?$/);
      if (pm) { otel = norm(pm[1]); pax = pm[2]; alinis = pm[3].replace(".", ":"); not = norm((pm[4] || "").replace(/^\+\s*/, "")); }
    }
    return { operator, ucus: m[1] + " " + m[2], guzergah: m[3] + "-" + m[4],
      terminal, ucusSaat: saat, otel, tur, pax, alinis, not };
  }

  // Uçuşsuz yerel transfer (otelden otele): "COMP 00:00 MAXX ROYAL KEMER=>NIRVANA
  // DOLCE VITA/TEKIROVA LOCAL 2 17:00 +ARA TRF". Uçuş satırı gibi bir transfer
  // birimiyle eşleşir ama havalimanı yoktur; "=>" alış ve bırakış otellerini ayırır.
  function yerelParse(s) {
    if (ucusParse(s)) return null;
    const m = s.match(/^(.*?)\s*(\d{1,2}[:.]\d{2})\s+(.+?)\s+(LOCAL|IND|Mai|Prime)\s+(\d+)\s+(\d{1,2}[:.]\d{2})\s*(.*)$/);
    if (!m || !(m[4] === "LOCAL" || m[3].includes("=>"))) return null;
    const otel = norm(m[3]);
    const [otelBas, otelBit] = otel.includes("=>") ? otel.split("=>").map(norm) : [otel, ""];
    return { operator: norm(m[1]), ucus: "", guzergah: "", terminal: "", ucusSaat: m[2].replace(".", ":"),
      otel, otelBas, otelBit, tur: m[4], pax: m[5], alinis: m[6].replace(".", ":"),
      not: norm(m[7]).replace(/^\+\s*/, ""), yerel: true };
  }

  function transferParse(s) {
    if (s.includes("/")) return null;
    let m = s.match(/^([A-Z]*\d[\d.]*)\s+([A-ZÇĞİÖŞÜİ]{2,})\s+([A-Z]{2,4})\s+(\d{1,2}[:.]\d{2})\s+(.+?)\s+(\d+)$/);
    if (m) {
      return { gno: m[1], bolge: m[2], bolgeKisa: m[3],
        teslimSaat: m[4].replace(".", ":"), teslimNokta: norm(m[5]), kisi: m[6] };
    }
    // noktasız transfer ("B16 EGE EGE 17:20 5"): EGE havalimanı alımları böyle gelir
    m = s.match(/^([A-Z]*\d[\d.]*)\s+([A-ZÇĞİÖŞÜİ]{2,})\s+([A-Z]{2,4})\s+(\d{1,2}[:.]\d{2})\s+(\d+)$/);
    if (m) {
      return { gno: m[1], bolge: m[2], bolgeKisa: m[3],
        teslimSaat: m[4].replace(".", ":"), teslimNokta: "", kisi: m[5] };
    }
    return null;
  }
  // Saatsiz transfer başı ("B11 EGE EGE"): saat+pax kuyruğu ayrı satırdadır
  function transferKel(s) {
    if (s.includes("/")) return null;
    const m = s.match(/^([A-Z]*\d[\d.]*)\s+([A-ZÇĞİÖŞÜİ]{2,})\s+([A-Z]{2,4})\s*$/);
    return m ? { gno: m[1], bolge: m[2], bolgeKisa: m[3] } : null;
  }

  function transferBasi(s) {
    if (s.includes("/")) return null;
    const m = s.match(/^([A-Z]*\d[\d.]*)\s+([A-ZÇĞİÖŞÜİ]{2,})\s+([A-Z]{2,4})\s+(\d{1,2}[:.]\d{2})\s*(.*)$/);
    if (!m || transferParse(s)) return null; // tam satır değil, başı kesik
    return true;
  }

  // Uçuş-başı mı? (araç/transfer/not satırları bir sonraki uçuşa YAPIŞTIRILMAZ —
  // yoksa uçuş satırı yutulur ve eşleşmeler kayar.)
  function ucusBasi(s) {
    return s.includes("/") && !/^M\d+\s/i.test(s) && !aracParse(s)
      && !transferParse(s) && !transferBasi(s) && /[A-Z0-9]{2}\s+\d/.test(s);
  }

  function aracParse(s) {
    const m = s.match(/(?:^|.*\s)(M\d+)\s+([A-ZÇĞİÖŞÜİ0-9\s\-+/]+?)\s*\(?\s*(\d{2})\s*([A-ZÇĞİÖŞÜİ]{1,3})\s*(\d{2,4})\s*\)?\s*$/i);
    if (!m) return null;
    return { aracKodu: m[1].toUpperCase(), aracTipi: m[2].trim().replace(/İ/g, "I").toUpperCase(),
      plaka: m[3] + " " + m[4] + " " + m[5] };
  }

  // Transfer no önekinden yön tahmini: A/B+rakam = arrival, BD/düz rakam = departure.
  // (A16/B10 arrival; 10/BD12 departure — B KAPAK formatı.)
  function birimYonu(gno) {
    const g = String(gno || "").trim().toUpperCase();
    if (/^BD/.test(g) || /^\d/.test(g)) return "departure";
    if (/^[AB]\d/.test(g)) return "arrival";
    return "";
  }
  function ucusYonu(guz) {
    if (/-(AYT|BJV|DLM)\b/.test(guz || "")) return "arrival";
    if (/^(AYT|BJV|DLM)-/.test(guz || "")) return "departure";
    return "";
  }

  // Plaka/arac parçası tanıma (gevşek başlar dahil: "M3 VITO(07 BBG").
  // Tam çözümlenmiş satırlar baş olamaz (aracParse guard).
  function kafaPlaka(s) {
    if (aracParse(s) || transferParse(s)) return false;
    return /\(\s*\d{0,2}$/.test(s)
      || /(?:^|.*\s)M\d+\s+[A-ZÇĞİÖŞÜİ0-9\s\-+/]+\s*\(?(\s*\d{0,2}(\s+[A-ZÇĞİÖŞÜİ]{1,3})?)?$/i.test(s)
      || /(^|\s)(DIS|DİS)$/.test(s);
  }
  function kuyrukPlaka(nx) {
    if (transferParse(nx) || ucusParse(nx)) return false;
    return /^[A-ZÇĞİÖŞÜİ]{1,3}\s*\d{2,4}\)?$/.test(nx)
      || /^\d{2,4}\s*\)$/.test(nx)
      || /(?:HAVALIMANI\s+)?\(?\s*\d{0,2}\s*[A-ZÇĞİÖŞÜİ]{1,3}(\s*\d{2,4}\s*\)?)?$/i.test(nx)
      || /^HAT\s*$/.test(nx);
  }
  // (örn. "HAVALIMANI BYP 846)" = transfer kuyruğu + plaka kuyruğu,
  // "BODRUM MILAS M7 SPRINTE(07" = transfer parçası + araç başı).
  // Çözümlenemeyen satırı iki ayrı satıra ayırır.
  function hatBol(s) {
    // Önce kurtarma: kuyruk tam transfer/uçuş ise böl (ön taraf bozuk bile olsa
    // kuyruk kurtulur; ön taraf aşağı akışta onarılır/not olur).
    // ("B10 ... 2 BD12 ... HOTEL 2" -> iki kayıt; "KARSILAMA: A22 ..." -> transfer kurtulur.)
    let g = s.match(/^(.*\S)\s+(([A-Z]*\d[\d.]*)\s+[A-ZÇĞİÖŞÜİ]{2,}\s+[A-Z]{2,4}\s+\d{1,2}[:.]\d{2}.*)$/);
    if (g && transferParse(norm(g[2]))) {
      const on = norm(g[1]);
      if (!aracParse(on)) return [on, norm(g[2])].filter(Boolean);
    }
    g = s.match(/^(.*\S)\s+(([A-Z0-9]{2})\s+(\d{2,4}[A-Z]*)\s*\/\s*([A-Z]{3})\s*-\s*([A-Z]{3}).*)$/);
    if (g && ucusParse(norm(g[2]))) return [norm(g[1]), norm(g[2])].filter(Boolean);
    if (ucusParse(s) || transferParse(s) || aracParse(s)) return [s];
    g = s.match(/^(.*\S)\s+(([A-Z0-9]{2})\s+(\d{2,4}[A-Z]*)\s*\/\s*([A-Z]{3})\s*-\s*([A-Z]{3}).*)$/);
    if (g && ucusParse(norm(g[2]))) return [norm(g[1]), norm(g[2])].filter(Boolean);
    let m = s.match(/^(.*\S)\s+(M\d+\s+[A-ZÇĞİÖŞÜİ]+\s*\(?(\s*\d{0,2}(\s+[A-ZÇĞİÖŞÜİ]{1,3})?)?)$/);
    if (m) return [norm(m[1]), norm(m[2])].filter(Boolean);
    // Sayı-benzeri başlangıçlı satırlar (transfer/not) bölünmez;
    // saf parça ("ALM 580)") ve tam satırlar korunur.
    if (!/^\d{1,4}\s+[A-ZÇĞİÖŞÜİ]{2,}/.test(s)) {
      m = s.match(/^(.*\S)\s+([A-ZÇĞİÖŞÜİ]{1,3}\s*\d{2,4}\s*\)?)$/);
      if (m) {
        const kuyruk = norm(m[2]);
        if (/^[A-ZÇĞİÖŞÜİ]{1,3}\s*\d{2,4}\s*\)?$/.test(kuyruk)) {
          return [norm(m[1]), kuyruk].filter(Boolean);
        }
      }
      // çıplak sayılı kuyruk ("HAVALIMANI 315)" -> ["HAVALIMANI", "315)"]):
      // X en az 4 harfli ve kuyruk parantezli olmalı ("ALM 580)" bölünmez,
      // "BELEK LOJMAN 12" gibi parantezsiz transfer parçası bölünmez).
      m = s.match(/^(\S{4,}(?:\s+\S+)*)\s+(\d{2,4}\s*\)$)/);
      if (m) return [norm(m[1]), norm(m[2])].filter(Boolean);
    }
    return [s];
  }

  function kayitAyikla(satirlar, yon) {
    // Girdi: string dizisi (kolonsuz, k=-1) veya {t, k} dizisi (0=sol/arrival, 1=sağ/departure).
    // 1) başlık/boş ele, hibrit satırları böl, bölünmüş satırları birleştir
    const ham = [];
    const bolerekEkle = (str, kk, yy, derinlik) => {
      for (const parca of hatBol(norm(str))) {
        const s = norm(parca);
        if (!s || s.length < 3 || BASLIK_RE.test(s)) continue;
        if (derinlik < 2 && s !== norm(str)) bolerekEkle(s, kk, yy, derinlik + 1);
        else ham.push({ s, k: kk, y: yy });
      }
    };
    (satirlar || []).forEach((h) => {
      const o = (h && typeof h === "object") ? h : { t: h, k: -1 };
      const kk = (o.k === 0 || o.k === 1) ? o.k : -1;
      bolerekEkle(o.t, kk, (o.y == null ? null : o.y), 0);
    });
    // 1b) kolonlar-arası parça onarımı: plaka kuyruğu ("ALM 580)"), DIS/HAT
    // kuyruğu veya kesik transfer kuyruğu farklı kolonda olabilir (örn. "BCC 367)"
    // sağda). En yakın başıyla birleştir, kuyruğu yut. İçerik kapıları korur.
    for (let i = 0; i < ham.length; i++) {
      if (ham[i].yut) continue;
      const s = ham[i].s, hy = ham[i].y;
      const kelBas = transferKel(s);
      const trBas = !transferParse(s) && (transferBasi(s) || kelBas);
      if (!kafaPlaka(s) && !trBas) continue;
      for (let m = i + 1; m < Math.min(i + 5, ham.length); m++) {
        if (ham[m].yut) continue;
        // Y bandı dışına taşma (farklı kayıt): akıllı eşleşme 1c'ye bırakılır
        if (hy != null && ham[m].y != null && Math.abs(ham[m].y - hy) > 12) break;
        const nx = ham[m].s;
        // Plaka birleştirme Y varken 1c'ye bırakılır (pencere kuyruk çalıyordu);
        // Y yoksa (test/kolonsuz) eski davranış.
        if (hy == null && kafaPlaka(s) && kuyrukPlaka(nx)) {
          ham[i].s += " " + nx; ham[m].yut = true; break;
        }
        if (trBas && transferParse(s + " " + nx)) {
          ham[i].s += " " + nx; ham[m].yut = true; break;
        }
      }
    }
    // 1c) yetim kuyruk kurtarma: birleşememiş plaka başını en yakın kuyrukla
    // birleştir. Skor Y-mesafesidir (aynı satır bandı ≤12pt); Y yoksa satır
    // farkı (≤4). Belirsizlikte önceki satır kazanır; kuyruk tek kullanımlık.
    const baslar = [];
    ham.forEach((o, i) => {
      if (!o.yut && kafaPlaka(o.s)) baslar.push(i);
    });
    // Baş-kuyruk tür uyumu: DIS başı yalnızca yalın HAT kuyruğu alır
    // ("HAT DIDIM/DIDIM" nottur); plaka başı yalnızca plaka kuyruğu alır.
    const basTuru = (s) => (/(^|\s)(DIS|DİS)$/.test(s) ? "DIS" : "PLAKA");
    const kuyrukTuru = (nx) => {
      if (/^HAT\s*$/.test(nx)) return "HAT";
      if (transferParse(nx) || ucusParse(nx)) return null;
      if (/^[A-ZÇĞİÖŞÜİ]{1,3}\s*\d{2,4}\)?$/.test(nx) || /^\d{2,4}\s*\)$/.test(nx)
        || /^\(?\s*\d{2}\s*[A-ZÇĞİÖŞÜİ]{1,3}(\s*\d{2,4}\s*\)?)?$/.test(nx)) return "PLAKA";
      return null;
    };
    const kuyrukAlindi = new Set();
    for (const bi of baslar) {
      const hy = ham[bi].y;
      const tur = basTuru(ham[bi].s);
      let en = -1, enSkor = 1e9;
      for (let m = bi + 1; m < ham.length; m++) {
        if (ham[m].yut || kuyrukAlindi.has(m)) continue;
        if (kuyrukTuru(ham[m].s) !== (tur === "DIS" ? "HAT" : "PLAKA")) continue;
        const my = ham[m].y;
        const skor = (hy != null && my != null) ? Math.abs(my - hy) : (m - bi);
        const limit = (hy != null && my != null) ? 12 : 4;
        if (skor > limit) {
          if (my != null && hy != null && my < hy) break;
          continue;
        }
        if (skor < enSkor) { en = m; enSkor = skor; }
      }
      if (en >= 0) {
        ham[bi].s += " " + ham[en].s;
        ham[en].yut = true; kuyrukAlindi.add(en);
      }
    }
    const B = [];
    for (let i = 0; i < ham.length; i++) {
      if (ham[i].yut) continue;
      let s = ham[i].s; const kk = ham[i].k, hy = ham[i].y;
      const ayniKol = (m) => kk < 0 || ham[m].k < 0 || ham[m].k === kk;
      // sonraki aynı-kolon, yutulmamış satırlar (en fazla adet)
      const sonraki = (basla, adet) => {
        const out = [];
        for (let m = basla; m < ham.length && out.length < adet; m++) {
          if (ham[m].yut || !ayniKol(m)) continue;
          out.push(m);
        }
        return out;
      };
      let j = i + 1, oynandi = true;
      while (oynandi) {
        oynandi = false;
        const nxM = sonraki(j, 1);
        if (!nxM.length) break;
        const m = nxM[0], nx = ham[m].s;
        const uzak = hy != null && ham[m].y != null && Math.abs(ham[m].y - hy) > 12;
        // Plaka birleştirme Y varken 1c'ye bırakılır (artakalanlar sahipsiz kalır).
        if (hy == null && !uzak && kafaPlaka(s) && kuyrukPlaka(nx)) {
          s += " " + nx; ham[m].yut = true; j = m + 1; oynandi = true; continue;
        }
        if (!transferParse(s) && transferBasi(s)) {
          // birikimli dene: kuyruk parçalı olabilir; tamamlayan kuyruk yutulur,
          // aradaki satırlar (örn. araç parçası) sağ kalır.
          let dene = s, kuyruk = -1;
          for (const k of sonraki(j, 4)) {
            if (hy != null && ham[k].y != null && Math.abs(ham[k].y - hy) > 12) break;
            dene += " " + ham[k].s;
            if (transferParse(dene)) { kuyruk = k; break; }
          }
          if (kuyruk >= 0) {
            s = dene; ham[kuyruk].yut = true; j = kuyruk + 1; oynandi = true; continue;
          }
        }
        // uçuş parçası tamamlama: SADECE uçuş-başı satırlar, ileriye bakarak (en fazla 3).
        // (koşulsuz tek-satır birleştirme, sonraki uçuşu yutuyordu.)
        const f0 = ucusParse(s);
        if ((!f0 || (!f0.tur && !f0.pax)) && ucusBasi(s)) {
          let dene = s, bul = -1;
          for (const k of sonraki(j, 3)) {
            if (hy != null && ham[k].y != null && Math.abs(ham[k].y - hy) > 12) break;
            const oku = ham[k].s;
            // transfer/araç/tam uçuş satırına taşma: dur
            if (transferParse(oku) || aracParse(oku)) break;
            const of = ucusParse(oku);
            if (of && (of.tur || of.pax)) break;
            dene += " " + oku;
            const f = ucusParse(dene);
            if (f && (f.tur || f.pax)) { bul = k; break; }
          }
          if (bul >= 0) {
            for (let k = j; k <= bul; k++) {
              if (!ham[k].yut && ayniKol(k)) ham[k].yut = true;
            }
            s = dene; j = bul + 1; oynandi = true; continue;
          }
        }
      }
      B.push({ s, k: kk });
    }
    // 2) sınıflandır (kolon etiketi korunur)
    const ucuslar = [], birimler = [], notlar = [], araclar = [];
    B.forEach((o, i) => {
      const s = o.s;
      const f = ucusParse(s) || yerelParse(s);
      if (f) { f.i = i; f.k = o.k; ucuslar.push(f); return; }
      const v = aracParse(s);
      if (v) { v.i = i; v.k = o.k; araclar.push(v); return; }
      const t = transferParse(s);
      if (t) { t.i = i; t.k = o.k; birimler.push(t); return; }
      notlar.push({ i, s, k: o.k });
    });
    // Sütun bilgisi varsa eşleşmeler yalnız aynı sütunda yapılır:
    // sol = ARRIVAL, sağ = DEPARTURE; sütunlar birbirinin uçuşunu/aracını almaz.
    const ayniSutun = (a, b) => a.k == null || b.k == null || a.k < 0 || b.k < 0 || a.k === b.k;
    // 2b) araçları en yakın araçsız birime ata (araç satırı birimin
    // üstünde de altında da olabilir; beraberlikte önceki tercih; üst sınır 15).
    for (const v of araclar) {
      let en = null, enSkor = 1e9;
      for (const u of birimler) {
        if (u.aracKodu || !ayniSutun(u, v)) continue;
        const d = Math.abs(u.i - v.i);
        if (d < enSkor || (d === enSkor && en && u.i < en.i)) { en = u; enSkor = d; }
      }
      if (en && enSkor <= 40) {
        Object.assign(en, { aracKodu: v.aracKodu, aracTipi: v.aracTipi, plaka: v.plaka });
      }
    }
    // 3) eşleştirme: ÖNCE yönü uyumlu uçuşlar arasından seçilir
    // (birim öneki: A/B=arrival, BD/rakam=departure). Adaylar arasında kural:
    // önceki uçuş; birim saati sonrakine açıkça daha yakınsa (+30 dk) sonraki.
    const dkFark = (a, b) => {
      const p = (x) => { const m = String(x || "").match(/(\d{1,2}):(\d{2})/); return m ? (+m[1]) * 60 + (+m[2]) : null; };
      const x = p(a), y = p(b);
      return (x === null || y === null) ? null : Math.abs(x - y);
    };
    const recs = birimler.map((u) => {
      // Ön ek yön vermiyorsa ("ARA1" gibi) sütundan al
      const uYon = birimYonu(u.gno) || (u.k === 0 ? "arrival" : u.k === 1 ? "departure" : "");
      const uygun = (f) => {
        if (!ayniSutun(f, u)) return false;
        const fy = ucusYonu(f.guzergah);
        return !uYon || !fy || uYon === fy;
      };
      let once = null, sonra = null;
      for (const f of ucuslar) {
        if (!uygun(f)) continue;
        if (f.i < u.i) once = f;
        if (f.i > u.i && !sonra) sonra = f;
      }
      let en = once || sonra;
      if (!en) { // uyumlu uçuş yoksa aynı sütundaki en yakını al
        let enF = 1e9;
        for (const f of ucuslar) {
          if (!ayniSutun(f, u)) continue;
          const d = Math.abs(f.i - u.i);
          if (d < enF) { en = f; enF = d; }
        }
      }
      if (once && sonra) {
        // Departure biriminin saati otelden alınış saatine, arrival biriminin
        // saati uçuş saatine yakındır (uçuş saatiyle kıyaslamak departure'da
        // birimi sonraki uçuşa kaydırıyordu: "16 BELEK" -> BJV uçuşu).
        const ref = (f) => ((uYon === "departure" && f.alinis && f.alinis !== "00:00") ? f.alinis : f.ucusSaat);
        const dO = dkFark(u.teslimSaat, ref(once));
        const dS = dkFark(u.teslimSaat, ref(sonra));
        if (dO !== null && dS !== null && dS + 30 < dO) en = sonra;
      }
      const k = { ...u, ...(en || {}) };
      const guz = k.guzergah || "";
      let recYon = "";
      if (/-(AYT|BJV|DLM)\b/.test(guz)) recYon = "arrival";
      else if (/^(AYT|BJV|DLM)-/.test(guz)) recYon = "departure";
      if (!recYon && u.k === 0) recYon = "arrival";
      else if (!recYon && u.k === 1) recYon = "departure";
      if (!recYon && /^[AB]\d/i.test(k.gno || "")) recYon = "arrival";
      else if (!recYon && (/^BD/i.test(k.gno || "") || /^\d/.test(k.gno || ""))) recYon = "departure";
      const isArr = recYon === "arrival" || (!recYon && (yon === "arrival" || /^[AB]\d/i.test(k.gno || "")));
      const uiSaatDeger = isArr
        ? (k.teslimSaat || k.ucusSaat || "")
        : ((k.alinis && k.alinis !== "00:00") ? k.alinis : (k.teslimSaat || k.ucusSaat || ""));
      const ob = otelBolgesi(k.otel);
      const r = {
        gno: k.gno || "", pist: k.ucus || "", uisaat: uiSaatDeger,
        otel: k.otel || "", otelbolge: ob || k.bolge || "",
        ucus: k.ucus || "", operator: k.operator || "", guzergah: guz, terminal: k.terminal || "",
        ucusSaat: k.ucusSaat || "", tur: k.tur || "", pax: k.pax || k.kisi || "", alinis: k.alinis || "",
        not: k.not || "", bolge: ob || k.bolge || "", bolgeKisa: k.bolgeKisa || "",
        trBolge: u.bolge || "",
        teslimSaat: k.teslimSaat || "",
        teslimNokta: k.teslimNokta
        || ((k.bolge === "EGE" && isArr) ? "MİLAS-BODRUM HAVALİMANI" : ""),
        aracKodu: k.aracKodu || "", aracTipi: k.aracTipi || "", plaka: k.plaka || "",
        yon: recYon || (isArr ? "arrival" : "departure")
      };
      if (k.yerel) Object.assign(r, { yerel: true, otelBas: k.otelBas || "", otelBit: k.otelBit || "" });
      r._ucusI = en ? en.i : -1;
      return r;
    });
    // 4) not satırlarını en yakın uçuşun kaydına ekle
    for (const n of notlar) {
      let en = null, enF = 1e9;
      for (const f of ucuslar) {
        if (!ayniSutun(f, n)) continue;
        const d = Math.abs(f.i - n.i);
        if (d < enF) { en = f; enF = d; }
      }
      if (!en) continue;
      for (const r of recs) {
        if (r._ucusI === en.i) r.not = (r.not ? r.not + " " : "") + n.s;
      }
    }
    for (const r of recs) delete r._ucusI;
    return recs.filter((r) => !yon || r.yon === yon);
  }

  async function pdfOku(buf, yon) {
    const satirlar = await pdfMetin(buf);
    const kayitlar = kayitAyikla(satirlar, yon);
    const metinler = satirlar.map((x) => (x && typeof x === "object" ? x.t : x));
    return { kayitlar, hamSatirSayisi: satirlar.length,
      ornek: metinler.filter((s) => s && s.trim()).slice(0, 14) };
  }

  // Varsayılan ülke/il/havalimanı tablosu. Bölge -> il/ilçe eşlemesi
  // aşağıdaki BOLGE_TABLOSU'ndadır; şoför JSON'undaki "refs" ikisini de ezebilir.
  const VARSAYILAN_REFS = {
    varsayilan: { ulke: "TR", personelTuru: "0", il: "7" },
    ilAdlari: {
      "7": "ANTALYA",
      "48": "MUĞLA",
      "9": "AYDIN",
      "35": "İZMİR",
      "34": "İSTANBUL"
    },
    hava: {
      AYT: {
        il: "7",
        ilce: ["ANTALYA HAVALİMANI", "ANTALYA HAVAALANI", "HAVALİMANI", "HAVAALANI", "MURATPAŞA", "AKSU", "MERKEZ", "ANTALYA"],
        ad: "ANTALYA HAVALİMANI"
      },
      BJV: {
        il: "48",
        ilce: [
          "MİLAS-BODRUM HAVALİMANI", "MİLAS BODRUM HAVALİMANI", "MİLAS-BODRUM HAVAALANI",
          "MİLAS BODRUM HAVAALANI", "MİLAS HAVALİMANI", "MİLAS HAVAALANI",
          "BODRUM-MİLAS HAVALİMANI", "BODRUM MİLAS HAVALİMANI", "BODRUM-MİLAS HAVAALANI",
          "BODRUM MİLAS HAVAALANI", "BODRUM HAVALİMANI", "BODRUM HAVAALANI",
          "HAVALİMANI", "HAVAALANI"
        ],
        ad: "MİLAS-BODRUM HAVALİMANI"
      },
      DLM: {
        il: "48",
        ilce: ["DALAMAN HAVALİMANI", "DALAMAN HAVAALANI", "DALAMAN", "HAVALİMANI", "HAVAALANI"],
        ad: "DALAMAN HAVALİMANI"
      }
    }
  };

  function birlestirRefs(userRefs) {
    const u = userRefs || {};
    return {
      varsayilan: { ...VARSAYILAN_REFS.varsayilan, ...(u.varsayilan || {}) },
      ilAdlari: { ...VARSAYILAN_REFS.ilAdlari, ...(u.ilAdlari || {}) },
      hava: { ...VARSAYILAN_REFS.hava, ...(u.hava || {}) },
      // Kullanıcı ezmeleri (bölge -> il kodu / ilçe adayları); varsayılanı BOLGE_TABLOSU
      bolgeIl: { ...(u.bolgeIl || {}) },
      bolgeIlce: { ...(u.bolgeIlce || {}) }
    };
  }

  // Türkçe harfleri katlayıp karşılaştırılabilir hale getirir:
  // "Kiriş", "KİRİŞ", "KIRIS" -> "KIRIS"; noktalama boşluğa döner.
  function katla(s) {
    return String(s || "")
      .replace(/[İIıi]/g, "I")
      .toUpperCase()
      .replace(/Ş/g, "S").replace(/Ğ/g, "G").replace(/Ü/g, "U")
      .replace(/Ö/g, "O").replace(/Ç/g, "C").replace(/Â/g, "A").replace(/Î/g, "I").replace(/Û/g, "U")
      .replace(/[^A-Z0-9]+/g, " ")
      .trim();
  }

  // Bölge (otel adındaki "/BÖLGE" eki veya transfer başlığı) -> il, ilçe, havalimanı.
  // [ad, il kodu, ilçe adayları (GTS listesindeki yazımla, öncelik sırasıyla),
  //  havalimanı, ek yazımlar, genel?]. "genel" bölgeler (il adı gibi) otel adı
  // içinde geçtiğinde daha özel bir bölgeye yenik düşer.
  const BOLGE_TABLOSU = [
    // ANTALYA — Kemer
    ["KEMER", "7", ["KEMER"], "AYT"],
    ["KİRİŞ", "7", ["KEMER"], "AYT"],
    ["ÇAMYUVA", "7", ["KEMER"], "AYT"],
    ["TEKİROVA", "7", ["KEMER"], "AYT"],
    ["GÖYNÜK", "7", ["KEMER"], "AYT"],
    ["BELDİBİ", "7", ["KEMER"], "AYT"],
    ["ARSLANBUCAK", "7", ["KEMER"], "AYT"],
    ["KUZDERE", "7", ["KEMER"], "AYT"],
    ["AĞVA", "7", ["KEMER"], "AYT"],
    ["ÇIRALI", "7", ["KEMER"], "AYT"],
    ["ULUPINAR", "7", ["KEMER"], "AYT"],
    ["PHASELIS", "7", ["KEMER"], "AYT"],
    // ANTALYA — merkez (kullanıcı kuralı: lara/konyaaltı -> MERKEZ)
    ["LARA", "7", ["MERKEZ", "MURATPAŞA"], "AYT"],
    ["KONYAALTI", "7", ["MERKEZ", "KONYAALTI"], "AYT", ["KONYALTI"]],
    ["MURATPAŞA", "7", ["MERKEZ", "MURATPAŞA"], "AYT"],
    ["KALEİÇİ", "7", ["MERKEZ", "MURATPAŞA"], "AYT"],
    ["KUNDU", "7", ["AKSU", "MERKEZ"], "AYT"],
    ["AKSU", "7", ["AKSU"], "AYT"],
    ["KEPEZ", "7", ["KEPEZ", "MERKEZ"], "AYT"],
    ["DÖŞEMEALTI", "7", ["DÖŞEMEALTI"], "AYT"],
    ["ANTALYA", "7", ["MERKEZ", "MURATPAŞA"], "AYT", ["ANTALYA CENTER", "ANTALYA MERKEZ", "ANTALYA CITY"], true],
    // ANTALYA — Serik
    ["BELEK", "7", ["SERİK"], "AYT"],
    ["KADRİYE", "7", ["SERİK"], "AYT"],
    ["BOĞAZKENT", "7", ["SERİK"], "AYT"],
    ["SERİK", "7", ["SERİK"], "AYT"],
    // ANTALYA — Manavgat
    ["SİDE", "7", ["MANAVGAT"], "AYT"],
    ["MANAVGAT", "7", ["MANAVGAT"], "AYT"],
    ["SORGUN", "7", ["MANAVGAT"], "AYT"],
    ["TİTREYENGÖL", "7", ["MANAVGAT"], "AYT"],
    ["KIZILAĞAÇ", "7", ["MANAVGAT"], "AYT"],
    ["KIZILOT", "7", ["MANAVGAT"], "AYT"],
    ["ÇOLAKLI", "7", ["MANAVGAT"], "AYT"],
    ["EVRENSEKİ", "7", ["MANAVGAT"], "AYT"],
    ["GÜNDOĞDU", "7", ["MANAVGAT"], "AYT"],
    ["KUMKÖY", "7", ["MANAVGAT"], "AYT"],
    ["DENİZYAKA", "7", ["MANAVGAT"], "AYT"],
    ["ÇENGER", "7", ["MANAVGAT"], "AYT"],
    // ANTALYA — Alanya ve batı ilçeleri
    ["ALANYA", "7", ["ALANYA"], "AYT"],
    ["OKURCALAR", "7", ["ALANYA"], "AYT"],
    ["AVSALLAR", "7", ["ALANYA"], "AYT"],
    ["İNCEKUM", "7", ["ALANYA"], "AYT"],
    ["TÜRKLER", "7", ["ALANYA"], "AYT"],
    ["KONAKLI", "7", ["ALANYA"], "AYT"],
    ["MAHMUTLAR", "7", ["ALANYA"], "AYT"],
    ["KARGICAK", "7", ["ALANYA"], "AYT"],
    ["KESTEL", "7", ["ALANYA"], "AYT"],
    ["OBA", "7", ["ALANYA"], "AYT"],
    ["PAYALLAR", "7", ["ALANYA"], "AYT"],
    ["ALARAHAN", "7", ["ALANYA"], "AYT"],
    ["TOSMUR", "7", ["ALANYA"], "AYT"],
    ["CİKCİLLİ", "7", ["ALANYA"], "AYT"],
    ["GAZİPAŞA", "7", ["GAZİPAŞA"], "AYT"],
    ["KAŞ", "7", ["KAŞ"], "AYT"],
    ["KALKAN", "7", ["KAŞ"], "AYT"],
    ["KUMLUCA", "7", ["KUMLUCA"], "AYT"],
    ["ADRASAN", "7", ["KUMLUCA"], "AYT"],
    ["OLİMPOS", "7", ["KUMLUCA"], "AYT", ["OLYMPOS"]],
    ["FİNİKE", "7", ["FİNİKE"], "AYT"],
    ["DEMRE", "7", ["DEMRE"], "AYT"],
    // MUĞLA — Bodrum / Milas
    ["BODRUM", "48", ["BODRUM"], "BJV"],
    ["TORBA", "48", ["BODRUM"], "BJV"],
    ["TÜRKBÜKÜ", "48", ["BODRUM"], "BJV", ["GÖLTÜRKBÜKÜ"]],
    ["GÜNDOĞAN", "48", ["BODRUM"], "BJV"],
    ["YALIKAVAK", "48", ["BODRUM"], "BJV"],
    ["GÜMÜŞLÜK", "48", ["BODRUM"], "BJV"],
    ["TURGUTREİS", "48", ["BODRUM"], "BJV"],
    ["BİTEZ", "48", ["BODRUM"], "BJV"],
    ["GÜMBET", "48", ["BODRUM"], "BJV"],
    ["ORTAKENT", "48", ["BODRUM"], "BJV"],
    ["YAHŞİ", "48", ["BODRUM"], "BJV"],
    ["AKYARLAR", "48", ["BODRUM"], "BJV"],
    ["KARAİNCİR", "48", ["BODRUM"], "BJV"],
    ["GÜVERCİNLİK", "48", ["BODRUM"], "BJV"],
    ["KONACIK", "48", ["BODRUM"], "BJV"],
    ["MİLAS", "48", ["MİLAS"], "BJV"],
    ["GÜLLÜK", "48", ["MİLAS"], "BJV"],
    ["ÖREN", "48", ["MİLAS"], "BJV"],
    // MUĞLA — Dalaman tarafı
    ["DALAMAN", "48", ["DALAMAN"], "DLM"],
    ["ORTACA", "48", ["ORTACA"], "DLM"],
    ["DALYAN", "48", ["ORTACA"], "DLM"],
    ["SARIGERME", "48", ["ORTACA"], "DLM"],
    ["KÖYCEĞİZ", "48", ["KÖYCEĞİZ"], "DLM"],
    ["FETHİYE", "48", ["FETHİYE"], "DLM"],
    ["ÖLÜDENİZ", "48", ["FETHİYE"], "DLM"],
    ["HİSARÖNÜ", "48", ["FETHİYE"], "DLM"],
    ["OVACIK", "48", ["FETHİYE"], "DLM"],
    ["ÇALIŞ", "48", ["FETHİYE"], "DLM"],
    ["GÖCEK", "48", ["FETHİYE"], "DLM"],
    ["KAYAKÖY", "48", ["FETHİYE"], "DLM"],
    ["MARMARİS", "48", ["MARMARİS"], "DLM"],
    ["İÇMELER", "48", ["MARMARİS"], "DLM"],
    ["TURUNÇ", "48", ["MARMARİS"], "DLM"],
    ["SELİMİYE", "48", ["MARMARİS"], "DLM"],
    ["BOZBURUN", "48", ["MARMARİS"], "DLM"],
    ["DATÇA", "48", ["DATÇA"], "DLM"],
    ["AKYAKA", "48", ["ULA"], "DLM"],
    // AYDIN
    ["DİDİM", "9", ["DİDİM"], "BJV"],
    ["ALTINKUM", "9", ["DİDİM"], "BJV"],
    ["AKBÜK", "9", ["DİDİM"], "BJV"],
    ["KUŞADASI", "9", ["KUŞADASI"], ""],
    ["SÖKE", "9", ["SÖKE"], ""],
    // İZMİR
    ["ÇEŞME", "35", ["ÇEŞME"], ""],
    ["ALAÇATI", "35", ["ÇEŞME"], ""],
    ["URLA", "35", ["URLA"], ""],
    ["SELÇUK", "35", ["SELÇUK"], ""],
    ["ÖZDERE", "35", ["MENDERES"], ""],
    ["GÜMÜLDÜR", "35", ["MENDERES"], ""],
    ["DİKİLİ", "35", ["DİKİLİ"], ""]
  ].map(([ad, il, ilce, hava, ek, genel]) => ({
    ad, il, ilce, hava, genel: !!genel, anahtar: katla(ad),
    esler: [...new Set([katla(ad), ...(ek || []).map(katla)])]
  }));

  const BOLGE_ANAHTAR = {};
  for (const b of BOLGE_TABLOSU) BOLGE_ANAHTAR[b.anahtar] = b;

  // İlçe adından il kodu (kullanıcı kuralı yalnız ilçe verdiğinde il'i bulmak için)
  const ILCE_IL = {};
  for (const b of BOLGE_TABLOSU) for (const i of b.ilce) if (!ILCE_IL[katla(i)]) ILCE_IL[katla(i)] = b.il;

  const kelimeVar = (metin, kelime) => !!kelime && (" " + metin + " ").includes(" " + kelime + " ");

  // Metinde geçen en iyi bölge: özel bölge genelden, uzun yazım kısadan önce gelir.
  function tablodaAra(metin) {
    let en = null, enPuan = -1;
    for (const b of BOLGE_TABLOSU) {
      for (const es of b.esler) {
        if (!kelimeVar(metin, es)) continue;
        const puan = (b.genel ? 0 : 1000) + es.length;
        if (puan > enPuan) { en = { b, es }; enPuan = puan; }
      }
    }
    return en;
  }

  // Ayarlar'daki kullanıcı kuralları ([{anahtar, ilce}]): metinde kelime olarak geçen ilk kural.
  function kuraldaAra(metin, kurallar) {
    let en = null;
    for (const r of kurallar) {
      if (kelimeVar(metin, r.a) && (!en || r.a.length > en.a.length)) en = r;
    }
    return en;
  }

  // Otel adının yanındaki bölgeyi ayıkla (örn: "NIRVANA COSMOPOLITAN/LARA" -> "LARA")
  function otelBolgesi(otelStr) {
    const s = String(otelStr || "").trim();
    if (s.includes("/")) {
      const parts = s.split("/");
      const son = parts[parts.length - 1].trim().toUpperCase();
      if (son.length >= 2 && !/^\d+$/.test(son)) return son;
    }
    return "";
  }

  // Bir kaydın bölgesini ve GTS il/ilçesini KAYDA HİÇBİR ŞEY YAZMADAN hesaplar.
  // Kaynak sırası: otel adındaki "/BÖLGE" eki -> otel adı -> transfer başlığı.
  // Her kaynakta önce Ayarlar'daki kural, sonra BOLGE_TABLOSU bakılır.
  // Hiçbiri tutmazsa Ayarlar'daki "bölge bulunamazsa" varsayılanı kullanılır;
  // o da yoksa ilçe boş kalır (kesin=false) ve arayüz uyarı gösterir.
  function bolgeCoz(k, { anahtarlar, sabit, refs, ilSecili } = {}) {
    k = k || {};
    const R = birlestirRefs(refs);
    const kurallar = (Array.isArray(anahtarlar) ? anahtarlar : [])
      .map((x) => ({ anahtar: String(x.anahtar || "").trim().toUpperCase(), ilce: String(x.ilce || "").trim().toUpperCase() }))
      .map((x) => ({ ...x, a: katla(x.anahtar) }))
      .filter((x) => x.a && x.ilce);

    const sonEk = otelBolgesi(k.otel);
    const trBolge = String(k.trBolge || k.bolge || "").trim().toUpperCase();
    const kaynaklar = [
      { ad: "otel bölgesi", ham: sonEk, metin: katla(sonEk) },
      { ad: "otel adı", ham: "", metin: katla(k.otel), adMi: true },
      { ad: "transfer bölgesi", ham: trBolge, metin: katla(trBolge) }
    ];

    let bulgu = null;
    let genelAday = null;
    for (const kk of kaynaklar) {
      if (!kk.metin) continue;
      const kural = kuraldaAra(kk.metin, kurallar);
      if (kural) { bulgu = { kural, b: BOLGE_ANAHTAR[kural.a] || (tablodaAra(kural.a) || {}).b, kaynak: kk }; break; }
      const t = tablodaAra(kk.metin);
      if (t && t.b.genel && kk.adMi) { genelAday = genelAday || { b: t.b, es: t.es, kaynak: kk }; continue; }
      if (t) { bulgu = { b: t.b, es: t.es, kaynak: kk }; break; }
    }
    // Otel adında yalnız il adı geçiyorsa ("AKRA ANTALYA"), transfer başlığından önce gelir.
    if (genelAday && (!bulgu || bulgu.kaynak.ad === "transfer bölgesi")) bulgu = genelAday;

    const sb = sabit || {};
    const sabitAnahtar = String(sb.sabitAnahtar || sb.anahtar || "").trim().toUpperCase();
    const sabitIlce = String(sb.sabitIlce || sb.ilce || "").trim().toUpperCase();

    let bolge = "", etiket = "", ilce = [], ilKod = "", hava = "", kaynak = "", kesin = true;
    if (bulgu) {
      const b = bulgu.b;
      bolge = bulgu.kural ? bulgu.kural.anahtar : b.ad;
      // Açıklamada PDF'teki yazım korunur ("KIRIS"); taşma/ek varsa tablo adı
      etiket = (bulgu.kaynak.ham && katla(bulgu.kaynak.ham) === (bulgu.kural ? bulgu.kural.a : bulgu.es))
        ? bulgu.kaynak.ham : bolge;
      const anahtar = bulgu.kural ? bulgu.kural.a : b.anahtar;
      const refIlce = R.bolgeIlce[bolge] || R.bolgeIlce[anahtar];
      if (bulgu.kural) {
        ilce = [bulgu.kural.ilce];
        kaynak = `Ayarlar kuralı: ${bulgu.kural.anahtar} → ${bulgu.kural.ilce}`;
      } else if (refIlce && [].concat(refIlce).length) {
        ilce = [].concat(refIlce).map((x) => String(x).toUpperCase());
        kaynak = `şoför JSON refs (${bulgu.kaynak.ad})`;
      } else {
        ilce = b.ilce.slice();
        kaynak = bulgu.kaynak.ad;
      }
      ilKod = R.bolgeIl[bolge] || R.bolgeIl[anahtar] || (b && b.il) || ILCE_IL[katla(ilce[0])] || "";
      hava = (b && b.hava) || "";
    } else if (sabitAnahtar || sabitIlce) {
      const t = tablodaAra(katla(sabitAnahtar));
      bolge = etiket = sabitAnahtar || sonEk || trBolge;
      ilce = sabitIlce ? [sabitIlce] : (t ? t.b.ilce.slice() : []);
      ilKod = (t && t.b.il) || ILCE_IL[katla(sabitIlce)] || "";
      hava = (t && t.b.hava) || "";
      kaynak = "Ayarlar varsayılanı (bölge tanınmadı)";
      kesin = false;
    } else {
      bolge = etiket = sonEk || trBolge || "";
      kaynak = "bölge tanınmadı";
      kesin = false;
    }

    if (ilSecili) {
      const kod = Object.keys(R.ilAdlari).find((x) => R.ilAdlari[x] === ilSecili);
      if (kod) ilKod = kod;
    }
    return { bolge, etiket, ilKod, ilAdi: ilKod ? (R.ilAdlari[ilKod] || "") : "", ilceAday: ilce, hava, kaynak, kesin };
  }

  // Güzergâhtaki yerel havalimanı kodu (arrival: varış, departure: kalkış)
  function havaKodu(guzergah, gelis) {
    const m = String(guzergah || "").match(gelis ? /-(AYT|BJV|DLM)\b/ : /^(AYT|BJV|DLM)-/);
    return (m && m[1]) || "";
  }

  // Havalimanı kodu: arrival'da güzergâhtaki son, departure'da ilk yerel havalimanı;
  // güzergâh yoksa bölgenin havalimanı, o da yoksa AYT.
  function havalimaniKodu(k, seciliYon) {
    const isArrival = (seciliYon === "arrival")
      || (k && k.yon === "arrival")
      || /^[AB]\d/i.test((k && k.gno) || "")
      || /-(AYT|BJV|DLM)\b/.test((k && k.guzergah) || "");

    const parcalar = String((k && k.guzergah) || "").split("-").map((p) => p.trim().toUpperCase()).filter(Boolean);
    const sirali = isArrival ? parcalar.slice().reverse() : parcalar;
    for (const p of sirali) {
      const m = p.match(/\b(AYT|BJV|DLM)\b/);
      if (m) return m[1];
    }
    const c = bolgeCoz(k);
    if (c.hava) return c.hava;
    if (katla((k && k.trBolge) || (k && k.bolge)) === "EGE") return "BJV";
    return "AYT";
  }

  function havalimaniBilgisi(k, refs, seciliYon) {
    const R = birlestirRefs(refs);
    const hk = havalimaniKodu(k, seciliYon);
    const hava = R.hava[hk] || R.hava.AYT;
    const ilKod = hava.il || "7";
    const ilAdi = R.ilAdlari[ilKod] || "ANTALYA";
    return { hk, hava, ilKod, ilAdi, ilceAday: hava.ilce || ["ANTALYA HAVALİMANI", "MERKEZ"] };
  }

  // GTS 3. aşama: otel tarafının il/ilçesi (2. aşama kuralları ile)
  function bolgeIlVeIlce(k, refs, ilSecili, sabit, anahtarlar, seciliYon) {
    const c = bolgeCoz(k, { anahtarlar, sabit, refs, ilSecili });
    if (c.ilKod) return c;
    // İl bulunamadıysa havalimanının ili (ilçe yine boş kalır)
    const h = havalimaniBilgisi(k, refs, seciliYon);
    return { ...c, ilKod: h.ilKod, ilAdi: h.ilAdi };
  }

  // Açıklamadaki bölge kısmı (1. aşama kuralları ile): kural varsa kuralın
  // karşılığı, yoksa PDF'teki bölge yazımı.
  function bolgeKisaKod(k, sabit, anahtarlar) {
    const c = bolgeCoz(k, { anahtarlar, sabit });
    if (c.kaynak.startsWith("Ayarlar kuralı")) return c.ilceAday[0];
    return c.etiket || "TRANSFER";
  }

  function hatKisaAciklama(k, sabit, anahtarlar, seciliYon) {
    const isArrival = (seciliYon === "arrival")
      || (k && k.yon === "arrival")
      || /^[AB]\d/i.test((k && k.gno) || "")
      || /-(AYT|BJV|DLM)\b/.test((k && k.guzergah) || "");
    const hk = havalimaniKodu(k, seciliYon) || "AYT";
    const bk = bolgeKisaKod(k, sabit, anahtarlar);
    return isArrival ? `${hk} - ${bk}` : `${bk} - ${hk}`;
  }

  // Uçuşsuz otelden otele transfer ("MAXX ROYAL KEMER=>NIRVANA DOLCE VITA/TEKIROVA")
  const yerelMi = (k) => !!(k && (k.yerel || (/=>/.test(k.otel || "") && !k.guzergah)));

  // Yerel transferin iki ucu; transfer başlığındaki bölge yalnız alış oteline aittir.
  function yerelUclar(k) {
    const [b, s] = (k.otelBas || k.otelBit)
      ? [k.otelBas, k.otelBit]
      : String(k.otel || "").split("=>").map((x) => x.replace(/\s+/g, " ").trim());
    return {
      bas: { ...k, otel: b || "", guzergah: "" },
      bit: { ...k, otel: s || "", guzergah: "", trBolge: "", bolge: "" }
    };
  }

  // Ortak güzergâh: sefer açıklaması = grup açıklaması ("APT - BLK" veya "KMR - APT").
  // Ara (yerel) transferde açıklama, PDF'teki otel yazısının aynısıdır
  // ("MAXX ROYAL KEMER=>NIRVANA DOLCE VITA/TEKIROVA").
  function guzergahHat(k, tarih, refs, sabit, anahtarlar, seciliYon) {
    if (yerelMi(k)) {
      const u = yerelUclar(k);
      const aciklama = String(k.otel || "").replace(/\s+/g, " ").trim()
        || [u.bas.otel, u.bit.otel].filter(Boolean).join("=>");
      const hat = [u.bas.otel, u.bit.otel].filter(Boolean).join(" - ");
      return { gelis: false, hava: null, bas: u.bas.otel, bit: u.bit.otel, hat, aciklama, kisaAciklama: aciklama };
    }
    const gelis = (seciliYon === "arrival")
      || (k && k.yon === "arrival")
      || /^[AB]\d/i.test((k && k.gno) || "")
      || /-(AYT|BJV|DLM)\b/.test((k && k.guzergah) || "");
    const hk = havaKodu(k && k.guzergah, gelis) || havalimaniKodu(k, seciliYon);
    const hava = havalimaniBilgisi(k, refs, seciliYon).hava;
    const bas = gelis ? ((k && k.teslimNokta) || (hava && hava.ad) || "HAVALİMANI") : ((k && k.otel) || (k && k.teslimNokta) || "");
    const bit = gelis ? ((k && k.otel) || "") : ((hava && hava.ad) || (k && k.teslimNokta) || "HAVALİMANI");
    const hat = bas && bit ? (bas + " - " + bit) : (bas || bit);
    const aciklama = hatKisaAciklama(k, sabit, anahtarlar, seciliYon);
    return { gelis, hava, bas, bit, hat, aciklama, kisaAciklama: aciklama };
  }

  function saatEkle(saatStr, saatMiktari = 3) {
    if (!saatStr || !saatStr.includes(":")) return saatStr || "";
    const [h, m] = saatStr.split(":").map(Number);
    if (isNaN(h) || isNaN(m)) return saatStr;
    const totalDk = (h * 60 + m + Math.round(saatMiktari * 60)) % (24 * 60);
    const yeniH = Math.floor(totalDk / 60);
    const yeniM = totalDk % 60;
    return String(yeniH).padStart(2, "0") + ":" + String(yeniM).padStart(2, "0");
  }

  function ertesiGuneGeciyorMu(saatStr, saatMiktari = 3) {
    if (!saatStr || !saatStr.includes(":")) return false;
    const [h, m] = saatStr.split(":").map(Number);
    if (isNaN(h) || isNaN(m)) return false;
    return (h * 60 + m + Math.round(saatMiktari * 60)) >= (24 * 60);
  }

  function gunEkle(tarihStr, gun = 1) {
    if (!tarihStr) return "";
    const sep = tarihStr.includes("/") ? "/" : (tarihStr.includes(".") ? "." : (tarihStr.includes("-") ? "-" : ""));
    if (!sep) return tarihStr;
    const parts = tarihStr.split(sep);
    let d, m, y;
    if (parts[0].length === 4) {
      y = Number(parts[0]); m = Number(parts[1]) - 1; d = Number(parts[2]);
    } else {
      d = Number(parts[0]); m = Number(parts[1]) - 1; y = Number(parts[2]);
    }
    const dt = new Date(y, m, d);
    dt.setDate(dt.getDate() + gun);
    const yeniD = String(dt.getDate()).padStart(2, "0");
    const yeniM = String(dt.getMonth() + 1).padStart(2, "0");
    const yeniY = dt.getFullYear();
    if (parts[0].length === 4) return `${yeniY}${sep}${yeniM}${sep}${yeniD}`;
    return `${yeniD}${sep}${yeniM}${sep}${yeniY}`;
  }

  // GTS tarifini üret.
  function tarifUret({
    kayit, indeks, asama, tarih, sayfaPlaka, sofor, sabit, refs, ilSecili,
    anahtarlar, anahtarlar1, anahtarlar2, yon
  }) {
    const k = kayit || {};
    const s = sofor || {};
    const R = birlestirRefs(refs);
    const V = R.varsayilan;
    const a1List = anahtarlar1 || anahtarlar || [];
    const a2List = anahtarlar2 || anahtarlar || [];

    const seciliYon = yon || (k && k.yon) || "";
    const isArrival = (seciliYon === "arrival")
      || (!seciliYon && (/^[AB]\d/i.test((k && k.gno) || "") || /-(AYT|BJV|DLM)\b/.test((k && k.guzergah) || "")));

    // Bölge/ilçe her seferinde kayıttan ve Ayarlar kurallarından hesaplanır;
    // kayda elle yazılmış eski alanlar (manuelAnahtar/manuelIlce) dikkate alınmaz.
    const k1 = k;
    const k2 = k;

    if (asama === "asama1") {
      let baslangic = "";

      if (isArrival) {
        baslangic = k.teslimSaat || (k.alinis && k.alinis !== "00:00" ? k.alinis : k.ucusSaat) || "";
      } else {
        // Departure: Alış yerinden (otel) alınış saati (alinis), yoksa teslimSaat
        baslangic = (k.alinis && k.alinis !== "00:00") ? k.alinis : (k.teslimSaat || k.ucusSaat || "");
      }

      // Sabit 3 saat ileri kuralı (hem Arrival hem Departure için):
      const bitisSaati = saatEkle(baslangic, 3);
      const ertesiGun = ertesiGuneGeciyorMu(baslangic, 3);
      const bitisTarihi = ertesiGun ? gunEkle(tarih || "", 1) : (tarih || "");

      const telHam = ((sabit && sabit.aracTelNo) || ((s && s.telefon) || "") || "");
      const tel = String(telHam).replace(/\D/g, "").replace(/^0/, "");
      const gz = guzergahHat(k1, tarih, refs, sabit, a1List, seciliYon);
      return {
        imza: IMZA.asama1,
        alanlar: [
          { id: "seferBaslangicTarihi", selector: "#seferBaslangicTarihi", deger: tarih || "", tur: "text" },
          { id: "seferHareketSaati", selector: "#seferHareketSaati", deger: baslangic, tur: "text" },
          { id: "seferBitisTarihi", selector: "#seferBitisTarihi", deger: bitisTarihi, tur: "text" },
          { id: "seferBitisSaati", selector: "#seferBitisSaati", deger: bitisSaati, tur: "text" },
          { id: "aracPlakasi", selector: "#aracPlakasi", deger: normPlaka(k.plaka || sayfaPlaka || ""), tur: "select" },
          { id: "firmaSeferNo", selector: "#firmaSeferNo", deger: k.gno || "", tur: "text" },
          { id: "aracTelNo", selector: "#aracTelNo", deger: tel, tur: "text" },
          { id: "seferAciklamasi", selector: "#seferAciklamasi", deger: gz.aciklama, tur: "text" }
        ].filter((a) => a.deger),
        bilgi: { aciklama: gz.aciklama, bolge: bolgeCoz(k1, { anahtarlar: a1List, sabit, refs }) }
      };
    }

    if (asama === "asama2") {
      // 2. aşama: TCKN sabit 1, personel türü 0 (şoför), şoför listesinden ad/soyad
      let adi = s.adi || "", soyadi = s.soyadi || "";
      if ((!adi || !soyadi) && s.sofor) {
        const p = String(s.sofor).trim().split(/\s+/);
        adi = adi || p[0] || "";
        soyadi = soyadi || p.slice(1).join(" ") || "";
      }
      const tel10 = (v) => {
        const d = String(v || "").replace(/\D/g, "").replace(/^0/, "");
        return /^\d{10}$/.test(d) ? d : "";
      };
      return {
        imza: IMZA.asama2,
        alanlar: [
          { id: "ulke", selector: "#ulke", deger: s.ulke || V.ulke || "TR", tur: "select" },
          { id: "tckn", selector: "#tckn", deger: s.tckn || "1", tur: "text" },
          { id: "personelTuru", selector: "#personelTuru", deger: s.personelTuru || V.personelTuru || "0", tur: "select" },
          { id: "adi", selector: "[name='adi']", deger: adi, tur: "text" },
          { id: "soyadi", selector: "[name='soyadi']", deger: soyadi, tur: "text" },
          { id: "cinsiyet", deger: s.cinsiyet || "Erkek", tur: "radio" },
          { id: "telefon", selector: "#telefon", deger: tel10(s.telefon || (sabit && sabit.aracTelNo) || ""), tur: "text" },
          { id: "adres", selector: "#adres", deger: s.adres || "", tur: "text" }
        ].filter((a) => a.deger)
      };
    }

    // 3. aşama: Grup kaydı (grupAdi, baslangic/bitis ulke, il, ilce, yer, ucret, aciklama)
    // Başlangıç -> Bitiş:
    //  Arrival:   Havalimanı (örn. ANTALYA HAVALİMANI TERMINAL 2) -> Otel
    //  Departure: Otel -> Havalimanı
    //  Yerel (ara transfer, "A=>B"): başlangıç ve bitiş yeri transfer satırındaki bölgedir
    //    ("ARA1 KEMER KMR" -> ikisi de KEMER); bölge yoksa iki otelin bölgesi ayrı çözülür
    const havaInfo = havalimaniBilgisi(k2, refs, seciliYon);
    const havaMetni = havaInfo.hava.ad || "ANTALYA HAVALİMANI";
    const trB = String(k2.trBolge || "").trim().toUpperCase();
    const trInfo = (yerelMi(k2) && trB)
      ? bolgeIlVeIlce({ otel: "", trBolge: trB, bolge: trB }, refs, ilSecili, sabit, a2List, seciliYon)
      : null;
    let bas, bit, otelInfo;
    if (trInfo && trInfo.ilceAday.length) {
      bas = { ilKod: trInfo.ilKod, ilAdi: trInfo.ilAdi, ilce: trInfo.ilceAday, yer: trB };
      bit = { ...bas };
      otelInfo = { ...trInfo, kaynak: "ara transfer: " + trInfo.kaynak };
    } else if (yerelMi(k2)) {
      const u = yerelUclar(k2);
      const b1 = bolgeIlVeIlce(u.bas, refs, ilSecili, sabit, a2List, seciliYon);
      const b2 = bolgeIlVeIlce(u.bit, refs, ilSecili, sabit, a2List, seciliYon);
      bas = { ilKod: b1.ilKod, ilAdi: b1.ilAdi, ilce: b1.ilceAday, yer: u.bas.otel || "OTEL" };
      bit = { ilKod: b2.ilKod, ilAdi: b2.ilAdi, ilce: b2.ilceAday, yer: u.bit.otel || "OTEL" };
      otelInfo = {
        ...b2, kesin: b1.kesin && b2.kesin,
        kaynak: "otelden otele: " + (b1.kaynak === b2.kaynak ? b1.kaynak : `${b1.kaynak} → ${b2.kaynak}`)
      };
    } else {
      otelInfo = bolgeIlVeIlce(k2, refs, ilSecili, sabit, a2List, seciliYon);
      const havaUc = {
        ilKod: havaInfo.ilKod, ilAdi: havaInfo.ilAdi, ilce: havaInfo.ilceAday,
        yer: (isArrival && k2.teslimNokta && /TERMINAL|DIS|DIŞ|HATLAR/i.test(k2.teslimNokta))
          ? havaMetni + " " + k2.teslimNokta : havaMetni
      };
      const otelUc = { ilKod: otelInfo.ilKod, ilAdi: otelInfo.ilAdi, ilce: otelInfo.ilceAday, yer: k2.otel || k2.bolge || "OTEL" };
      bas = isArrival ? havaUc : otelUc;
      bit = isArrival ? otelUc : havaUc;
    }

    const gz = guzergahHat(k1, tarih, refs, sabit, a1List, seciliYon);

    const a3 = [
      { id: "grupAdi", selector: "#grupAdi", deger: k.gno || "", tur: "text" },
      { id: "baslangicUlkesi", selector: "#baslangicUlkesi", deger: V.ulke || "TR", tur: "select" },
      { id: "baslangicIli", selector: "#baslangicIli", deger: bas.ilAdi, kod: bas.ilKod, tur: "il" },
      { id: "baslangicIlcesi", selector: "#baslangicIlcesi", deger: bas.ilce[0] || "", aday: bas.ilce.slice(1), tur: "ilce" },
      { id: "baslangicYeri", selector: "#baslangicYeri", deger: bas.yer.slice(0, 50), tur: "text" },
      { id: "bitisUlkesi", selector: "#bitisUlkesi", deger: V.ulke || "TR", tur: "select" },
      { id: "bitisIli", selector: "#bitisIli", deger: bit.ilAdi, kod: bit.ilKod, tur: "il" },
      { id: "bitisIlcesi", selector: "#bitisIlcesi", deger: bit.ilce[0] || "", aday: bit.ilce.slice(1), tur: "ilce" },
      { id: "bitisYeri", selector: "#bitisYeri", deger: bit.yer.slice(0, 50), tur: "text" },
      { id: "grupUcret", selector: "#grupUcret", deger: (sabit && sabit.grupUcret) || "", tur: "text" },
      { id: "grupAciklamasi", selector: "#grupAciklamasi", deger: gz.aciklama, tur: "text" }
    // İlçe bilinmese de alan listede kalır: forma boş geçilmez, hata olarak raporlanır.
    ].filter((a) => a.deger || a.kod || a.tur === "ilce");

    return {
      imza: IMZA.asama3,
      alanlar: a3,
      bilgi: {
        aciklama: gz.aciklama, otel: otelInfo, hava: havaInfo, yerel: yerelMi(k2),
        baslangic: { il: bas.ilAdi, ilce: bas.ilce[0] || "" },
        bitis: { il: bit.ilAdi, ilce: bit.ilce[0] || "" }
      }
    };
  }

  return {
    IMZA, pdfMetin, satirlariBirlestir, otelTasmaBirlestir, hatBol, kayitAyikla, pdfOku, tarifUret,
    VARSAYILAN_REFS, BOLGE_TABLOSU, katla, bolgeCoz, hatKisaAciklama, bolgeKisaKod, otelBolgesi
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = KURAL;
}
