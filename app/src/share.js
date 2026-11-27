// Dessin des images de partage (canvas) et partage via la feuille de partage du téléphone (WhatsApp).
const W = 1080;
const C = { green: '#14213D', green2: '#E3146B', yellow: '#f5c542', row: '#F3E9EC', text: '#1B1F2E', mute: '#6B6672', gold: '#f5c542', silver: '#c9d2cd', bronze: '#d9a066', pinksoft: '#FBD5E3', sub: '#C9D3EA' };
const DISPLAY = '"Alfa Slab One", Rockwell, Georgia, serif';
const FONT = '-apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

let logoPromise = null;
export const loadFonts = () => (document.fonts && document.fonts.load ? document.fonts.load('40px "Alfa Slab One"').catch(() => {}) : Promise.resolve());

export function loadLogo(url = 'logo.png') {
  if (!logoPromise) logoPromise = new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = url; });
  return logoPromise;
}

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

/** Écrit un texte en réduisant la taille si besoin pour qu'il tienne dans maxW. */
function fit(ctx, text, x, y, maxW, size, weight = '600', align = 'left', family = FONT) {
  let s = size;
  ctx.font = `${weight} ${s}px ${family}`;
  while (ctx.measureText(text).width > maxW && s > 18) { s -= 2; ctx.font = `${weight} ${s}px ${family}`; }
  ctx.textAlign = align; ctx.fillText(text, x, y);
}

function header(ctx, spec, logo) {
  ctx.fillStyle = C.green; ctx.fillRect(0, 0, W, 250);
  ['#EA2839', '#1A206D', '#FFD500', '#00A551'].forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(i * W / 4, 242, W / 4 + 1, 8); });
  if (logo) {
    ctx.save(); ctx.beginPath(); ctx.arc(130, 125, 90, 0, Math.PI * 2); ctx.closePath(); ctx.fillStyle = '#fff'; ctx.fill(); ctx.clip();
    ctx.drawImage(logo, 40, 35, 180, 180); ctx.restore();
  }
  ctx.fillStyle = '#fff'; ctx.textBaseline = 'alphabetic';
  fit(ctx, spec.title, 250, 125, W - 250 - 40, 58, '400', 'left', DISPLAY);
  ctx.fillStyle = C.sub; fit(ctx, spec.subtitle, 250, 185, W - 250 - 40, 34, '500');
}

function footer(ctx, spec, y, h) {
  ctx.fillStyle = C.mute; fit(ctx, spec.footer || '', W / 2, y + h / 2 + 12, W - 80, 28, '500', 'center');
}

/** Classement (rang, nom, valeur) -> canvas. */
export function drawBoard(spec, logo, doc = document) {
  const ROW = 92, TOP = 250, PAD = 36;
  const n = Math.max(spec.rows.length, 1);
  const H = TOP + 30 + n * ROW + 30 + 90;
  const cv = doc.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  header(ctx, spec, logo);
  if (!spec.rows.length) { ctx.fillStyle = C.mute; fit(ctx, spec.empty || '', W / 2, TOP + 120, W - 80, 36, '500', 'center'); }
  spec.rows.forEach((r, i) => {
    const y = TOP + 30 + i * ROW;
    ctx.fillStyle = r.top ? C.pinksoft : i % 2 ? '#fff' : C.row; rr(ctx, PAD, y, W - 2 * PAD, ROW - 8, 18); ctx.fill();
    const med = { 1: C.gold, 2: C.silver, 3: C.bronze }[r.rank] || (r.wide ? C.green2 : '#e4ebe7');
    ctx.fillStyle = med; const bw = r.wide ? 92 : 64;
    rr(ctx, PAD + 18, y + 12, bw, 56, 28); ctx.fill();
    ctx.fillStyle = r.wide || r.rank === '1' ? (r.wide ? '#fff' : C.text) : C.text; fit(ctx, r.rank, PAD + 18 + bw / 2, y + 52, bw - 8, 32, '800', 'center');
    const nx = PAD + 18 + bw + 22, vx = W - PAD - 24;
    ctx.fillStyle = C.text; fit(ctx, r.name, nx, y + (r.tag ? 40 : 52), 520, 40, '700');
    if (r.tag) { ctx.fillStyle = C.mute; ctx.font = `500 26px ${FONT}`; ctx.textAlign = 'left'; ctx.fillText(r.tag, nx, y + 68); }
    ctx.fillStyle = C.green2; fit(ctx, r.value, vx, y + (r.sub ? 44 : 54), 240, 44, '800', 'right');
    if (r.sub) { ctx.fillStyle = C.mute; fit(ctx, r.sub, vx, y + 72, 240, 24, '500', 'right'); }
  });
  footer(ctx, spec, H - 90, 90);
  return cv;
}

/** Tirage : un bloc par groupe, joueurs sur deux colonnes. */
export function drawDraw(spec, logo, doc = document) {
  const TOP = 250, PAD = 36, GAP = 24;
  const heights = spec.groups.map(g => 78 + Math.ceil(Math.max(g.players.length, 1) / 2) * 62 + 22);
  const H = TOP + 30 + heights.reduce((a, b) => a + b + GAP, 0) + 90;
  const cv = doc.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  header(ctx, spec, logo);
  let y = TOP + 30;
  spec.groups.forEach((g, i) => {
    const h = heights[i];
    ctx.fillStyle = C.row; rr(ctx, PAD, y, W - 2 * PAD, h, 20); ctx.fill();
    ctx.fillStyle = C.green; rr(ctx, PAD, y, W - 2 * PAD, 70, 20); ctx.fill(); ctx.fillRect(PAD, y + 40, W - 2 * PAD, 30);
    ctx.fillStyle = '#fff'; fit(ctx, g.time || '—', PAD + 28, y + 52, 220, 44, '400', 'left', DISPLAY);
    ctx.fillStyle = C.sub; fit(ctx, g.label, W - PAD - 28, y + 48, 300, 34, '600', 'right');
    g.players.forEach((p, k) => {
      const col = k % 2, row = Math.floor(k / 2);
      ctx.fillStyle = C.text; fit(ctx, p, PAD + 28 + col * ((W - 2 * PAD) / 2), y + 70 + 48 + row * 62, (W - 2 * PAD) / 2 - 44, 38, '600');
    });
    y += h + GAP;
  });
  footer(ctx, spec, H - 90, 90);
  return cv;
}

export const draw = (spec, logo, doc) => (spec.kind === 'draw' ? drawDraw(spec, logo, doc) : drawBoard(spec, logo, doc));

export const toBlob = cv => new Promise(res => cv.toBlob(res, 'image/png'));

/** Partage les fichiers via la feuille de partage (WhatsApp...). Renvoie 'partage', 'annule' ou 'telechargement' (repli sur ordinateur). */
export async function shareFiles(files, text) {
  if (navigator.canShare && navigator.canShare({ files })) {
    try { await navigator.share({ files, text }); return 'partage'; }
    catch (e) { if (e && e.name === 'AbortError') return 'annule'; /* sinon : repli */ }
  }
  for (const f of files) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(f); a.download = f.name; document.body.appendChild(a); a.click(); a.remove();
  }
  return 'telechargement';
}
