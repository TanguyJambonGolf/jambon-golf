// Moteur de calcul - Appli Golf (aucune dépendance, utilisable dans le navigateur et avec Node).
// Toutes les règles de scoring sont ici et nulle part ailleurs ; la base ne stocke que des données brutes.

export const DEFAULTS = { topN: 9, guestLimit: 4 };

/** Arrondi à l'entier le plus proche, .5 vers le haut (règle de la Fédération mauricienne). */
export function roundHalfUp(x) {
  return Math.floor(x + 0.5 + 1e-9);
}

/** Handicap de jeu = index x slope / 113 + (CR - par), arrondi une seule fois à la fin. */
export function playingHandicap({ index, slope, cr, par }) {
  return roundHalfUp((index * slope) / 113 + (cr - par));
}

/**
 * Coups reçus sur un trou, selon le handicap de jeu et l'index du trou (1 = le plus dur).
 * HJ négatif (handicap "plus") : coups rendus (valeur négative) sur les trous d'index les plus élevés.
 */
export function strokesReceived(hj, si) {
  if (hj >= 0) {
    const base = Math.floor(hj / 18);
    const rem = hj % 18;
    return base + (si <= rem ? 1 : 0);
  }
  const n = -hj;
  const base = Math.floor(n / 18);
  const rem = n % 18;
  return 0 - (base + (si > 18 - rem ? 1 : 0)); // 0 - x évite le zéro négatif (-0)
}

/** Points Stableford d'un trou. Trou non joué ou ramassé : 0 point. */
export function holePoints({ par, strokes, pickup = false, received = 0 }) {
  if (pickup || strokes == null) return 0;
  return Math.max(0, 2 + par + received - strokes);
}

/** Premier score qui ne rapporte plus aucun point net : celui qui porte la croix. */
export function crossScore(par, received) {
  return Math.max(1, par + 2 + received);
}

/**
 * Choix proposés au marqueur pour un trou : de 1 jusqu'à la croix (qui signifie "ramassé").
 * `default` marque le par, proposé d'office.
 */
export function scoreOptions(par, received) {
  const cross = crossScore(par, received);
  const opts = [];
  for (let s = 1; s < cross; s++) {
    opts.push({ score: s, points: holePoints({ par, strokes: s, received }), isDefault: s === par });
  }
  opts.push({ score: cross, points: 0, cross: true, isDefault: cross === par });
  return opts;
}

/**
 * Totaux d'une carte.
 * holes  : [{ par, si }] x 18 (dans l'ordre des trous)
 * scores : [{ strokes, pickup }] x 18 (strokes null et pickup faux = trou pas encore joué)
 * Retourne les points net (avec coups reçus) et gross (sans coups reçus).
 */
export function cardTotals({ holes, scores, playingHandicap: hj }) {
  let net = 0, gross = 0, strokesTotal = 0, played = 0;
  const perHole = holes.map((h, i) => {
    const s = scores[i] || { strokes: null, pickup: false };
    const received = strokesReceived(hj, h.si);
    const done = s.pickup || s.strokes != null;
    const n = holePoints({ par: h.par, strokes: s.strokes, pickup: s.pickup, received });
    const g = holePoints({ par: h.par, strokes: s.strokes, pickup: s.pickup, received: 0 });
    net += n;
    gross += g;
    if (done) played++;
    if (!s.pickup && s.strokes != null) strokesTotal += s.strokes;
    return { hole: i + 1, par: h.par, si: h.si, received, strokes: s.strokes ?? null, pickup: !!s.pickup, net: n, gross: g, done };
  });
  return { net, gross, strokesTotal, played, complete: played === holes.length, perHole };
}

/** Classement avec ex aequo (1, 2, 2, 4...). `keyFn` renvoie un tableau de valeurs, comparées de la plus grande à la plus petite. */
function rankRows(rows, keyFn) {
  const cmp = (a, b) => {
    const ka = keyFn(a), kb = keyFn(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return kb[i] - ka[i];
    return 0;
  };
  const sorted = rows.slice().sort(cmp);
  sorted.forEach((r, i) => {
    r.rank = i > 0 && cmp(sorted[i - 1], r) === 0 ? sorted[i - 1].rank : i + 1;
  });
  return sorted;
}

/**
 * Classement du jour : joueurs ET invités, par points net.
 * entries : [{ playerId, isGuest, net }]
 */
export function dayRanking(entries) {
  const rows = entries.map((e) => ({ ...e }));
  const ranked = rankRows(rows, (r) => [r.net]);
  return { rows: ranked, winners: ranked.filter((r) => r.rank === 1) };
}

/**
 * Remplace (ou désigne) la carte gross d'un joueur. Fonction pure : renvoie un nouveau tableau de cartes.
 * La carte basculée en gross sort définitivement du net. L'ancienne carte gross est marquée "remplacée"
 * et ne revient JAMAIS dans le net, même si elle est meilleure que d'autres cartes.
 */
export function setGrossCard(cards, playerId, newCardId) {
  const target = cards.find((c) => c.id === newCardId);
  if (!target || target.playerId !== playerId) throw new Error("Carte inconnue pour ce joueur");
  if (target.replaced) throw new Error("Une carte remplacée ne peut pas redevenir la carte gross");
  return cards.map((c) => {
    if (c.playerId !== playerId) return c;
    if (c.id === newCardId) return { ...c, mode: "gross", excludedFromNet: true, replaced: false };
    if (c.mode === "gross" && !c.replaced) return { ...c, replaced: true, excludedFromNet: true };
    return c;
  });
}

/**
 * Classement annuel (joueurs réguliers uniquement, jamais les invités).
 * players : [{ id, name, isGuest }]
 * cards   : [{ id, playerId, date, status, mode, excludedFromNet, replaced, net, gross }]
 * Total = somme des `topN` meilleures cartes net validées + points gross de la carte gross validée.
 * Départage : meilleure carte nette, puis points gross.
 */
export function annualRanking(players, cards, { topN = DEFAULTS.topN } = {}) {
  const rows = players
    .filter((p) => !p.isGuest)
    .map((p) => {
      const mine = cards.filter((c) => c.playerId === p.id && c.status === "validee");
      const netPool = mine
        .filter((c) => c.mode === "net" && !c.excludedFromNet && !c.replaced)
        .sort((a, b) => b.net - a.net || (a.date < b.date ? -1 : 1));
      const counted = netPool.slice(0, topN);
      const grossCard =
        mine.filter((c) => c.mode === "gross" && !c.replaced).sort((a, b) => (a.date < b.date ? 1 : -1))[0] || null;
      const netTotal = counted.reduce((s, c) => s + c.net, 0);
      const grossPoints = grossCard ? grossCard.gross : 0;
      return {
        playerId: p.id,
        name: p.name,
        netCards: counted,
        netTotal,
        grossCard,
        grossPoints,
        total: netTotal + grossPoints,
        bestNet: netPool.length ? netPool[0].net : 0,
      };
    });
  return rankRows(rows, (r) => [r.total, r.bestNet, r.grossPoints]);
}

/**
 * Suivi des invités : nombre de journées jouées dans l'année et plafond (4 par an par défaut).
 * participations : [{ guestId, roundId, date }] ; seules les journées distinctes comptent.
 */
export function guestStatus(participations, guestId, year, limit = DEFAULTS.guestLimit) {
  const rounds = new Set(
    participations
      .filter((p) => p.guestId === guestId && String(p.date).slice(0, 4) === String(year))
      .map((p) => p.roundId)
  );
  const count = rounds.size;
  return { count, limit, remaining: Math.max(0, limit - count), atLimit: count >= limit, exceeded: count > limit };
}

/** Numéros des par 3 d'un parcours (les trous concernés par les nearest). */
export function par3Holes(holes) {
  return holes.map((h, i) => (h.par === 3 ? i + 1 : null)).filter((x) => x !== null);
}

/**
 * Classement des nearest (jour ou annuel selon les entrées fournies) : nombre de nearest gagnés.
 * Les invités ne concourent pas. entries : [{ roundId, holeNo, playerId, isGuest }]
 */
export function nearestRanking(entries) {
  const counts = new Map();
  for (const e of entries) {
    if (e.isGuest) continue;
    counts.set(e.playerId, (counts.get(e.playerId) || 0) + 1);
  }
  const rows = [...counts].map(([playerId, wins]) => ({ playerId, wins }));
  return rankRows(rows, (r) => [r.wins]);
}

/** Contrôle d'un parcours : 18 trous, index = permutation de 1 à 18. Renvoie la liste des erreurs. */
export function validateCourse(course) {
  const errs = [];
  if (course.par.length !== 18 || course.si.length !== 18) errs.push("18 trous attendus");
  const sorted = [...course.si].sort((a, b) => a - b);
  if (sorted.some((v, i) => v !== i + 1)) errs.push("index non valide (doit contenir 1 à 18 une seule fois)");
  return errs;
}
