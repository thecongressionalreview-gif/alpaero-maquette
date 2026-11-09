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

  // forms: validate; send to endpoint if set, else open the visitor's mail app pre-filled
  $$('[data-form]').forEach(f => f.addEventListener('submit', async e => {
    e.preventDefault();
    const msg = f.querySelector('.f-msg'); let ok = true;
    $$('[required]', f).forEach(i => { const bad = !i.value.trim() || (i.type === 'tel' && i.value.replace(/\D/g, '').length < 9); i.classList.toggle('bad', bad); if (bad && ok) { i.focus(); ok = false; } });
    const em = f.querySelector('[type=email]'); if (em && em.value && !/^\S+@\S+\.\S+$/.test(em.value)) { em.classList.add('bad'); ok = false; }
    msg.hidden = false; msg.className = 'f-msg' + (ok ? '' : ' err');
    if (!ok) { msg.textContent = 'Merci de compléter les champs obligatoires.'; return; }
    const data = Object.fromEntries(new FormData(f));
    if (f.action && f.getAttribute('action')) {
      try { const r = await fetch(f.action, { method: 'POST', body: new FormData(f), headers: { Accept: 'application/json' } }); if (!r.ok) throw 0; f.reset(); msg.textContent = 'Merci ! Votre demande est envoyée — réponse sous 24h.'; }
      catch { msg.className = 'f-msg err'; msg.textContent = 'L’envoi a échoué. Appelez-nous au 06 10 50 89 82.'; }
      return;
    }
    const L = { prenom: 'Prénom', nom: 'Nom', telephone: 'Téléphone', email: 'Email', prestation: 'Prestation', localisation: 'Localisation', description: 'Projet' };
    const body = Object.entries(data).filter(([, v]) => v).map(([k, v]) => `${L[k] || k} : ${v}`).join('\n');
    location.href = `mailto:alpaero05@gmail.com?subject=${encodeURIComponent('Demande de devis — ' + (data.prenom || '') + ' ' + (data.nom || ''))}&body=${encodeURIComponent(body + '\n\n(Vous pouvez joindre vos photos à cet email.)')}`;
    msg.textContent = 'Votre messagerie s’ouvre avec la demande pré-remplie : il ne reste qu’à l’envoyer (et joindre vos photos).';
  }));
})();
