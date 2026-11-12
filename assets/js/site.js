(() => {
  const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  // header: solid once scrolled (home), mobile menu
  const hd = document.querySelector('[data-hd]');
  const onScroll = () => hd && hd.classList.toggle('stuck', scrollY > 40);
  addEventListener('scroll', onScroll, { passive: true }); onScroll();
  const burger = document.querySelector('.burger'), nav = document.getElementById('nav');
  burger?.addEventListener('click', () => {
    const open = burger.getAttribute('aria-expanded') !== 'true';
    burger.setAttribute('aria-expanded', open); nav.classList.toggle('open', open); hd.classList.toggle('stuck', open || scrollY > 40);
  });
  addEventListener('keydown', e => { if (e.key === 'Escape' && nav?.classList.contains('open')) burger.click(); });

  // reveal on scroll
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px' });
  $$('.reveal').forEach(el => io.observe(el));

  // ---------- before / after with grit dust ----------
  const DUST = ['#c99d66', '#e2c49a', '#8d3b2a', '#9a958b', '#f4efe6'];
  function setupBA(fig) {
    const stage = fig.querySelector('.ba-stage'), line = fig.querySelector('.ba-line'), cv = fig.querySelector('.ba-dust');
    const ctx = cv.getContext('2d'); let parts = [], raf = 0, pos = 50, last = 50, dragging = false;
    const size = () => { const r = stage.getBoundingClientRect(), d = Math.min(devicePixelRatio || 1, 2); cv.width = r.width * d; cv.height = r.height * d; ctx.setTransform(d, 0, 0, d, 0, 0); };
    new ResizeObserver(size).observe(stage);
    function emit(n) {
      if (RM) return; const r = stage.getBoundingClientRect(), x = r.width * pos / 100, dir = Math.sign(pos - last) || 1;
      for (let i = 0; i < n; i++) parts.push({ x: x + (Math.random() - .5) * 6, y: Math.random() * r.height, vx: (Math.random() * 2.2 + .4) * dir * -1 + (Math.random() - .5), vy: (Math.random() - .6) * 1.6, life: 1, s: Math.random() * 2.2 + .6, c: DUST[(Math.random() * DUST.length) | 0] });
      if (!raf) raf = requestAnimationFrame(tick);
    }
    function tick() {
      const r = stage.getBoundingClientRect(); ctx.clearRect(0, 0, r.width, r.height);
      parts = parts.filter(p => p.life > 0);
      for (const p of parts) { p.x += p.vx; p.y += p.vy; p.vy += .05; p.vx *= .97; p.life -= .022; ctx.globalAlpha = Math.max(p.life, 0) * .9; ctx.fillStyle = p.c; ctx.fillRect(p.x, p.y, p.s, p.s); }
      raf = parts.length ? requestAnimationFrame(tick) : 0;
    }
    function set(v, dust = true) {
      last = pos; pos = Math.max(0, Math.min(100, v));
      stage.style.setProperty('--pos', pos + '%'); line.setAttribute('aria-valuenow', Math.round(pos));
      line.setAttribute('aria-valuetext', `${Math.round(pos)} % avant`);
      if (dust && Math.abs(pos - last) > .2) emit(Math.min(40, Math.abs(pos - last) * 5 + 4));
    }
    const fromEvent = e => { const r = stage.getBoundingClientRect(); return (e.clientX - r.left) / r.width * 100; };
    stage.addEventListener('pointerdown', e => { dragging = true; stage.setPointerCapture(e.pointerId); set(fromEvent(e)); });
    stage.addEventListener('pointermove', e => { if (dragging) set(fromEvent(e)); });
    ['pointerup', 'pointercancel'].forEach(t => stage.addEventListener(t, () => dragging = false));
    line.addEventListener('keydown', e => {
      const step = e.shiftKey ? 10 : 2, m = { ArrowLeft: -step, ArrowDown: -step, ArrowRight: step, ArrowUp: step }[e.key];
      if (m) { e.preventDefault(); set(pos + m); } else if (e.key === 'Home') { e.preventDefault(); set(0); } else if (e.key === 'End') { e.preventDefault(); set(100); }
    });
    set(50, false);
    // intro: start fully "before", then blast across to the middle
    fig.intro = () => {
      if (RM || fig.dataset.done) return; fig.dataset.done = 1;
      const t0 = performance.now(), from = 96, to = 42, D = 1600; set(from, false);
      const step = now => { if (dragging) return; const k = Math.min(1, (now - t0) / D), e = 1 - Math.pow(1 - k, 3); set(from + (to - from) * e); if (k < 1) requestAnimationFrame(step); };
      setTimeout(() => requestAnimationFrame(t => { requestAnimationFrame(step); }), 250);
    };
  }
  const baIO = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting && e.target.offsetParent) { e.target.intro(); baIO.unobserve(e.target); } }), { threshold: .45 });
  $$('[data-ba]').forEach(f => { setupBA(f); baIO.observe(f); });

  // chips switcher (home)
  $$('[data-switch]').forEach(sw => {
    const tabs = $$('[data-pair]', sw), panels = $$('[data-panel]', sw);
    tabs.forEach(t => t.addEventListener('click', () => {
      tabs.forEach(x => x.setAttribute('aria-selected', x === t));
      panels.forEach(p => { p.hidden = p.dataset.panel !== t.dataset.pair; if (!p.hidden) { const f = p.querySelector('[data-ba]'); delete f.dataset.done; requestAnimationFrame(() => f.intro()); } });
    }));
  });

  // video: play only when visible
  $$('video[data-autoplay]').forEach(v => {
    if (RM) { v.setAttribute('controls', ''); return; }
    new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { v.preload = 'auto'; v.play().catch(() => v.setAttribute('controls', '')); } else v.pause(); }), { threshold: .25 }).observe(v);
  });

  // drag-to-scroll strip (mouse only)
  $$('[data-drag]').forEach(row => {
    let down = false, sx = 0, sl = 0, moved = 0;
    row.addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse') return; down = true; moved = 0; sx = e.clientX; sl = row.scrollLeft; });
    addEventListener('pointermove', e => { if (!down) return; const dx = e.clientX - sx; moved = Math.max(moved, Math.abs(dx)); if (moved > 4) row.classList.add('drag'); row.scrollLeft = sl - dx; });
    addEventListener('pointerup', () => { down = false; setTimeout(() => row.classList.remove('drag'), 0); });
    row.addEventListener('click', e => { if (moved > 6) { e.preventDefault(); e.stopPropagation(); } }, true);
  });

  // lightbox
  const lb = document.querySelector('[data-lb]');
  if (lb) {
    const li = lb.querySelector('img'), lp = lb.querySelector('p');
    $$('[data-zoom]').forEach(b => b.addEventListener('click', () => { li.src = b.dataset.zoom; li.alt = b.dataset.cap; lp.textContent = b.dataset.cap; lb.showModal(); }));
    lb.addEventListener('click', e => { if (e.target === lb || e.target.closest('.lb-x')) lb.close(); });
  }

  // simulateur : script et worker chargés seulement quand la section approche
  const simus = $$('[data-simu]');
  if (simus.length) {
    let loaded = false;
    const go = () => { if (loaded) return; loaded = true; const sc = document.createElement('script'); sc.src = simus[0].dataset.src; sc.defer = true; document.body.appendChild(sc); };
    if ('IntersectionObserver' in window) { const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { io.disconnect(); go(); } }, { rootMargin: '600px 0px' }); simus.forEach(x => io.observe(x)); } else go();
  }
  // simulateur à onglets (Chalet / Meuble)
  const tabs = $$('.simu-tabs [role=tab]');
  if (tabs.length) {
    const pick = (t, focus) => {
      tabs.forEach(x => { const on = x === t; x.setAttribute('aria-selected', String(on)); x.tabIndex = on ? 0 : -1; const p = document.getElementById(x.getAttribute('aria-controls')); if (p) p.hidden = !on; });
      if (focus) t.focus();
    };
    tabs.forEach((t, i) => {
      t.addEventListener('click', () => pick(t));
      t.addEventListener('keydown', e => { const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key]; if (d) { e.preventDefault(); pick(tabs[(i + d + tabs.length) % tabs.length], true); } });
    });
    const fromHash = tabs.find(t => '#' + t.getAttribute('aria-controls') === location.hash);
    if (fromHash) pick(fromHash);
  }

  // devis : pré-remplissage depuis le simulateur (?finition=…&simulation=photo|demo)
  const qp = new URLSearchParams(location.search), fin = qp.get('finition');
  // photo de la simulation (déposée par simu.js en sessionStorage quand le visiteur clique « Demander un devis »)
  let simuShot = null;
  try { simuShot = JSON.parse(sessionStorage.getItem('alpaero-simu') || 'null'); } catch (e) {}
  if (simuShot && (!fin || simuShot.finition !== fin)) simuShot = null;

  if (fin) $$('[data-form]').forEach(f => {
    const ta = f.querySelector('textarea[name=description]'), sel = f.querySelector('select[name=prestation]');
    if (ta && !ta.value) ta.value = 'Simulation faite sur le site : finition souhaitée « ' + fin + ' ».\n\nMon projet : ';
    const want = qp.get('prestation') || 'Aérogommage de meubles';
    if (sel) [...sel.options].forEach(o => { if (o.text === want) sel.value = o.value || o.text; });
    const hf = f.querySelector('input[name=finition]'); if (hf) hf.value = fin;
    const box = f.querySelector('.f-simu');
    if (box && simuShot) {
      box.hidden = false;
      box.innerHTML = `<img src="${simuShot.before}" alt="Votre photo"><img src="${simuShot.after}" alt="Votre simulation"><p><b>Votre photo et votre simulation sont jointes</b><span>Finition : ${fin.replace(/</g, '')}</span></p><button type="button" aria-label="Retirer la photo de la simulation">✕</button>`;
      box.querySelector('button').addEventListener('click', () => { simuShot = null; box.hidden = true; try { sessionStorage.removeItem('alpaero-simu'); } catch (e) {} });
    }
  });

  // photos ajoutées : aperçu + réduction avant envoi (photos de téléphone : 4–8 Mo → ~400 Ko)
  const MAX_PHOTOS = 6;
  const shrink = (file, max = 1600) => new Promise(res => {
    const u = URL.createObjectURL(file), im = new Image();
    im.onload = () => {
      const k = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight)), c = document.createElement('canvas');
      c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k);
      c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); URL.revokeObjectURL(u);
      c.toBlob(b => res(b ? new File([b], (file.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' }) : null), 'image/jpeg', 0.82);
    };
    im.onerror = () => { URL.revokeObjectURL(u); res(file.size < 5e6 && /^image\//.test(file.type) ? file : null); }; // ex. HEIC sur Chrome : envoyée telle quelle si < 5 Mo
    im.src = u;
  });
  const dataUrlFile = (d, name) => { const [h, b] = d.split(','); const bin = atob(b), a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return new File([a], name, { type: (h.match(/:(.*?);/) || [])[1] || 'image/jpeg' }); };

  $$('[data-form]').forEach(f => {
    const t = f.querySelector('input[name=t]'); if (t) t.value = Date.now();
    const inp = f.querySelector('input[name=photos]'), thumbs = f.querySelector('.f-thumbs');
    let picked = [];
    const paint = () => {
      thumbs.hidden = !picked.length;
      thumbs.innerHTML = picked.map((p, i) => `<span><img src="${p.url}" alt=""><button type="button" data-i="${i}" aria-label="Retirer cette photo">✕</button></span>`).join('');
    };
    if (inp) {
      inp.addEventListener('change', () => {
        [...inp.files].forEach(file => { if (picked.length < MAX_PHOTOS) picked.push({ file, url: URL.createObjectURL(file) }); });
        inp.value = ''; paint();
      });
      thumbs.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; const [p] = picked.splice(+b.dataset.i, 1); URL.revokeObjectURL(p.url); paint(); });
    }

    // validation, puis envoi direct (Worker) ; en cas d'échec, repli sur la messagerie du visiteur
    f.addEventListener('submit', async e => {
      e.preventDefault();
      const msg = f.querySelector('.f-msg'), btn = f.querySelector('button[type=submit]'); let ok = true;
      $$('[required]', f).forEach(i => { const bad = !i.value.trim() || (i.type === 'tel' && i.value.replace(/\D/g, '').length < 9); i.classList.toggle('bad', bad); if (bad && ok) { i.focus(); ok = false; } });
      const em = f.querySelector('[type=email]'); if (em && em.value && !/^\S+@\S+\.\S+$/.test(em.value)) { em.classList.add('bad'); ok = false; }
      msg.hidden = false; msg.className = 'f-msg' + (ok ? '' : ' err');
      if (!ok) { msg.textContent = 'Merci de compléter les champs obligatoires.'; return; }
      const data = Object.fromEntries([...new FormData(f)].filter(([, v]) => typeof v === 'string'));
      if (f.getAttribute('action')) {
        btn.disabled = true; msg.textContent = picked.length || simuShot ? 'Envoi en cours (photos comprises)…' : 'Envoi en cours…';
        try {
          const body = new FormData();
          Object.entries(data).forEach(([k, v]) => body.append(k, v));
          if (simuShot) { body.append('photos', dataUrlFile(simuShot.before, 'photo-client.jpg')); body.append('photos', dataUrlFile(simuShot.after, 'simulation-' + (simuShot.key || 'finition') + '.jpg')); }
          for (const p of picked.slice(0, MAX_PHOTOS - (simuShot ? 2 : 0))) { const s = await shrink(p.file); if (s) body.append('photos', s); }
          const r = await fetch(f.getAttribute('action'), { method: 'POST', body, headers: { Accept: 'application/json' } });
          const j = await r.json().catch(() => ({}));
          if (!r.ok || !j.ok) throw new Error(j.error || r.status);
          f.reset(); picked.forEach(p => URL.revokeObjectURL(p.url)); picked = []; if (thumbs) paint();
          const sb = f.querySelector('.f-simu'); if (sb) sb.hidden = true; try { sessionStorage.removeItem('alpaero-simu'); } catch (e2) {}
          if (t) t.value = Date.now();
          msg.textContent = 'Merci ! Votre demande est bien envoyée à Nico. Réponse sous 24h.';
          return;
        } catch (err) {
          if (String(err.message) === 'rate') { msg.className = 'f-msg err'; msg.textContent = 'Trop d’envois d’affilée. Réessayez dans une minute ou appelez le 06 10 50 89 82.'; return; }
          // repli : messagerie du visiteur (la demande n'est jamais perdue)
        } finally { btn.disabled = false; }
      }
      const L = { prenom: 'Prénom', nom: 'Nom', telephone: 'Téléphone', email: 'Email', prestation: 'Prestation', localisation: 'Localisation', finition: 'Finition', description: 'Projet' };
      const body = Object.entries(data).filter(([k, v]) => v && L[k]).map(([k, v]) => `${L[k]} : ${v}`).join('\n');
      location.href = `mailto:alpaero05@gmail.com?subject=${encodeURIComponent('Demande de devis — ' + (data.prenom || '') + ' ' + (data.nom || ''))}&body=${encodeURIComponent(body + '\n\n(Vous pouvez joindre vos photos à cet email.)')}`;
      msg.className = 'f-msg'; msg.textContent = 'L’envoi direct n’a pas abouti : votre messagerie s’ouvre avec la demande pré-remplie, il ne reste qu’à l’envoyer.';
    });
  });
})();
