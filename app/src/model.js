// Construction des vues (cartes, groupes, classement du jour) à partir des données de la base + modifications en attente.
import { cardTotals, dayRanking, par3Holes, crossScore, strokesReceived } from '../../engine/engine.js';

/**
 * data : { round, course, holes[{hole_no,par,si}], groups[], participations[], players[], tees[], cards[], hole_scores[], nearest[] }
 * pending : opérations de la file (affichées tout de suite, avant l'envoi au serveur)
 */
export function buildRoundView(data, pending = []) {
  const holes = data.holes.slice().sort((a, b) => a.hole_no - b.hole_no).map(h => ({ par: h.par, si: h.si }));
  const players = new Map(data.players.map(p => [p.id, p]));
  const tees = new Map(data.tees.map(t => [t.id, t]));
  const cardByPart = new Map(data.cards.map(c => [c.participation_id, c]));

  const scoreMap = new Map(); // cardId -> 18 cases
  const slot = id => { if (!scoreMap.has(id)) scoreMap.set(id, Array.from({ length: 18 }, () => ({ strokes: null, pickup: false }))); return scoreMap.get(id); };
  for (const s of data.hole_scores) slot(s.card_id)[s.hole_no - 1] = { strokes: s.strokes, pickup: !!s.pickup };
  const statusOver = new Map(), hcpOver = new Map(), nearestOver = new Map();
  for (const op of pending) {
    if (op.type === 'score') slot(op.card)[op.hole - 1] = { strokes: op.pickup ? null : op.strokes, pickup: !!op.pickup };
    else if (op.type === 'status') statusOver.set(op.card, op.status);
    else if (op.type === 'handicap') hcpOver.set(op.participation, op);
    else if (op.type === 'nearest') nearestOver.set(op.hole, op.player);
  }

  const members = data.participations.map(pa => {
    const card = cardByPart.get(pa.id);
    const pl = players.get(pa.player_id) || { display_name: '?', is_guest: false };
    const h = hcpOver.get(pa.id);
    const hj = h ? h.playing : pa.playing_handicap;
    const scores = card ? slot(card.id) : Array.from({ length: 18 }, () => ({ strokes: null, pickup: false }));
    return {
      participationId: pa.id, playerId: pa.player_id, groupId: pa.group_id, cardId: card?.id,
      name: pl.display_name, code: pl.code, isGuest: !!pl.is_guest,
      tee: tees.get(pa.tee_id), hj, index: h ? h.index : pa.handicap_index,
      status: (card && statusOver.get(card.id)) || card?.status || 'en_cours', mode: card?.mode || 'net',
      validatedBy: card?.validated_by ? players.get(card.validated_by)?.display_name : null,
      scores, totals: cardTotals({ holes, scores, playingHandicap: hj }),
    };
  });

  // groupes (les joueurs sans groupe sont réunis dans un groupe fictif)
  const groups = data.groups.slice().sort((a, b) => a.number - b.number).map(g => ({
    id: g.id, number: g.number, teeTime: g.tee_time, markerId: g.marker_player_id,
    members: members.filter(m => m.groupId === g.id),
  }));
  const loose = members.filter(m => !m.groupId || !groups.some(g => g.id === m.groupId));
  if (loose.length) groups.push({ id: null, number: groups.length + 1, members: loose });

  const ranking = dayRanking(members.filter(m => m.totals.played > 0).map(m => ({ playerId: m.playerId, isGuest: m.isGuest, net: m.totals.net, name: m.name, played: m.totals.played })));

  const nearest = new Map(data.nearest.map(n => [n.hole_no, n.player_id]));
  for (const [h, p] of nearestOver) { if (p) nearest.set(h, p); else nearest.delete(h); }

  return { round: data.round, course: data.course, holes, members, groups, ranking, par3: par3Holes(holes.map((h, i) => ({ ...h, hole_no: i + 1 }))), nearest, players };
}

/** Le joueur fait-il partie du tirage de la journée ? (seuls ces joueurs peuvent saisir) */
export function inDraw(view, actorId) { return view.members.some(m => m.playerId === actorId); }

export function canEdit(view, actorId, member, admin = false) {
  return (admin || inDraw(view, actorId)) && !!member.cardId && member.status !== 'validee';
}

/** Validation : par un autre joueur du même groupe, carte « à vérifier » et complète. */
export function canValidate(view, actorId, member) {
  if (member.status !== 'a_verifier' || !member.totals.complete || member.playerId === actorId) return false;
  const me = view.members.find(m => m.playerId === actorId);
  if (!me) return false;
  return member.groupId == null || me.groupId === member.groupId;
}

/** Valeur affichée / proposée pour un trou : { kind: 'empty'|'score'|'pickup', value } */
export function holeState(score, par, received) {
  if (score.pickup) return { kind: 'pickup', value: null };
  if (score.strokes != null) return { kind: 'score', value: score.strokes };
  return { kind: 'empty', value: par };
}

/** Prochain score après un appui sur + ou − (la croix = ramassé). Renvoie { strokes, pickup } ou null (rien à faire). */
export function stepScore(score, par, received, dir) {
  const cross = crossScore(par, received);
  const started = score.pickup || score.strokes != null;
  const base = score.pickup ? cross : started ? score.strokes : par;
  const next = started ? base + dir : par + dir;   // trou vide : on part du par proposé
  if (next < 1) return null;
  if (next >= cross) return score.pickup ? null : { strokes: null, pickup: true };
  return { strokes: next, pickup: false };
}

export { strokesReceived, crossScore };
