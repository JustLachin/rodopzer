(() => {
  const temiz = (s) => (s || "").trim();

  // Sayfada secimli form alani varsa oradan al
  const f = document.querySelector("#aracPlakasi");
  if (f && f.tagName === "SELECT") {
    const o = f.options[f.selectedIndex];
    const v = temiz(o ? o.textContent : "");
    if (v && !/se[cç]in|k[kK]oun|y[\u00fc]kleniyor/i.test(v)) return v;
  }

  // Bilgi kutusu (dl): "Araç Plaka Numarası" -> 07BYP846
  // Dikkat: etiket "Araç Plaka Numarası" içinde "Numara" da geçer; asıl istenen
  // plakadır. Sadece "Telefon" içeren etiket elenir.
  const satirlar = document.querySelectorAll("dl.condensed dt, dl dt, table.condensed dt");
  for (const dt of satirlar) {
    const t = temiz(dt.textContent);
    if (/plaka/i.test(t) && !/telefon/i.test(t)) {
      const dd = dt.nextElementSibling;
      const v = temiz(dd ? dd.textContent : "");
      if (v) return v;
    }
  }
  return "";
})()