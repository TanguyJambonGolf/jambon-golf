// Données de l'année : classement annuel, fiches joueur, nearest annuel, suivi des invités. Pur, testable avec Node.
import { cardTotals, annualRanking, nearestRanking, guestStatus, DEFAULTS } from '../../engine/engine.js';

/**
 * data : { rounds[], participations[], cards[], hole_scores[], holes[], tees[], nearest[], settings[] }
 * players : liste des joueurs (réguliers et invités)
 */
export function buildYear(data, players, year) {
  const pl = new Map(players.map(p => [p.id, p]));
  const holesBy = new Map();
  for (const h of data.holes) { if (!holesBy.has(h.course_id)) holesBy.set(h.course_id, []); holesBy.get(h.course_id).push(h); }
  for (const [, l] of holesBy) l.sort((a, b) => a.hole_no - b.hole_no);
  const roundOf = new Map(data.rounds.map(r => [r.id, r]));
  const partOf = new Map(data.participations.map(p => [p.id, p]));
  const scoresBy = new Map();
  for (const s of data.hole_scores) {
    if (!scoresBy.has(s.card_id)) scoresBy.set(s.card_id, Array.from({ length: 18 }, () => ({ strokes: null, pickup: false })));
    scoresBy.get(s.card_id)[s.hole_no - 1] = { strokes: s.strokes, pickup: !!s.pickup };
  }
  const set = Object.fromEntries((data.settings || []).map(s => [s.key, s.value]));
  const topN = Number(set.top_n ?? DEFAULTS.topN), guestLimit = Number(set.guest_limit ?? DEFAULTS.guestLimit);

  const cards = [];
  for (const c of data.cards) {
    const pa = partOf.get(c.participation_id); if (!pa) continue;
    const r = roundOf.get(pa.round_id); if (!r || String(r.played_on).slice(0, 4) !== String(year)) continue;
    const course = holesBy.get(r.course_id) || [];
    const t = cardTotals({ holes: course.map(h => ({ par: h.par, si: h.si })), scores: scoresBy.get(c.id) || [], playingHandicap: pa.playing_handicap });
    cards.push({
      id: c.id, playerId: pa.player_id, roundId: r.id, courseId: r.course_id, date: r.played_on, status: c.status, mode: c.mode,
      excludedFromNet: !!c.excluded_from_net, replaced: !!c.replaced, net: t.net, gross: t.gross, strokes: t.strokesTotal, played: t.played,
      hj: pa.playing_handicap, index: pa.handicap_index,
    });
  }
  // Historique importé de l'ancienne appli : un score Stableford par joueur et par journée, sans détail trou par trou
  for (const h of data.history_scores || []) {
    if (String(h.played_on).slice(0, 4) !== String(year)) continue;
    const net = h.kind === 'net';
    cards.push({
      id: 'h-' + h.id, playerId: h.player_id, roundId: null, courseId: null, date: h.played_on, status: 'validee', mode: net ? 'net' : 'gross',
      excludedFromNet: !net, replaced: false, net: net ? h.points : 0, gross: net ? 0 : h.points, strokes: 0, played: 18, hj: null, index: null, imported: true,
    });
  }
  const ranking = annualRanking(players.map(p => ({ id: p.id, name: p.display_name, isGuest: p.is_guest })), cards, { topN });

  const nearestEntries = data.nearest.filter(n => roundOf.has(n.round_id) && String(roundOf.get(n.round_id).played_on).slice(0, 4) === String(year))
    .map(n => ({ roundId: n.round_id, holeNo: n.hole_no, playerId: n.player_id, isGuest: !!pl.get(n.player_id)?.is_guest }))
    .concat((data.history_nearest || []).filter(n => String(n.played_on).slice(0, 4) === String(year))
      .map(n => ({ roundId: 'h-' + n.played_on, holeNo: n.seq, playerId: n.player_id, isGuest: false })));
  const nearest = nearestRanking(nearestEntries).map(r => ({ ...r, name: pl.get(r.playerId)?.display_name }));

  const guestParts = data.participations.filter(p => pl.get(p.player_id)?.is_guest && roundOf.has(p.round_id))
    .map(p => ({ guestId: p.player_id, roundId: p.round_id, date: roundOf.get(p.round_id).played_on }));
  const guests = players.filter(p => p.is_guest).map(g => ({ player: g, ...guestStatus(guestParts, g.id, year, guestLimit) })).filter(g => g.count > 0);

  return { year, topN, guestLimit, cards, ranking, nearest, guests };
}

/** Fiche d'un joueur : cartes de l'année (les plus récentes d'abord), cartes retenues, moyenne, meilleure carte. */
export function playerSheet(year, playerId) {
  const mine = year.cards.filter(c => c.playerId === playerId).sort((a, b) => (a.date < b.date ? 1 : -1));
  const row = year.ranking.find(r => r.playerId === playerId);
  const counted = new Set((row?.netCards || []).map(c => c.id));
  const valid = mine.filter(c => c.status === 'validee');
  const netCards = valid.filter(c => c.mode === 'net' && !c.excludedFromNet && !c.replaced);
  return {
    row, counted, cards: mine,
    average: netCards.length ? Math.round((netCards.reduce((s, c) => s + c.net, 0) / netCards.length) * 10) / 10 : null,
    best: netCards.length ? Math.max(...netCards.map(c => c.net)) : null,
    // plus bas score retenu = la carte à battre pour progresser (seulement quand les N cartes retenues sont complètes)
    lowestCounted: row && row.netCards.length >= year.topN ? Math.min(...row.netCards.map(c => c.net)) : null,
    topN: year.topN,
    pending: mine.filter(c => c.status !== 'validee' && c.played > 0).length,
  };
}
