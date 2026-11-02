(async () => {
  // Tarif (recipe): window.__dx_recipe (MAIN world) veya chrome.storage.local (ISOLATED world)
  let rc = (typeof window !== "undefined" && window.__dx_recipe) ? window.__dx_recipe : null;
  try { if (window && window.__dx_recipe) delete window.__dx_recipe; } catch (e) {}
  if (!rc && typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    const o = await chrome.storage.local.get(["dx_recipe"]);
    rc = o && o.dx_recipe;
    try { await chrome.storage.local.remove(["dx_recipe"]); } catch (e) {}
  }
  const rapor = { tamam: 0, hata: [], secili: {} };

  const normTr = (s) => String(s || "")
    .replace(/İ/g, "I").replace(/ı/g, "I").replace(/i/g, "I")
    .replace(/Ş/g, "S").replace(/ş/g, "S")
    .replace(/Ğ/g, "G").replace(/ğ/g, "G")
    .replace(/Ü/g, "U").replace(/ü/g, "U")
    .replace(/Ö/g, "O").replace(/ö/g, "O")
    .replace(/Ç/g, "C").replace(/ç/g, "C")
    .toUpperCase().replace(/\s+/g, " ").trim();

  const q1 = (s) => { try { return document.querySelector(s); } catch (e) { return null; } };

  // Sayfa ana bağlamında (main world) ek script güvencesi
  const sayfadaCalistir = (kod) => {
    try {
      const s = document.createElement("script");
      s.textContent = kod;
      (document.head || document.documentElement).appendChild(s);
      s.remove();
    } catch (e) {
      /* CSP engellerse sessizce geç */
    }
  };

  const tetikle = (e) => {
    const onch = e.getAttribute && e.getAttribute("onchange");
    if (onch) { try { new Function(onch).call(e); } catch(err){} }
    if (typeof e.onchange === "function") { try { e.onchange(); } catch(err){} }
    if (typeof window !== "undefined" && window.$) { try { window.$(e).trigger("change"); } catch(err){} }
    e.dispatchEvent(new Event("input", { bubbles: true }));
    e.dispatchEvent(new Event("change", { bubbles: true }));
  };

  const kullanicilar = (a) => {
    const l = [a.selector, `#${a.id}`, `[name='${a.id}']`].filter(Boolean);
    return [...new Set(l)];
  };
  const bir = (adaylar) => {
    for (const s of adaylar) { const e = q1(s); if (e) return e; }
    return null;
  };

  const imzaVar = (imza) => {
    const z = String(imza || "").trim();
    if (!z) return true;
    const base = z.replace(/^[#.]/, "");
    return !!(q1(z) || q1(`#${base}`) || q1(`[name='${base}']`) || q1(`[id='${base}']`));
  };

  const yaz = (a) => {
    const e = bir(kullanicilar(a));
    if (!e || !("value" in e)) return false;
    if (e.type === "radio" || e.type === "checkbox") {
      e.checked = true; e.click(); tetikle(e);
      return true;
    }
    e.value = a.deger;
    tetikle(e);
    return true;
  };

  const sec = (a) => {
    const e = bir(kullanicilar(a));
    if (!e || e.tagName !== "SELECT" || !e.options) return false;
    const v = String(a.deger || "");
    const adaylar = [a.deger].concat(a.aday || []).map(normTr).filter(Boolean);
    let o = (a.kod ? Array.from(e.options).find((x) => String(x.value) === String(a.kod)) : null)
      || (v ? Array.from(e.options).find((x) => String(x.value) === v) : null);
    if (!o) {
      for (const t of adaylar) {
        o = Array.from(e.options).find((x) => normTr(x.text) === t)
          || Array.from(e.options).find((x) => normTr(x.text).includes(t));
        if (o) break;
      }
    }
    if (!o) return false;

    // Eğer zaten istenen seçenek seçiliyse gereksiz onchange tetikleyip alt dropdown'ları sıfırlama!
    // Özellikle baslangicUlkesi ve bitisUlkesi zaten "TR" olduğunda onchange çalışırsa illeri siler!
    if (String(e.value) === String(o.value)) {
      o.selected = true;
      return true;
    }

    e.value = o.value;
    o.selected = true;
    tetikle(e);
    return true;
  };

  // İl seçimi: e-Devlet'in T.getBaslangicIlcesi / T.getBitisIlcesi AJAX motorunu güvenle tetikler ve ilçelerin yüklenmesini bekler
  const secIl = async (a) => {
    const e = bir(kullanicilar(a));
    if (!e || e.tagName !== "SELECT" || !e.options) return false;

    // İller henüz hazır değilse bekle (örn. sayfa açılışı veya ülke AJAX'ı durumunda)
    const ilHazir = () => Array.from(e.options).some(
      (o) => o.value && !/yük/i.test(o.text) && normTr(o.text) !== "SECINIZ");
    for (let i = 0; i < 40; i++) {
      if (ilHazir()) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    const v = String(a.deger || "");
    const adaylar = [a.deger].concat(a.aday || []).map(normTr).filter(Boolean);
    let o = (a.kod ? Array.from(e.options).find((x) => String(x.value) === String(a.kod)) : null)
      || (v ? Array.from(e.options).find((x) => String(x.value) === v) : null);
    if (!o) {
      for (const t of adaylar) {
        o = Array.from(e.options).find((x) => normTr(x.text) === t)
          || Array.from(e.options).find((x) => normTr(x.text).includes(t));
        if (o) break;
      }
    }
    if (!o) return false;

    const val = o.value;
    const id = e.id || a.id || "baslangicIli";
    const ilceId = id === "baslangicIli" ? "baslangicIlcesi" : "bitisIlcesi";
    const ilceElem = document.getElementById(ilceId);

    // Eğer bu il zaten seçiliyse ve ilçeler de yüklüyse tekrar tetikleme yapma
    const ilceYuklu = ilceElem && Array.from(ilceElem.options || []).some(
      (opt) => opt.value && !/yük/i.test(opt.text) && normTr(opt.text) !== "SECINIZ");

    if (String(e.value) === String(val) && ilceYuklu) {
      o.selected = true;
      return true;
    }

    e.value = val;
    o.selected = true;
    for (let i = 0; i < e.options.length; i++) {
      if (String(e.options[i].value) === String(val)) {
        e.selectedIndex = i;
        e.options[i].selected = true;
        break;
      }
    }

    const fnName = id === "baslangicIli" ? "getBaslangicIlcesi" : "getBitisIlcesi";

    // e-Devlet AJAX fonksiyonunu tek sefer güvenle çağır
    let cagrildi = false;
    if (typeof window !== "undefined" && window.T && typeof window.T[fnName] === "function") {
      try {
        window.T[fnName](val);
        cagrildi = true;
      } catch (err) { console.error(err); }
    }
    if (!cagrildi) {
      if (typeof e.onchange === "function") {
        try { e.onchange(); cagrildi = true; } catch (err) {}
      } else {
        sayfadaCalistir(`if (window.T && typeof window.T[${JSON.stringify(fnName)}] === "function") {
          try { window.T[${JSON.stringify(fnName)}](${JSON.stringify(val)}); } catch(err){}
        }`);
      }
    }

    // e-Devlet T.AJAX tek nesne kullandığı için, ilçe dropdown'ı tamamen dolana kadar bekle!
    if (ilceElem) {
      const ilceHazir = () => Array.from(ilceElem.options || []).some(
        (opt) => opt.value && !/yük/i.test(opt.text) && normTr(opt.text) !== "SECINIZ");
      for (let i = 0; i < 70; i++) {
        await new Promise((r) => setTimeout(r, 100));
        if (ilceHazir()) break;
      }
      await new Promise((r) => setTimeout(r, 200));
    } else {
      await new Promise((r) => setTimeout(r, 400));
    }
    return true;
  };

  // İlçe seçimi: e-Devlet AJAX ile ilçeleri yükleyene kadar bekler ve eşleşeni seçer
  const secIlce = async (a) => {
    const e = bir(kullanicilar(a));
    if (!e || e.tagName !== "SELECT" || !e.options) return false;
    const adaylar = [a.deger].concat(a.aday || []).map(normTr).filter(Boolean);
    if (!adaylar.length) return false; // bölge tanınmadı: elle seçilmeli
    const hazir = () => Array.from(e.options).some(
      (o) => o.value && !/yük/i.test(o.text) && normTr(o.text) !== "SECINIZ");

    // e-Devlet AJAX cevabını bekle (her 100ms kontrol et, max 7 saniye)
    for (let i = 0; i < 70; i++) {
      if (hazir()) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    // 1) Tam eşleşme (örn: SERİK, KEMER, BODRUM, DALAMAN, DİDİM, MERKEZ, ANTALYA HAVALİMANI)
    let hedef = null;
    for (const bek of adaylar) {
      hedef = Array.from(e.options).find((x) => x.value && normTr(x.text) === bek);
      if (hedef) break;
    }

    // 2) Seçenek metni adayı içeriyor mu? (Örn: "ANTALYA HAVALİMANI" içerir "HAVALİMANI")
    if (!hedef) {
      for (const bek of adaylar) {
        hedef = Array.from(e.options).find((x) => x.value && normTr(x.text).includes(bek));
        if (hedef) break;
      }
    }

    // 3) Aday seçenek metnini içeriyor mu? (Örn: "KONYAALTI" içerir "KONYA")
    if (!hedef) {
      for (const bek of adaylar) {
        hedef = Array.from(e.options).find((x) => x.value && normTr(x.text).length >= 4 && bek.includes(normTr(x.text)));
        if (hedef) break;
      }
    }

    // 4) Eğer havalimanı aranıyorsa ve ilçeler arasında genel havalimanı kelimesi varsa
    if (!hedef) {
      const isAirportCandidate = adaylar.some((x) => /HAVA(LIMANI|ALANI)|APT|AYT|BJV|DLM/.test(x));
      if (isAirportCandidate) {
        hedef = Array.from(e.options).find((x) => x.value && /HAVA(LIMANI|ALANI)|AIRPORT|TERMINAL/i.test(normTr(x.text)));
      }
    }

    if (!hedef) return false;

    const val = hedef.value;
    e.value = val;
    hedef.selected = true;
    for (let i = 0; i < e.options.length; i++) {
      if (String(e.options[i].value) === String(val)) {
        e.selectedIndex = i;
        e.options[i].selected = true;
        break;
      }
    }

    e.dispatchEvent(new Event("input", { bubbles: true }));
    e.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 200));
    return true;
  };

  const radio = (a) => {
    if (a.deger) {
      const adaylar = Array.from(document.querySelectorAll(`[name='${a.id}']`))
        .filter((x) => x.type === "radio" || x.type === "checkbox");
      const hedef = adaylar.find((x) => normTr(x.value) === normTr(a.deger))
        || (normTr(a.deger) ? adaylar.find((x) => x.value && normTr(x.value).startsWith(normTr(a.deger).slice(0, 1))) : null);
      if (hedef) {
        hedef.checked = true;
        hedef.click();
        tetikle(hedef);
        return true;
      }
      return false;
    }
    const e = bir(kullanicilar(a));
    if (!e || e.type !== "radio") return false;
    e.checked = true;
    e.click();
    tetikle(e);
    return true;
  };

  if (!rc) return { tamam: false, mesaj: "Tarif bekleniyor; tekrar deneyin." };

  if (!imzaVar(rc.imza)) {
    return { tamam: false, mesaj: "Bu sekmede imza yok: " + rc.imza };
  }

  for (const a of rc.alanlar || []) {
    try {
      let ok = false;
      if (a.tur === "radio") ok = radio(a);
      else if (a.tur === "il") ok = await secIl(a);
      else if (a.tur === "ilce") ok = await secIlce(a);
      else if (a.tur === "select") ok = sec(a);
      else ok = yaz(a);
      if (ok) {
        rapor.tamam++;
        if (a.id) rapor.secili[a.id] = a.selector || `#${a.id}`;
      } else {
        const bek = [a.deger].concat(a.aday || []).filter(Boolean).slice(0, 4).join("/");
        rapor.hata.push(a.id + " (bulunamadı/" + a.tur + (bek ? ":" + bek : "") + ")");
      }
    } catch (ex) {
      rapor.hata.push(a.id + " (hata: " + ex + ")");
    }
  }
  rapor.imza = rc.imza;
  return rapor;
})()