/* Alp'Aero — simulateur d'aérogommage (interface). Chargé à la demande quand la section approche.
   La photo est traitée sur l'appareil (Web Worker) : rien n'est envoyé. */
(() => {
  /* Finitions : Nico peut en ajouter, renommer ou retirer ici, sans toucher à l'algorithme.
     Réglages : [lshift, lgain, grain, a_t, b_t, chroma, gloss, luminance cible 0–100] (voir simu-worker.js). */
  const FINITIONS = {
    brut:    { label: 'Brut aérogommé',       sub: 'Chêne nu, sans finition',   swatch: '#cdbfa6', f: [8, 0.9, 1.45, 3, 15, 0.25, 0.55, 64] },
    huile:   { label: 'Huile naturelle mate', sub: 'Huile-cire incolore mate',  swatch: '#b9976c', f: [3, 1.0, 1.35, 4.5, 15, 0.30, 0.75, 57] },
    blanchi: { label: 'Chêne blanchi',        sub: 'Huile teintée blanche',     swatch: '#d9d3c6', f: [14, 0.8, 1.30, 1, 8, 0.12, 0.50, 72] },
    fonce:   { label: 'Huile teintée foncée', sub: 'Aspect fumé / foncé',       swatch: '#6e553f', f: [-22, 1.0, 1.25, 5, 10, 0.28, 0.80, 34] },
  };
  const DEFAUT = 'brut';
  const MAX_EDGE = 1400;

  const roots = [...document.querySelectorAll('[data-simu]')];
  if (!roots.length) return;
  const worker = new Worker(roots[0].dataset.worker);
  let seq = 0; // identifiants de travaux, partagés entre les simulateurs (un seul worker)
  roots.forEach(init);

  function init(root) {
  if (root.dataset.ready) return; root.dataset.ready = 1;
  const $ = (s) => root.querySelector(s);
  const stage = $('.ba-stage'), before = $('.simu-before'), after = $('.simu-after'), line = $('.ba-line');
  const input = $('input[type=file]'), status = $('.simu-status'), cta = $('.simu-cta'), grid = $('.simu-fin');
  let urls = {}, current = DEFAUT, job = 0, source = 'demo';

  /* boutons de finition */
  grid.innerHTML = Object.entries(FINITIONS).map(([k, v]) =>
    `<button type="button" data-k="${k}" aria-pressed="${k === current}"><i style="background:${v.swatch}"></i><span><b>${v.label}</b><small>${v.sub}</small></span></button>`).join('');
  grid.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) choose(b.dataset.k); });
  function choose(k) {
    current = k;
    grid.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.k === k)));
    if (urls[k]) after.src = urls[k];
    const u = new URL(cta.getAttribute('href'), location.href);
    u.searchParams.set('finition', FINITIONS[k].label); u.searchParams.set('simulation', source);
    if (root.dataset.prestation) u.searchParams.set('prestation', root.dataset.prestation);
    cta.href = u.pathname + u.search;
    cta.querySelector('span').textContent = 'Demander un devis pour cette finition';
  }

  /* curseur avant / après (pointeur, tactile, clavier) */
  let pos = 50, drag = false;
  const set = (p) => { pos = Math.max(0, Math.min(100, p)); stage.style.setProperty('--pos', pos + '%'); line.setAttribute('aria-valuenow', Math.round(pos)); };
  const fromEvent = (e) => { const r = stage.getBoundingClientRect(); return ((e.clientX - r.left) / r.width) * 100; };
  stage.addEventListener('pointerdown', (e) => { drag = true; stage.setPointerCapture(e.pointerId); set(fromEvent(e)); });
  stage.addEventListener('pointermove', (e) => { if (drag) set(fromEvent(e)); });
  ['pointerup', 'pointercancel'].forEach((t) => stage.addEventListener(t, () => { drag = false; }));
  line.addEventListener('keydown', (e) => {
    const d = { ArrowLeft: -5, ArrowRight: 5, Home: -100, End: 100 }[e.key];
    if (d !== undefined) { e.preventDefault(); set(pos + d); }
  });
  set(50);

  /* traitement */
  const say = (msg, kind) => { status.textContent = msg || ''; status.hidden = !msg; status.className = 'simu-status' + (kind ? ' is-' + kind : ''); };
  function load(src) {
    return new Promise((ok, ko) => { const im = new Image(); im.decoding = 'async'; im.onload = () => ok(im); im.onerror = ko; im.src = src; });
  }
  async function run(src, kind) {
    const id = ++seq; job = id;
    root.classList.add('is-busy');
    say(kind === 'photo' ? 'Simulation en cours…' : '');
    let im;
    try { im = await load(src); } catch (e) {
      root.classList.remove('is-busy');
      say('Cette photo n’a pas pu être ouverte. Essayez une photo JPEG ou PNG.', 'err'); return;
    }
    // <img> applique l'orientation EXIF : la photo s'affiche dans le bon sens
    const k = Math.min(1, MAX_EDGE / Math.max(im.naturalWidth, im.naturalHeight));
    const w = Math.round(im.naturalWidth * k), h = Math.round(im.naturalHeight * k);
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(im, 0, 0, w, h);
    const px = cx.getImageData(0, 0, w, h);
    const finishes = Object.fromEntries(Object.entries(FINITIONS).map(([k2, v]) => [k2, v.f]));
    const res = await new Promise((ok) => {
      const onMsg = (e) => { if (e.data.id === id) { worker.removeEventListener('message', onMsg); ok(e.data); } };
      worker.addEventListener('message', onMsg);
      worker.postMessage({ id, w, h, data: px.data.buffer, finishes }, [px.data.buffer]);
    });
    if (id !== job) return;
    root.classList.remove('is-busy');
    if (!res.ok) {
      say(res.error ? 'La simulation a échoué sur cet appareil. Envoyez-nous simplement votre photo avec la demande de devis.'
        : 'Nous n’avons pas bien détecté le bois sur cette photo. Essayez de plus près, avec un bon éclairage.', 'err');
      return;
    }
    const next = {};
    for (const [k2, buf] of Object.entries(res.results)) {
      cx.putImageData(new ImageData(new Uint8ClampedArray(buf), w, h), 0, 0);
      const blob = await new Promise((ok) => cv.toBlob(ok, 'image/jpeg', 0.86));
      next[k2] = URL.createObjectURL(blob);
    }
    Object.values(urls).forEach((u) => URL.revokeObjectURL(u));
    urls = next; source = kind;
    stage.style.setProperty('--ar', `${w}/${h}`);
    root.style.setProperty('--ar', `${w}/${h}`);
    before.src = src; if (kind === 'photo') { before.alt = 'Votre photo, avant'; after.alt = 'Votre photo, simulation après décapage'; }
    choose(current);
    root.classList.toggle('is-photo', kind === 'photo');
    say(kind === 'photo' ? 'Faites glisser le curseur pour comparer, puis choisissez une finition.' : '');
    if (window.dataLayer && kind === 'photo') try { dataLayer.push({ event: 'simulation_photo' }); } catch (e) {}
  }

  input.addEventListener('change', () => {
    const f = input.files && input.files[0];
    if (!f) return;
    if (!/^image\//.test(f.type) && !/\.(jpe?g|png|webp|heic|heif)$/i.test(f.name)) { say('Choisissez une photo (JPEG, PNG…).', 'err'); return; }
    run(URL.createObjectURL(f), 'photo');
    input.value = '';
  });

  run(root.dataset.demo, 'demo');
  }
})();
