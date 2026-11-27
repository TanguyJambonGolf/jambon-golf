// Contenu des images de partage WhatsApp (pur, testable avec Node). Le dessin est dans share.js.
const FOOT = 'Jambon Golf · since 2019';

/** Classement du jour (joueurs et invités). view : vue de la journée (buildRoundView). */
export function prepDay(view, { dateLabel }) {
  const done = view.round.status === 'terminee';
  return {
    kind: 'board', file: 'classement-du-jour', title: 'Classement du jour', subtitle: `${dateLabel} · ${view.course.name}${done ? '' : ' · provisoire'}`,
    rows: view.ranking.rows.map(r => ({ rank: String(r.rank), name: r.name, tag: r.isGuest ? 'invité' : '', value: `${r.net} pts`, sub: r.played < 18 ? `${r.played} trous` : '', top: r.rank === 1 })),
    empty: 'Pas encore de score.', footer: FOOT,
  };
}

/** Nearest du jour : un gagnant par par 3. */
export function prepNearestDay(view, { dateLabel }) {
  const name = id => view.players.get(id)?.display_name || '?';
  return {
    kind: 'board', file: 'nearest-du-jour', title: 'Nearest du jour', subtitle: `${dateLabel} · ${view.course.name}`,
    rows: view.par3.map(h => ({ rank: 'T' + h, name: view.nearest.has(h) ? name(view.nearest.get(h)) : '—', tag: '', value: 'Par 3', sub: '', top: view.nearest.has(h), wide: true })),
    empty: 'Aucun par 3 sur ce parcours.', footer: FOOT,
  };
}

/** Classement annuel des nearest (nombre de nearest gagnés). */
export function prepNearestAnnual(Y) {
  return {
    kind: 'board', file: 'nearest-annuel', title: 'Nearest · classement annuel', subtitle: `Saison ${Y.year}`,
    rows: Y.nearest.map(r => ({ rank: String(r.rank), name: r.name, tag: '', value: `${r.wins}`, sub: r.wins > 1 ? 'nearest' : 'nearest', top: r.rank === 1 })),
    empty: 'Aucun nearest pour le moment.', footer: FOOT,
  };
}

/** Classement général annuel (cartes net validées + carte gross). */
export function prepAnnual(Y) {
  const rounds = new Set(Y.cards.filter(c => c.status === 'validee').map(c => c.roundId)).size;
  return {
    kind: 'board', file: 'classement-annuel', title: 'Classement général', subtitle: `Saison ${Y.year} · ${rounds} journée${rounds > 1 ? 's' : ''}`,
    rows: Y.ranking.filter(r => r.total > 0).map(r => ({ rank: String(r.rank), name: r.name, tag: '', value: `${r.total}`, sub: `net ${r.netTotal} · brut ${r.grossPoints}`, top: r.rank === 1 })),
    empty: 'Aucune carte validée pour le moment.', footer: `${Y.topN} meilleures cartes net + carte gross · ${FOOT}`,
  };
}

/** Tirage du jour : un bloc par groupe, avec l'heure de départ. */
export function prepDraw(view, { dateLabel }) {
  return {
    kind: 'draw', file: 'tirage-du-jour', title: 'Tirage du jour', subtitle: `${dateLabel} · ${view.course.name}`,
    groups: view.groups.map(g => ({ label: `Groupe ${g.number}`, time: g.teeTime ? String(g.teeTime).slice(0, 5) : '', players: g.members.map(m => m.name + (m.isGuest ? ' (invité)' : '')) })),
    footer: FOOT,
  };
}
