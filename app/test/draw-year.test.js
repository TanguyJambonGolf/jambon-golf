import test from 'node:test';
import assert from 'node:assert/strict';
import { groupSizes, makeGroups, teeTimes, whatsappText, nextGuestCode, whatsappLink } from '../src/draw.js';
import { buildYear, playerSheet } from '../src/year.js';

test('tirage : tailles de groupes (3 ou 4 seulement)', () => {
  assert.deepEqual(groupSizes(8), [4, 4]);
  assert.deepEqual(groupSizes(9), [3, 3, 3]);
  assert.deepEqual(groupSizes(10), [3, 3, 4]);
  assert.deepEqual(groupSizes(11), [3, 4, 4]);
  assert.deepEqual(groupSizes(21), [3, 3, 3, 4, 4, 4]);
  assert.deepEqual(groupSizes(12, 'three'), [3, 3, 3, 3]);
  assert.throws(() => groupSizes(5));
  assert.throws(() => groupSizes(10, 'four'));
  for (let n = 6; n <= 30; n++) { if (n === 7) continue; const s = groupSizes(n); assert.equal(s.reduce((a, b) => a + b, 0), n); assert.ok(s.every(x => x === 3 || x === 4)); }
});

test('tirage : tout le monde placé une fois, imposés respectés, résultat reproductible', () => {
  const ids = Array.from({ length: 11 }, (_, i) => 'p' + i);
  let seed = 7; const rng = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const g = makeGroups(ids, { forced: [['p0', 'p1'], [], ['p2']], rng });
  assert.equal(g.flat().length, 11);
  assert.equal(new Set(g.flat()).size, 11);
  assert.ok(g[0].includes('p0') && g[0].includes('p1'));
  assert.ok(g[2].includes('p2'));
  assert.throws(() => makeGroups(ids, { forced: [['p0'], ['p0']] }));
  assert.throws(() => makeGroups(ids, { forced: [['p0', 'p1', 'p2', 'p3', 'p4']] }));
  assert.ok(makeGroups(ids, { forced: [['absent']] }).flat().length === 11);   // un imposé absent est ignoré
});

test('départs toutes les 8 minutes et texte WhatsApp', () => {
  assert.deepEqual(teeTimes('08:00', 3), ['08:00', '08:08', '08:16']);
  assert.deepEqual(teeTimes('07:50', 2), ['07:50', '07:58']);
  assert.throws(() => teeTimes('8h'));
  const t = whatsappText({ dateLabel: 'vendredi 14 janvier', courseName: 'Mont Choisy', groups: [['Roro', 'Nico'], ['Tanguy', 'JP']], times: ['08:00', '08:08'] });
  assert.match(t, /08:00 : Roro \/ Nico\n08:08 : Tanguy \/ JP/);
  assert.match(whatsappLink(t), /^https:\/\/wa\.me\/\?text=/);
  assert.equal(nextGuestCode(['INV1', 'INV3']), 'INV2');
});

// ---- année ----
const holes = Array.from({ length: 18 }, (_, i) => ({ course_id: 'c', hole_no: i + 1, par: 4, si: i + 1 }));
const players = [{ id: 'a', display_name: 'A', is_guest: false }, { id: 'b', display_name: 'B', is_guest: false }, { id: 'g', display_name: 'Inv', is_guest: true }];
function mk(rounds) {   // rounds: [{id, date, cards:[{player, status, mode, excl, rep, strokes}]}]
  const d = { rounds: [], participations: [], cards: [], hole_scores: [], holes, tees: [], nearest: [], settings: [{ key: 'top_n', value: 2 }, { key: 'guest_limit', value: 1 }] };
  for (const r of rounds) {
    d.rounds.push({ id: r.id, played_on: r.date, course_id: 'c' });
    for (const c of r.cards) {
      const pid = r.id + c.player;
      d.participations.push({ id: pid, round_id: r.id, player_id: c.player, playing_handicap: 0, handicap_index: 10 });
      d.cards.push({ id: 'c' + pid, participation_id: pid, status: c.status ?? 'validee', mode: c.mode ?? 'net', excluded_from_net: !!c.excl || c.mode === 'gross', replaced: !!c.rep });
      for (let h = 1; h <= 18; h++) d.hole_scores.push({ card_id: 'c' + pid, hole_no: h, strokes: c.strokes, pickup: false });
    }
  }
  return d;
}
test('année : top N des cartes nettes validées + carte gross ; invités et cartes non validées exclus', () => {
  // 4 coups par trou sur par 4 = 2 pts x 18 = 36 ; 3 coups = 3 pts x 18 = 54 ; 5 coups = 18
  const data = mk([
    { id: 'r1', date: '2027-01-14', cards: [{ player: 'a', strokes: 4 }, { player: 'b', strokes: 5 }, { player: 'g', strokes: 3 }] },
    { id: 'r2', date: '2027-02-11', cards: [{ player: 'a', strokes: 3 }, { player: 'b', strokes: 4 }] },
    { id: 'r3', date: '2027-03-11', cards: [{ player: 'a', strokes: 5 }, { player: 'b', strokes: 3, status: 'en_cours' }] },
    { id: 'r4', date: '2027-04-08', cards: [{ player: 'a', strokes: 3, mode: 'gross' }] },
    { id: 'r0', date: '2026-12-10', cards: [{ player: 'b', strokes: 3 }] },    // année précédente : ignorée
  ]);
  data.nearest = [{ round_id: 'r1', hole_no: 3, player_id: 'a' }, { round_id: 'r2', hole_no: 3, player_id: 'a' }, { round_id: 'r1', hole_no: 7, player_id: 'b' }];
  const y = buildYear(data, players, 2027);
  assert.equal(y.topN, 2);
  const a = y.ranking.find(r => r.playerId === 'a'), b = y.ranking.find(r => r.playerId === 'b');
  assert.equal(a.netTotal, 54 + 36);              // 2 meilleures nettes de A (54 et 36) ; 18 non retenue
  assert.equal(a.grossPoints, 54);                // carte gross de A (sans coups reçus)
  assert.equal(a.total, 144);
  assert.equal(b.netTotal, 36 + 18);              // la carte en cours de B n'est pas comptée
  assert.equal(y.ranking[0].playerId, 'a');
  assert.ok(!y.ranking.some(r => r.playerId === 'g'));
  assert.deepEqual(y.nearest.map(n => [n.name, n.wins]), [['A', 2], ['B', 1]]);
  assert.equal(y.guests.length, 1);
  assert.ok(y.guests[0].atLimit);                 // plafond réglé à 1 : atteint
  const s = playerSheet(y, 'a');
  assert.equal(s.counted.size, 2);
  assert.equal(s.average, 36);                    // (54 + 36 + 18) / 3
  assert.equal(s.best, 54);
  assert.equal(playerSheet(y, 'b').pending, 1);
});

test('tirage : paires à garder ensemble et groupes imposés, petits groupes en premier', () => {
  const ids = Array.from({ length: 10 }, (_, i) => 'p' + i);
  assert.deepEqual(groupSizes(10), [3, 3, 4]);                 // les 3 d'abord, les 4 en dernier
  for (let k = 0; k < 40; k++) {
    const g = makeGroups(ids, { together: [['p0', 'p1'], ['p1', 'p2'], ['p5', 'p6']], forced: [[], [], ['p9']] });
    const grp = id => g.findIndex(x => x.includes(id));
    assert.ok(grp('p0') === grp('p1') && grp('p1') === grp('p2'));       // chaînes fusionnées : p0, p1, p2 ensemble
    assert.equal(grp('p5'), grp('p6'));
    assert.equal(grp('p9'), 2);
    assert.deepEqual(g.map(x => x.length), [3, 3, 4]);
    assert.equal(new Set(g.flat()).size, 10);
  }
  // pairing avec un joueur imposé : l'autre rejoint son groupe
  const g2 = makeGroups(ids, { forced: [['p3']], together: [['p3', 'p4']] });
  assert.ok(g2[0].includes('p3') && g2[0].includes('p4'));
  assert.throws(() => makeGroups(ids, { forced: [['p3'], ['p4']], together: [['p3', 'p4']] }), /groupes différents/);
  assert.throws(() => makeGroups(ids, { together: [['p0', 'p1', 'p2', 'p3', 'p4']] }), /Impossible de réunir/);
  assert.throws(() => makeGroups(ids, { forced: [['p0', 'p1', 'p2', 'p3']] }), /trop de joueurs/);
});

test('départs : intervalle réglable selon le golf', () => {
  assert.deepEqual(teeTimes('07:30', 4, 10), ['07:30', '07:40', '07:50', '08:00']);
  assert.deepEqual(teeTimes('08:00', 3, 12), ['08:00', '08:12', '08:24']);
  assert.throws(() => teeTimes('08:00', 3, 0));
  assert.throws(() => teeTimes('08:00', 3, 90));
});

import { golfMail, mailtoLink, whatsappToLink } from '../src/draw.js';
test('mail au golf : objet, départs et lien mailto', () => {
  const m = golfMail({ dateLabel: 'jeudi 3 décembre 2026', courseName: 'Mont Choisy Le Golf', groups: [{ time: '08:00', players: ['A', 'B', 'C'] }, { time: '08:08', players: ['D', 'E', 'F', 'G'] }] });
  assert.equal(m.subject, 'Les Jambons - départs du jeudi 3 décembre 2026');
  assert.match(m.body, /7 joueurs/); assert.match(m.body, /08:00 : A \/ B \/ C/); assert.match(m.body, /08:08 : D \/ E \/ F \/ G/); assert.match(m.body, /Tanguy Le Texier/);
  const l = mailtoLink({ to: ' resa@golf.mu ', ...m });
  assert.ok(l.startsWith('mailto:resa@golf.mu?subject=')); assert.match(decodeURIComponent(l), /08:00 : A/);
  assert.equal(whatsappToLink('+230 5123 4567', 'x'), 'https://wa.me/23051234567?text=x');
});

test('historique importé : les 9 meilleurs scores + le brut comptent, le nearest aussi', () => {
  const players = [{ id: 'a', display_name: 'A', is_guest: false }, { id: 'b', display_name: 'B', is_guest: false }];
  const hs = [];
  for (let i = 0; i < 11; i++) hs.push({ id: 'a' + i, played_on: `2026-02-${String(i + 1).padStart(2, '0')}`, player_id: 'a', kind: 'net', points: 20 + i });  // 20..30 : on garde 30..22
  hs.push({ id: 'ag', played_on: '2026-11-26', player_id: 'a', kind: 'gross', points: 15 });
  hs.push({ id: 'b0', played_on: '2026-02-01', player_id: 'b', kind: 'net', points: 40 });
  hs.push({ id: 'x', played_on: '2025-12-31', player_id: 'b', kind: 'net', points: 99 });   // autre année : ignoré
  const data = { rounds: [], participations: [], cards: [], hole_scores: [], holes: [], tees: [], nearest: [], settings: [],
    history_scores: hs, history_nearest: [{ played_on: '2026-02-01', seq: 1, player_id: 'a' }, { played_on: '2026-02-01', seq: 2, player_id: 'a' }] };
  const y = buildYear(data, players, 2026);
  const a = y.ranking.find(r => r.playerId === 'a'), b = y.ranking.find(r => r.playerId === 'b');
  assert.equal(a.netTotal, 30 + 29 + 28 + 27 + 26 + 25 + 24 + 23 + 22);
  assert.equal(a.grossPoints, 15);
  assert.equal(a.total, 234 + 15);
  assert.equal(b.total, 40);
  assert.equal(y.ranking[0].playerId, 'a');
  assert.equal(y.nearest.find(n => n.playerId === 'a').wins, 2);
});
