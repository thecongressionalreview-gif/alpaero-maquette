/* Alp'Aero — simulateur d'aérogommage : traitement d'image (Web Worker).
   Portage navigateur du prototype Python/OpenCV (voir AEROGOMMAGE_SIMULATOR.md).
   Entrée : { id, w, h, data: ArrayBuffer RGBA, finishes: { key: [lshift, lgain, grain, a_t, b_t, chroma, gloss] } }
   Sortie : { id, ok, coverage, results: { key: ArrayBuffer RGBA } } — rien ne quitte l'appareil. */

const CFG = {
  // masque bois (convention OpenCV : H 0–179, S et V 0–255)
  hueMin: 8, hueMax: 30, satMin: 95, valMin: 95,
  hueWindow: 12,            // teinte adaptative : ± autour de la teinte dominante au centre
  shadeSatMin: 70, shadeValMin: 45, // bois à l'ombre (accepté seulement s'il touche du bois net)
  minPartFrac: 0.004,       // zones de bois gardées : ≥ 0,4 % de l'image, et ≥ 8 % de la plus grande
  centerFrac: 0.4,          // zone centrale échantillonnée (40 %)
  minCoverage: 0.12, maxCoverage: 0.92,
  refWidth: 1100,           // les rayons ci-dessous sont réglés pour 1100 px
  holeFrac: 0.001,          // trous < 0,1 % de l'image comblés
  sigmaMask: 2.5, sigmaBase: 6, sigmaBig: 40,
};

self.onmessage = (e) => {
  const { id, w, h, data, finishes } = e.data;
  try {
    const t0 = Date.now();
    const rgba = new Uint8ClampedArray(data);
    const n = w * h;
    const s = Math.max(w, h) / CFG.refWidth;

    // ---- 1. HSV + masque (teinte adaptative, repli sur la plage fixe) ----
    const H = new Uint8Array(n), S = new Uint8Array(n), V = new Uint8Array(n);
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      const r = rgba[p], g = rgba[p + 1], b = rgba[p + 2];
      const mx = r > g ? (r > b ? r : b) : (g > b ? g : b);
      const mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
      const d = mx - mn;
      V[i] = mx;
      S[i] = mx ? Math.round((d * 255) / mx) : 0;
      let hh = 0;
      if (d) {
        if (mx === r) hh = 60 * (g - b) / d;
        else if (mx === g) hh = 120 + 60 * (b - r) / d;
        else hh = 240 + 60 * (r - g) / d;
        if (hh < 0) hh += 360;
      }
      H[i] = Math.round(hh / 2) % 180;
    }
    // teinte de référence : dominante au centre de l'image (tons bois, du rouge au jaune, en tenant
    // compte du bouclage 179 → 0), sinon plage fixe 8–30
    let hue0 = (CFG.hueMin + CFG.hueMax) / 2, win = (CFG.hueMax - CFG.hueMin) / 2;
    {
      const hist = new Uint32Array(180);
      const x0 = Math.floor(w * (1 - CFG.centerFrac) / 2), x1 = w - x0;
      const y0 = Math.floor(h * (1 - CFG.centerFrac) / 2), y1 = h - y0;
      let cnt = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const i = y * w + x;
        if (S[i] > CFG.satMin && V[i] > CFG.valMin) { hist[H[i]]++; cnt++; }
      }
      if (cnt > (x1 - x0) * (y1 - y0) * 0.02) {
        let best = -1, bestV = 0;
        for (let k = 0; k <= 40; k++) {              // tons bois : rouge-orangé (0) → jaune (40)
          let v = 0; for (let j = -3; j <= 3; j++) v += hist[(k + j + 360) % 180];
          if (v > bestV) { bestV = v; best = k; }
        }
        if (best > -99) { hue0 = best; win = CFG.hueWindow; }
      }
    }
    // pas de bouclage vers 179 : les roses et magentas (tissus) ne sont jamais du bois
    const hueOk = (hh, extra) => hh <= 45 && Math.abs(hh - hue0) <= win + extra;

    // noyau : bois net et lumineux ; extension : bois à l'ombre, gardé seulement s'il touche le noyau
    const core = new Uint8Array(n), ext = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (S[i] > CFG.satMin && V[i] > CFG.valMin && hueOk(H[i], 0)) core[i] = 1;
      if (S[i] > CFG.shadeSatMin && V[i] > CFG.shadeValMin && hueOk(H[i], 4)) ext[i] = 1;
    }
    let m = hysteresis(ext, core, w, h);
    m = dilate(erode(m, w, h, 5), w, h, 5);      // ouverture 5×5
    m = erode(dilate(m, w, h, 7), w, h, 7);      // fermeture 7×7
    // un chalet = plusieurs zones de bois (façade, balcon, volets) : on garde toutes les grandes zones
    m = bigComponents(m, w, h, CFG.minPartFrac);
    fillHoles(m, w, h, Math.round(n * CFG.holeFrac));
    m = erode(m, w, h, 3);

    let covered = 0; for (let i = 0; i < n; i++) covered += m[i];
    const coverage = covered / n;
    if (coverage < CFG.minCoverage || coverage > CFG.maxCoverage) {
      self.postMessage({ id, ok: false, coverage });
      return;
    }
    const alpha = new Float32Array(n);
    for (let i = 0; i < n; i++) alpha[i] = m[i];
    gaussBlur(alpha, w, h, CFG.sigmaMask * s);

    // ---- 2. Lab + décomposition de la luminance ----
    const L = new Float32Array(n), A = new Float32Array(n), B = new Float32Array(n);
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      const lab = rgb2lab(rgba[p], rgba[p + 1], rgba[p + 2]);
      L[i] = lab[0]; A[i] = lab[1]; B[i] = lab[2];
    }
    const base = L.slice(); gaussBlur(base, w, h, CFG.sigmaBase * s);
    const big = L.slice(); gaussBlur(big, w, h, CFG.sigmaBig * s);
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) { num += big[i] * alpha[i]; den += alpha[i]; }
    const mean = den ? num / den : 50;

    // ---- 3. Finitions ----
    const results = {}, transfer = [];
    for (const [key, f] of Object.entries(finishes)) {
      const [lshift, lgain, grain, at, bt, chroma, gloss, target] = f;
      // teinte finale : décalage relatif, ramené vers une luminance cible réaliste pour la finition
      // (un vernis très foncé doit vraiment s’éclaircir en « brut »)
      const newMean = target == null ? mean + lshift : 0.35 * (mean + lshift) + 0.65 * target;
      const out = new Uint8ClampedArray(n * 4);
      for (let i = 0, p = 0; i < n; i++, p += 4) {
        const a = alpha[i];
        if (a < 0.002) { out[p] = rgba[p]; out[p + 1] = rgba[p + 1]; out[p + 2] = rgba[p + 2]; out[p + 3] = 255; continue; }
        const Lb = mean + (big[i] - mean) * gloss + (base[i] - big[i]) * 0.9;
        let Ln = (Lb - mean) * lgain + newMean + (L[i] - base[i]) * grain;
        Ln = Ln < 0 ? 0 : Ln > 100 ? 100 : Ln;
        const rgb = lab2rgb(Ln, A[i] * chroma + at, B[i] * chroma + bt);
        out[p] = rgb[0] * a + rgba[p] * (1 - a);
        out[p + 1] = rgb[1] * a + rgba[p + 1] * (1 - a);
        out[p + 2] = rgb[2] * a + rgba[p + 2] * (1 - a);
        out[p + 3] = 255;
      }
      results[key] = out.buffer; transfer.push(out.buffer);
    }
    self.postMessage({ id, ok: true, coverage, ms: Date.now() - t0, results }, transfer);
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err && err.message || err) });
  }
};

/* ---------- morphologie binaire (élément carré k×k, séparable) ---------- */
function boxCount(m, w, h, k) {
  const r = k >> 1, tmp = new Uint16Array(w * h), out = new Uint16Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w; let acc = 0;
    for (let x = -r; x <= r; x++) if (x >= 0 && x < w) acc += m[row + x];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc;
      const add = x + r + 1, rem = x - r;
      if (add < w) acc += m[row + add];
      if (rem >= 0) acc -= m[row + rem];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) if (y >= 0 && y < h) acc += tmp[y * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc;
      const add = y + r + 1, rem = y - r;
      if (add < h) acc += tmp[add * w + x];
      if (rem >= 0) acc -= tmp[rem * w + x];
    }
  }
  return out;
}
function erode(m, w, h, k) {
  const c = boxCount(m, w, h, k), o = new Uint8Array(w * h), r = k >> 1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    // aux bords, la fenêtre est tronquée : on compare au nombre de pixels réellement couverts
    const ww = Math.min(x + r, w - 1) - Math.max(x - r, 0) + 1, hh = Math.min(y + r, h - 1) - Math.max(y - r, 0) + 1;
    o[y * w + x] = c[y * w + x] === ww * hh ? 1 : 0;
  }
  return o;
}
function dilate(m, w, h, k) {
  const c = boxCount(m, w, h, k), o = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) o[i] = c[i] > 0 ? 1 : 0;
  return o;
}

/* ---------- composantes connexes ---------- */
function label(m, w, h, val) {
  // étiquette les pixels == val (8-connexité), renvoie [labels, tailles, touche le bord]
  const lab = new Int32Array(w * h), sizes = [0], border = [false], stack = new Int32Array(w * h);
  let next = 1;
  for (let i = 0; i < w * h; i++) {
    if (m[i] !== val || lab[i]) continue;
    let sp = 0, size = 0, edge = false; stack[sp++] = i; lab[i] = next;
    while (sp) {
      const j = stack[--sp], x = j % w, y = (j / w) | 0; size++;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) edge = true;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy; if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx; if (xx < 0 || xx >= w) continue;
          const q = yy * w + xx;
          if (m[q] === val && !lab[q]) { lab[q] = next; stack[sp++] = q; }
        }
      }
    }
    sizes.push(size); border.push(edge); next++;
  }
  return [lab, sizes, border];
}
function bigComponents(m, w, h, minFrac) {
  const [lab, sizes] = label(m, w, h, 1);
  let big = 0; for (let k = 1; k < sizes.length; k++) if (sizes[k] > big) big = sizes[k];
  const min = Math.max(w * h * minFrac, big * 0.08);
  const keep = sizes.map((s, k) => k > 0 && s >= min);
  const o = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) o[i] = keep[lab[i]] ? 1 : 0;
  return o;
}
// garde les zones de « ext » qui contiennent au moins un pixel de « core »
function hysteresis(ext, core, w, h) {
  const [lab, sizes] = label(ext, w, h, 1);
  const hit = new Uint8Array(sizes.length);
  for (let i = 0; i < w * h; i++) if (core[i] && lab[i]) hit[lab[i]] = 1;
  const o = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) o[i] = hit[lab[i]] ? 1 : 0;
  return o;
}
function fillHoles(m, w, h, maxArea) {
  const [lab, sizes, border] = label(m, w, h, 0);
  for (let i = 0; i < w * h; i++) { const k = lab[i]; if (k && !border[k] && sizes[k] < maxArea) m[i] = 1; }
}

/* ---------- flou gaussien ≈ 3 flous boîte (séparables) ---------- */
function boxesForGauss(sigma, nb) {
  const wIdeal = Math.sqrt((12 * sigma * sigma / nb) + 1);
  let wl = Math.floor(wIdeal); if (wl % 2 === 0) wl--;
  const wu = wl + 2, mIdeal = (12 * sigma * sigma - nb * wl * wl - 4 * nb * wl - 3 * nb) / (-4 * wl - 4);
  const mm = Math.round(mIdeal), sizes = [];
  for (let i = 0; i < nb; i++) sizes.push(i < mm ? wl : wu);
  return sizes;
}
function gaussBlur(src, w, h, sigma) {
  if (sigma < 0.5) return;
  const tmp = new Float32Array(src.length);
  const rMax = ((Math.min(w, h) - 1) >> 1) - 1;
  for (const b of boxesForGauss(sigma, 3)) {
    const r = Math.max(0, Math.min((b - 1) >> 1, rMax));
    boxH(src, tmp, w, h, r); boxV(tmp, src, w, h, r);
  }
}
function boxH(s, t, w, h, r) {
  const iarr = 1 / (r + r + 1);
  for (let y = 0; y < h; y++) {
    let ti = y * w, li = ti, ri = ti + r;
    const fv = s[ti], lv = s[ti + w - 1];
    let val = (r + 1) * fv;
    for (let j = 0; j < r; j++) val += s[ti + Math.min(j, w - 1)];
    for (let j = 0; j <= r; j++) { val += (ri < y * w + w ? s[ri] : lv) - fv; t[ti++] = val * iarr; ri++; }
    for (let j = r + 1; j < w - r; j++) { val += s[ri++] - s[li++]; t[ti++] = val * iarr; }
    for (let j = w - r; j < w; j++) { val += lv - s[li++]; t[ti++] = val * iarr; }
  }
}
function boxV(s, t, w, h, r) {
  const iarr = 1 / (r + r + 1);
  for (let x = 0; x < w; x++) {
    let ti = x, li = ti, ri = ti + r * w;
    const fv = s[ti], lv = s[ti + w * (h - 1)];
    let val = (r + 1) * fv;
    for (let j = 0; j < r; j++) val += s[ti + Math.min(j, h - 1) * w];
    for (let j = 0; j <= r; j++) { val += (ri < w * h ? s[ri] : lv) - fv; t[ti] = val * iarr; ri += w; ti += w; }
    for (let j = r + 1; j < h - r; j++) { val += s[ri] - s[li]; t[ti] = val * iarr; li += w; ri += w; ti += w; }
    for (let j = h - r; j < h; j++) { val += lv - s[li]; t[ti] = val * iarr; li += w; ti += w; }
  }
}

/* ---------- sRGB <-> CIE Lab (D65), comme OpenCV en flottant ---------- */
const LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) { const c = i / 255; LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
const GAM = new Uint8Array(4097);
for (let i = 0; i <= 4096; i++) { const c = i / 4096; GAM[i] = Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055)); }
const XN = 0.950456, ZN = 1.088754, E = 216 / 24389, K = 24389 / 27;
const fLab = (t) => (t > E ? Math.cbrt(t) : (K * t + 16) / 116);
function rgb2lab(r8, g8, b8) {
  const r = LIN[r8], g = LIN[g8], b = LIN[b8];
  const x = (0.412453 * r + 0.357580 * g + 0.180423 * b) / XN;
  const y = 0.212671 * r + 0.715160 * g + 0.072169 * b;
  const z = (0.019334 * r + 0.119193 * g + 0.950227 * b) / ZN;
  const fx = fLab(x), fy = fLab(y), fz = fLab(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
const OUT = [0, 0, 0];
function lab2rgb(L, a, b) {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  const inv = (f) => { const f3 = f * f * f; return f3 > E ? f3 : (116 * f - 16) / K; };
  const x = inv(fx) * XN, y = L > K * E ? fy * fy * fy : L / K, z = inv(fz) * ZN;
  const rl = 3.240479 * x - 1.537150 * y - 0.498535 * z;
  const gl = -0.969256 * x + 1.875992 * y + 0.041556 * z;
  const bl = 0.055648 * x - 0.204043 * y + 1.057311 * z;
  const q = (v) => GAM[(v <= 0 ? 0 : v >= 1 ? 4096 : (v * 4096 + 0.5) | 0)];
  OUT[0] = q(rl); OUT[1] = q(gl); OUT[2] = q(bl);
  return OUT;
}
