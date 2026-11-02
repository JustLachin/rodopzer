// İmza probu: bu sekmede hangi aşama formunun olduğunu söyler.
// Aşamalar ayrı sekmelerdedir; her sekme yalnızca kendi formunu içerir.
// (browser_link.find_target_page ile aynı yaklaşım — içerikten bulma.)
(() => {
  const q = (s) => { try { return document.querySelector(s); } catch (e) { return null; } };
  const varMi = (ad) => {
    const b = String(ad || "").trim();
    if (!b) return false;
    return !!(q("#" + b) || q("[name='" + b + "']") || q("[id='" + b + "']")
      || q("input[id='" + b + "']") || q("input[name='" + b + "']")
      || q("select[id='" + b + "']") || q("textarea[id='" + b + "']"));
  };
  const sefer = varMi("seferHareketSaati"), tckn = varMi("tckn"), grup = varMi("grupAdi");

  // 4. aşama (yolcu Excel'i) üç sayfadan biriyle başlar:
  //  - "Excel'den Yükle" formu (dosya alanı)       -> doğrudan yüklenir
  //  - grubun "Yolcu Listesi" sayfası              -> excelYukle bağlantısına gidilir
  //  - grup listesi (her satırda "Yolcu Listesi")  -> grup adı hücresi eşleşen satıra gidilir
  const dosya = q("input[type='file'][name='file']") || q("input[type='file']");
  const metin = String((document.body && document.body.innerText) || "");
  const excelYukle = !!dosya && (/asama=excelYukle/i.test(location.href) || /Yolcu Listesi/i.test(metin));
  const excelLink = q("a[href*='asama=excelYukle']");
  const grupSatirlari = Array.from(document.querySelectorAll("a[href*='asama=yolcuListesi']"))
    .slice(0, 300)
    .map((a) => {
      const tr = a.closest("tr");
      const hucreler = tr ? Array.from(tr.cells).map((td) => td.innerText.replace(/\s+/g, " ").trim()).filter(Boolean) : [];
      return { href: a.href, hucreler: hucreler.slice(0, 20) };
    });

  return {
    url: location.href,
    imza: { seferHareketSaati: sefer, tckn: tckn, grupAdi: grup, excelYukle: excelYukle || !!excelLink || grupSatirlari.length > 0 },
    asama1: sefer, asama2: tckn, asama3: grup,
    asama4: { excelYukle, excelLink: excelLink ? excelLink.href : "", grupSatirlari },
    inputSayisi: document.querySelectorAll("input,select,textarea").length,
    iframe: !!document.querySelector("iframe")
  };
})()