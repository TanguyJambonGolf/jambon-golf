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
export function makeGroups(playerIds, { format = 'auto', forced = [], together = [], rng = Math.random } = {}) {
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
  const rest = shuffle(playerIds.filter(id => !where.has(id)), rng);
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

/** Code d'un nouvel invité (INV1, INV2...) sans doublon. */
export function nextGuestCode(existingCodes) {
  let n = 1;
  while (existingCodes.includes('INV' + n)) n++;
  return 'INV' + n;
}
