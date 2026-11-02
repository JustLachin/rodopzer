(() => {
  const R = { tur: "probe", url: location.href, baslik: document.title || "" };
  R.iframes = Array.from(document.querySelectorAll("iframe")).map((f) => f.src).filter(Boolean).slice(0, 20);
  R.sayac = { input: 0, select: 0, textarea: 0, radio: 0 };
  R.kontroller = [];
  const temiz = (s) => String(s || "").replace(/\s+/g, " ").trim().slice(0, 120);

  // Etiket coz: label[for] > sarmalayan label > aria > placeholder > yakin baslik.
  const etiketBul = (el) => {
    try {
      if (el.id) {
        const l = document.querySelector(`label[for='${CSS.escape(el.id)}']`);
        if (l && l.textContent.trim()) return temiz(l.textContent);
      }
      const sarmalayan = el.closest ? el.closest("label") : null;
      if (sarmalayan && sarmalayan.textContent.trim()) return temiz(sarmalayan.textContent);
      if (el.getAttribute) {
        const a = el.getAttribute("aria-label");
        if (a && a.trim()) return temiz(a);
        const p = el.getAttribute("placeholder");
        if (p && p.trim()) return temiz(p);
      }
      // tablo hucresi / form satiri basligi
      const hucre = el.closest ? el.closest("td,th,.form-group,.row,dl,div") : null;
      if (hucre) {
        const baslik = hucre.querySelector("dt,th,label,span.minik,small");
        if (baslik && baslik.textContent.trim()) return temiz(baslik.textContent);
      }
      let onceki = el.previousElementSibling, adim = 0;
      while (onceki && adim < 3) {
        const t = temiz(onceki.textContent);
        if (t && /[a-zçğıöşüA-ZÇĞİÖŞÜ]/.test(t)) return t;
        onceki = onceki.previousElementSibling; adim++;
      }
    } catch (e) {}
    return "";
  };

  const goster = (el) => {
    if (!el.id && !el.name) return;
    const tag = el.tagName.toLowerCase();
    const tip = (el.type || "").toLowerCase();
    R.sayac[tag] = (R.sayac[tag] || 0) + 1;
    if (tip === "radio" || tip === "checkbox") R.sayac.radio++;
    const satir = { tag, id: el.id || "", name: el.name || "", type: tip, etiket: etiketBul(el) };
    if (el.required) satir.zorunlu = true;
    if (el.value !== undefined && tag !== "select" && String(el.value).trim()) {
      satir.mevcut = String(el.value).slice(0, 60);
    }
    if (tag === "select") {
      // tum secenekler (il/ilce gibi uzun listeler dahil, sinirli)
      satir.opts = Array.from(el.options).slice(0, 120).map((o) => ({ v: o.value, t: temiz(o.text) }));
      satir.optSayisi = el.options.length;
    }
    if (tip === "radio" || tip === "checkbox") {
      satir.deger = el.value || "";
      try { satir.isaretli = !!el.checked; } catch (e) {}
    }
    R.kontroller.push(satir);
  };
  Array.from(document.querySelectorAll("input,select,textarea")).forEach(goster);
  R.kontroller = R.kontroller.slice(0, 400);
  ["seferHareketSaati", "tckn", "grupAdi"].forEach((z) => {
    R["iz:" + z] = !!(document.querySelector("#" + z) || document.querySelector(`[name='${z}']`)
      || document.querySelector(`[id='${z}']`));
  });
  return R;
})()