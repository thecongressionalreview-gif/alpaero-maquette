/* Alp'Aero — simulateur (interface). Chargé à la demande quand la section approche.
   1. Le calcul local (simu-worker.js) repère le bois et donne un aperçu instantané de chaque finition.
   2. « Lancer la simulation » envoie la photo + le masque bois + la finition + le souhait du client à
      /api/simulation (IA, clé OpenAI de Nico côté serveur). Si l'IA est indisponible, l'aperçu local reste. */
(() => {
  /* Finitions : Nico peut en ajouter, renommer ou retirer ici (garder la même clé côté serveur, src/worker.js).
     Réglages de l'aperçu local : [lshift, lgain, grain, a_t, b_t, chroma, gloss, luminance cible 0–100]. */
  const FINITIONS = {
    brut:    { label: 'Brut aérogommé',       sub: 'Chêne nu, sans finition',   swatch: '#cdbfa6', f: [8, 0.9, 1.45, 3, 15, 0.25, 0.55, 64] },
    huile:   { label: 'Huile naturelle mate', sub: 'Huile-cire incolore mate',  swatch: '#b9976c', f: [3, 1.0, 1.35, 4.5, 15, 0.30, 0.75, 57] },
    blanchi: { label: 'Chêne blanchi',        sub: 'Huile teintée blanche',     swatch: '#d9d3c6', f: [14, 0.8, 1.30, 1, 8, 0.12, 0.50, 72] },
    fonce:   { label: 'Huile teintée foncée', sub: 'Aspect fumé / foncé',       swatch: '#6e553f', f: [-22, 1.0, 1.25, 5, 10, 0.28, 0.80, 34] },
  };
  const DEFAUT = 'brut', MAX_EDGE = 1400, API = '/api/simulation';

  const roots = [...document.querySelectorAll('[data-simu]')];
  if (!roots.length) return;
  const worker = new Worker(roots[0].dataset.worker);
  let seq = 0;
  roots.forEach(init);

  function init(root) {
    if (root.dataset.ready) return; root.dataset.ready = 1;
    const $ = (s) => root.querySelector(s);
    const view = $('.simu-img'), badge = $('.simu-badge'), prog = $('.simu-prog'), input = $('input[type=file]');
    const status = $('.simu-status'), cta = $('.simu-cta'), grid = $('.simu-fin'), wishBox = $('textarea'), go = $('.simu-go');
    const goT = $('.simu-go-t'), upT = $('.simu-up-t'), count = $('.simu-count');
    let PH = {}; try { PH = JSON.parse(root.dataset.ph || '{}'); } catch (e) {}
    let DEMOS = {}; try { DEMOS = JSON.parse(root.dataset.demos || '{}'); } catch (e) {}
    const big = () => matchMedia('(min-width: 900px)').matches && devicePixelRatio > 1;
    const setGo = (t) => { goT.textContent = t; };
    const loadedAt = Date.now();
    let current = DEFAUT, mode = 'demo';           // demo | photo
    let original = true;                           // la photo d'origine est affichée (aucune finition choisie)
    let photo = null;                              // { url, w, h, canvas } à MAX_EDGE
    let local = {}, mask = null, localOk = false;  // aperçus locaux (URL par finition) + masque bois
    const ai = {};                                 // résultats IA : clé "finition|souhait" → URL
    let shown = null;                              // URL actuellement affichée

    grid.innerHTML = Object.entries(FINITIONS).map(([k, v]) =>
      `<button type="button" data-k="${k}" aria-pressed="${k === current}"><i style="background:${v.swatch}"></i><span><b>${v.label}</b><small>${v.sub}</small></span></button>`).join('');

    const say = (msg, kind) => { status.textContent = msg || ''; status.hidden = !msg; status.className = 'simu-status' + (kind ? ' is-' + kind : ''); };
    const show = (url, label) => { if (url) { view.src = url; shown = url; } badge.textContent = label; };
    const wish = () => (wishBox.value || '').trim().slice(0, 400);
    const aiKey = () => current + '|' + wish();
    const setCta = () => {
      const u = new URL(cta.getAttribute('href'), location.href);
      u.searchParams.set('finition', FINITIONS[current].label); u.searchParams.set('simulation', mode);
      if (root.dataset.prestation) u.searchParams.set('prestation', root.dataset.prestation);
      cta.href = u.pathname + u.search;
    };
    const refresh = () => {
      grid.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(!original && b.dataset.k === current)));
      origBtn.hidden = original;
      if (PH[current]) wishBox.placeholder = PH[current];
      if (mode === 'demo') setGo('Choisir ma photo pour lancer');
      setCta();
      const f = FINITIONS[current].label;
      if (mode === 'demo') {
        if (original && DEMOS.original) { view.removeAttribute('srcset'); show(big() ? DEMOS.original.l : DEMOS.original.s, 'Exemple · Photo d’origine'); return; }
        const d = DEMOS[current];
        if (d) { view.removeAttribute('srcset'); show(big() ? d.l : d.s, 'Exemple · ' + f); }
        else if (local[current]) show(local[current], 'Exemple · ' + f);
        return;
      }
      if (original && photo) { show(photo.url, 'Votre photo'); setGo(ai[aiKey()] ? 'Voir la simulation' : 'Lancer la simulation'); return; }
      if (ai[aiKey()]) { show(ai[aiKey()], 'Simulation · ' + f); setGo('Relancer la simulation'); return; }
      setGo('Lancer la simulation');
      if (localOk && local[current]) show(local[current], 'Aperçu rapide · ' + f);
      else show(photo.url, 'Votre photo');
    };
    grid.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; current = b.dataset.k; original = false; refresh(); });
    const origBtn = $('.simu-orig');
    origBtn.addEventListener('click', () => { original = true; refresh(); });
    const counted = () => { const n = wishBox.value.length; count.textContent = n + ' / 400'; count.classList.toggle('is-near', n > 360); };
    wishBox.addEventListener('input', () => { counted(); if (mode === 'photo') refresh(); });
    // idées rapides : ajoutées au souhait
    root.querySelectorAll('.simu-chips button').forEach((b) => b.addEventListener('click', () => {
      const idea = b.textContent.replace(/^\+\s*/, '');
      const cur = wishBox.value.trim();
      if (cur.toLowerCase().includes(idea.toLowerCase())) return;
      wishBox.value = (cur ? cur.replace(/[.,;\s]*$/, '') + ', ' : '') + idea.charAt(0).toLowerCase() + idea.slice(1);
      if (!cur) wishBox.value = idea;
      b.classList.add('is-on'); counted(); if (mode === 'photo') refresh(); wishBox.focus();
    }));

    /* ---- calcul local (masque + aperçus) ---- */
    const load = (src) => new Promise((ok, ko) => { const im = new Image(); im.decoding = 'async'; im.onload = () => ok(im); im.onerror = ko; im.src = src; });
    async function localRun(im) {
      const id = ++seq;
      const k = Math.min(1, MAX_EDGE / Math.max(im.naturalWidth, im.naturalHeight));
      const w = Math.round(im.naturalWidth * k), h = Math.round(im.naturalHeight * k);
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(im, 0, 0, w, h);
      const base = document.createElement('canvas'); base.width = w; base.height = h; base.getContext('2d').drawImage(cv, 0, 0);
      const px = cx.getImageData(0, 0, w, h);
      const finishes = Object.fromEntries(Object.entries(FINITIONS).map(([k2, v]) => [k2, v.f]));
      const res = await new Promise((ok) => {
        const on = (e) => { if (e.data.id === id) { worker.removeEventListener('message', on); ok(e.data); } };
        worker.addEventListener('message', on);
        worker.postMessage({ id, w, h, data: px.data.buffer, finishes }, [px.data.buffer]);
      });
      const urls = {};
      if (res.ok) for (const [k2, buf] of Object.entries(res.results)) {
        cx.putImageData(new ImageData(new Uint8ClampedArray(buf), w, h), 0, 0);
        urls[k2] = URL.createObjectURL(await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.88)));
      }
      return { ok: res.ok, w, h, base, urls, mask: res.ok ? new Uint8Array(res.mask) : null };
    }

    /* ---- photo du visiteur ---- */
    input.addEventListener('change', async () => {
      const f = input.files && input.files[0]; input.value = '';
      if (!f) return;
      if (!/^image\//.test(f.type) && !/\.(jpe?g|png|webp|heic|heif)$/i.test(f.name)) { say('Choisissez une photo (JPEG, PNG…).', 'err'); return; }
      const url = URL.createObjectURL(f);
      let im; try { im = await load(url); } catch (e) { say('Cette photo n’a pas pu être ouverte sur cet appareil. Essayez une photo JPEG.', 'err'); return; }
      mode = 'photo'; root.classList.add('is-photo'); upT.textContent = 'Changer de photo';
      Object.values(local).forEach((u) => URL.revokeObjectURL(u)); Object.keys(ai).forEach((k) => { URL.revokeObjectURL(ai[k]); delete ai[k]; });
      local = {}; mask = null; localOk = false;
      view.removeAttribute('srcset'); setAr(im.naturalWidth, im.naturalHeight); show(url, 'Votre photo');
      say('Choisissez une finition, ajoutez votre souhait si besoin, puis lancez la simulation.');
      go.disabled = false;
      const r = await localRun(im);
      photo = { url, w: r.w, h: r.h, canvas: r.base };
      local = r.urls; mask = r.mask; localOk = r.ok;
      original = true; refresh();
    });
    const setAr = (w, h) => { root.style.setProperty('--ar', `${w}/${h}`); $('.simu-stage').style.setProperty('--ar', `${w}/${h}`); };

    /* ---- simulation IA ---- */
    go.addEventListener('click', async () => {
      if (mode !== 'photo') { input.click(); return; }
      if (!photo) { say('Un instant, la photo se prépare…'); return; }
      original = false;
      const key = aiKey();
      if (ai[key]) { refresh(); return; }
      root.classList.add('is-busy'); go.disabled = true;
      const t0 = Date.now();
      const tick = setInterval(() => { prog.textContent = `Simulation en cours… ${Math.round((Date.now() - t0) / 1000)} s (environ 20 à 60 s)`; }, 1000);
      prog.textContent = 'Simulation en cours…';
      say('');
      try {
        const body = new FormData();
        // le modèle ne produit que du 3:2, 1:1 ou 2:3 : on complète la photo (bords flous) au bon format,
        // puis on recadre le résultat exactement sur la photo d'origine. Pas de masque : avec ce type de modèle,
        // un masque l'autorise à redessiner toute la zone (il reconstruisait la façade).
        const pad = padForAI(photo.canvas);
        body.append('image', await new Promise((r) => pad.canvas.toBlob(r, 'image/jpeg', 0.92)), 'photo.jpg');
        body.append('size', pad.size);
        body.append('finition', current); body.append('souhait', wish());
        body.append('prestation', root.dataset.prestation || ''); body.append('t', String(loadedAt));
        body.append('site', ($('input[name=site]') || {}).value || '');
        const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 150000);
        const r = await fetch(API, { method: 'POST', body, signal: ctl.signal }); clearTimeout(to);
        const j = await r.json().catch(() => ({}));
        const b64 = j && j.data && j.data[0] && j.data[0].b64_json;
        if (!r.ok || !b64) throw new Error(j.error || 'http' + r.status);
        const bin = atob(b64), a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
        ai[key] = await cropBack(URL.createObjectURL(new Blob([a], { type: 'image/jpeg' })), pad);
        const im2 = await load(ai[key]); setAr(im2.naturalWidth, im2.naturalHeight);
        refresh();
        say('Voici votre simulation. Changez de finition ou précisez votre souhait pour en essayer une autre.');
        try { window.dataLayer && dataLayer.push({ event: 'simulation_ia', finition: current }); } catch (e) {}
      } catch (err) {
        const e = String(err.message || err);
        const msg = {
          'quota-ip': 'Vous avez atteint le nombre de simulations du jour. Voici l’aperçu rapide ; pour aller plus loin, demandez votre devis.',
          'quota-day': 'Le simulateur est très demandé aujourd’hui. Voici l’aperçu rapide ; réessayez demain ou demandez votre devis.',
          rate: 'Une simulation à la fois : réessayez dans une minute.',
          refused: 'Cette photo n’a pas pu être simulée. Essayez une autre photo, ou décrivez votre souhait autrement.',
        }[e] || 'La simulation avancée est indisponible pour le moment. Voici l’aperçu rapide.';
        refresh();
        say(localOk || e === 'rate' ? msg : 'Nous n’avons pas bien détecté le bois sur cette photo. Essayez de plus près, avec un bon éclairage.', 'err');
      } finally {
        clearInterval(tick); root.classList.remove('is-busy'); go.disabled = false;
      }
    });
    function padForAI(src) {
      const sizes = [[1536, 1024], [1024, 1024], [1024, 1536]], ar = src.width / src.height;
      const [W, H] = sizes.reduce((b, t) => (Math.abs(Math.log(t[0] / t[1] / ar)) < Math.abs(Math.log(b[0] / b[1] / ar)) ? t : b));
      const k = Math.min(W / src.width, H / src.height), w = Math.round(src.width * k), h = Math.round(src.height * k);
      const x = Math.round((W - w) / 2), y = Math.round((H - h) / 2);
      const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
      g.filter = 'blur(24px)'; g.drawImage(src, -40, -40, W + 80, H + 80); g.filter = 'none';
      g.drawImage(src, x, y, w, h);
      return { canvas: c, size: W + 'x' + H, W, H, box: { x, y, w, h } };
    }
    async function cropBack(url, pad) {
      const im = await load(url);
      const sx = im.naturalWidth / pad.W, sy = im.naturalHeight / pad.H, b = pad.box;
      const c = document.createElement('canvas'); c.width = Math.round(b.w * sx); c.height = Math.round(b.h * sy);
      c.getContext('2d').drawImage(im, b.x * sx, b.y * sy, b.w * sx, b.h * sy, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      return URL.createObjectURL(await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9)));
    }
    async function maskPng() {
      const { w, h } = photo, c = document.createElement('canvas'); c.width = w; c.height = h;
      const d = new ImageData(w, h);
      for (let i = 0; i < w * h; i++) d.data[i * 4 + 3] = 255 - mask[i]; // bois = transparent = zone à retoucher
      c.getContext('2d').putImageData(d, 0, 0);
      return new Promise((r) => c.toBlob(r, 'image/png'));
    }

    /* ---- « Demander un devis » : la photo et la simulation suivent jusqu'au formulaire (cet appareil seulement) ---- */
    const toData = (img, max = 1200) => {
      const k = Math.min(1, max / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
      const c = document.createElement('canvas'); c.width = Math.round((img.naturalWidth || img.width) * k); c.height = Math.round((img.naturalHeight || img.height) * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', 0.82);
    };
    cta.addEventListener('click', () => {
      try { sessionStorage.removeItem('alpaero-simu'); } catch (e) {}
      if (mode !== 'photo' || !photo || !view.complete) return;
      try { sessionStorage.setItem('alpaero-simu', JSON.stringify({ finition: FINITIONS[current].label, key: current, before: toData(photo.canvas), after: toData(view) })); } catch (e) {}
    });

    /* ---- exemple au chargement ---- */
    setGo('Choisir ma photo pour lancer');
    (async () => {
      if (Object.keys(DEMOS).length) { refresh(); return; }
      try {
        const im = await load(root.dataset.demo);
        const r = await localRun(im);
        local = r.urls; localOk = r.ok; setAr(r.w, r.h); refresh();
      } catch (e) {}
    })();
  }
})();
