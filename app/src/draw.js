// Tirage des groupes (règles reprises de l'appli Draw) : groupes de 3 ou 4, groupes imposés, départs toutes les 8 minutes, texte WhatsApp.
export const INTERVAL_MIN = 8;

/** Tailles de groupes : que des 3 et des 4. Formats : 'auto' (4 par défaut, complété par des 3), 'three', 'four'. */
export function groupSizes(n, format = 'auto') {
  if (n < 3) throw new Error('Il faut au moins 3 joueurs présents.');
  if (format === 'three') { if (n % 3) throw new Error(`Groupes de 3 : ${n} présents n'est pas divisible par 3.`); return Array(n / 3).fill(3); }
  if (format === 'four') { if (n % 4) throw new Error(`Groupes de 4 : ${n} présents n'est pas divisible par 4.`); return Array(n / 4).fill(4); }
  const r = n % 4;
  let n3 = 0, n4;
  if (r === 0) n4 = n / 4;
  else if (r === 1) { if (n < 9) throw new Error(`Impossible de faire uniquement des groupes de 3 ou 4 avec ${n} joueurs.`); n3 = 3; n4 = (n - 9) / 4; }
  else if (r === 2) { if (n < 6) throw new Error(`Impossible de faire uniquement des groupes de 3 ou 4 avec ${n} joueurs.`); n3 = 2; n4 = (n - 6) / 4; }
  else { n3 = 1; n4 = (n - 3) / 4; }
  return [...Array(n3).fill(3), ...Array(n4).fill(4)];
}

export function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

const pairKey = (a, b) => (a < b ? a + '|' + b : b + '|' + a);

/**
 * Historique des paires. draws : [ [ [id, id, id], [id, ...] ], ... ] = les tirages passés (un tirage = liste de groupes),
 * du plus ancien au plus récent. Renvoie { count(a,b), cost(a,b), draws } :
 *  cost = nombre de fois ensemble au carré (répéter 2 fois coûte plus que 2 paires différentes) + un petit malus si c'était récent.
 */
export function pairHistory(draws) {
  const count = new Map(), last = new Map();
  draws.forEach((groups, di) => groups.forEach(g => {
    for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) {
      const k = pairKey(g[i], g[j]);
      count.set(k, (count.get(k) || 0) + 1); last.set(k, di);
    }
  }));
  const n = draws.length;
  return {
    draws: n,
    count: (a, b) => count.get(pairKey(a, b)) || 0,
    cost: (a, b) => { const k = pairKey(a, b), c = count.get(k) || 0; return c ? c * c + 1 / (2 + (n - 1 - last.get(k))) : 0; },
  };
}

/** Bilan de diversité d'un tirage : paires jamais jouées ensemble, paires déjà vues, la plus répétée. */
export function diversityReport(groups, hist) {
  let pairs = 0, fresh = 0, max = 0, maxPair = null;
  for (const g of groups) for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) {
    pairs++;
    const c = hist.count(g[i], g[j]);
    if (!c) fresh++;
    if (c > max) { max = c; maxPair = [g[i], g[j]]; }
  }
  return { pairs, fresh, repeated: pairs - fresh, max, maxPair };
}

/** Fusionne les ensembles de joueurs qui se recoupent ([a,b] et [b,c] -> [a,b,c]). */
function mergeSets(sets) {
  const out = [];
  for (const set of sets) {
    const hit = out.filter(o => o.some(id => set.includes(id)));
    const merged = new Set(set);
    for (const h of hit) { h.forEach(id => merged.add(id)); out.splice(out.indexOf(h), 1); }
    out.push([...merged]);
  }
  return out;
}

/**
 * Tire les groupes au sort. Les petits groupes (3) passent en premier, les grands (4) en dernier.
 *  forced   : [[idJoueur, ...], ...] joueurs imposés dans le groupe de même numéro (les cases vides sont tirées au sort)
 *  together : [[a, b], [c, d, e], ...] joueurs à mettre dans le même groupe (n'importe lequel)
 * Retourne un tableau de groupes (listes d'identifiants).
 */
export function makeGroups(playerIds, { format = 'auto', forced = [], together = [], rng = Math.random, pairCost = null, restarts = 60 } = {}) {
  const sizes = groupSizes(playerIds.length, format);
  const present = new Set(playerIds), where = new Map();
  const groups = sizes.map(() => []);
  const room = i => sizes[i] - groups[i].length;
  forced.forEach((list, i) => {
    if (i >= sizes.length) return;
    for (const id of (list || []).filter(Boolean)) {
      if (!present.has(id)) continue;
      if (where.has(id)) throw new Error('Un joueur est imposé dans plusieurs groupes.');
      if (room(i) <= 0) throw new Error(`Groupe ${i + 1} : trop de joueurs imposés pour ${sizes[i]} places.`);
      groups[i].push(id); where.set(id, i);
    }
  });
  const sets = mergeSets(together.map(s => s.filter(id => id && present.has(id))).filter(s => s.length >= 2));
  for (const set of sets) {
    const free = set.filter(id => !where.has(id));
    const fixed = new Set(set.filter(id => where.has(id)).map(id => where.get(id)));
    if (fixed.size > 1) throw new Error('Des joueurs à mettre ensemble sont imposés dans des groupes différents.');
    let gi;
    if (fixed.size === 1) gi = [...fixed][0];
    else {
      const ok = sizes.map((_, i) => i).filter(i => room(i) >= free.length);
      if (!ok.length) throw new Error('Impossible de réunir ces joueurs dans un même groupe (plus de place).');
      gi = ok[Math.floor(rng() * ok.length)];
    }
    if (room(gi) < free.length) throw new Error(`Groupe ${gi + 1} : pas assez de place pour réunir les joueurs demandés.`);
    for (const id of free) { groups[gi].push(id); where.set(id, gi); }
  }
  const free = playerIds.filter(id => !where.has(id));
  if (pairCost && free.length > 1) {
    // Diversité : on répartit les joueurs libres pour que le moins de paires déjà vues se retrouvent ensemble
    // (plusieurs départs au hasard + échanges tant que ça améliore). Les joueurs imposés / à mettre ensemble ne bougent pas.
    const open = [];
    groups.forEach((g, i) => { for (let k = g.length; k < sizes[i]; k++) open.push(i); });
    const total = a => {
      const gs = groups.map(g => g.slice());
      open.forEach((gi, j) => gs[gi].push(a[j]));
      let c = 0;
      for (const g of gs) for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) c += pairCost(g[i], g[j]);
      return c;
    };
    let best = null, bestC = Infinity;
    for (let r = 0; r < restarts; r++) {
      const a = shuffle(free, rng);
      let c = total(a), improved = true;
      while (improved) {
        improved = false;
        for (let j = 0; j < a.length; j++) for (let k = j + 1; k < a.length; k++) {
          if (open[j] === open[k]) continue;
          [a[j], a[k]] = [a[k], a[j]];
          const c2 = total(a);
          if (c2 < c - 1e-9) { c = c2; improved = true; } else [a[j], a[k]] = [a[k], a[j]];
        }
      }
      if (c < bestC - 1e-9) { bestC = c; best = a.slice(); }
    }
    const rest = best.slice();
    groups.forEach((g, i) => { while (g.length < sizes[i]) g.push(rest.shift()); });
    return groups;
  }
  const rest = shuffle(free, rng);
  groups.forEach((g, i) => { while (g.length < sizes[i]) g.push(rest.shift()); });
  return groups;
}

export function teeTimes(start, count, interval = INTERVAL_MIN) {
  if (!Number.isInteger(+interval) || +interval < 1 || +interval > 60) throw new Error('Intervalle entre départs : 1 à 60 minutes.');
  const m = /^(\d{2}):(\d{2})$/.exec(start || '');
  if (!m || +m[1] > 23 || +m[2] > 59) throw new Error('Renseigne un 1er départ valide (HH:MM).');
  return Array.from({ length: count }, (_, i) => {
    const t = (+m[1] * 60 + +m[2] + i * +interval) % 1440;
    return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
  });
}

/** Texte à coller dans WhatsApp : une ligne par groupe, « 08:00 : A / B / C / D ». */
export function whatsappText({ dateLabel, courseName, groups, times }) {
  const head = [dateLabel && `⛳ ${courseName ? courseName + ' · ' : ''}${dateLabel}`, ''].filter(x => x !== undefined && x !== false).join('\n');
  return head + groups.map((g, i) => `${times[i]} : ${g.join(' / ')}`).join('\n');
}

export const whatsappLink = text => 'https://wa.me/?text=' + encodeURIComponent(text);

/** WhatsApp vers un numéro précis (chiffres seulement, indicatif compris : 230...). */
export const whatsappToLink = (number, text) => 'https://wa.me/' + String(number || '').replace(/\D/g, '') + '?text=' + encodeURIComponent(text);

export const SIGNATURE = 'Tanguy Le Texier\nLes Jambons';

/** Mail au golf : objet + texte avec les départs. groups : [{ time:'08:00', players:[noms] }] */
export function golfMail({ dateLabel, courseName, groups }) {
  const n = groups.reduce((a, g) => a + g.players.length, 0);
  const subject = `Les Jambons - départs du ${dateLabel}`;
  const lines = groups.map(g => `${g.time || '--:--'} : ${g.players.join(' / ')}`).join('\n');
  const body = `Bonjour,\n\nVoici le tirage des Jambons pour le ${dateLabel}${courseName ? ' (' + courseName + ')' : ''}, ${n} joueurs :\n\n${lines}\n\nMerci de nous confirmer la réception et les heures de départ.\n\nCordialement,\n${SIGNATURE}`;
  return { subject, body };
}

export const mailtoLink = ({ to, subject, body }) => `mailto:${(to || '').trim()}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

/** Code d'un nouvel invité (INV1, INV2...) sans doublon. */
export function nextGuestCode(existingCodes) {
  let n = 1;
  while (existingCodes.includes('INV' + n)) n++;
  return 'INV' + n;
}
