import test from 'node:test';
import assert from 'node:assert/strict';
import { prepDay, prepNearestDay, prepNearestAnnual, prepAnnual, prepDraw } from '../src/sharedata.js';
import { buildRoundView } from '../src/model.js';
import { buildYear } from '../src/year.js';

const holes = Array.from({ length: 18 }, (_, i) => ({ course_id: 'c', hole_no: i + 1, par: [3, 8, 12, 16].includes(i + 1) ? 3 : 4, si: i + 1 }));
const players = [{ id: 'a', display_name: 'Alban P', is_guest: false }, { id: 'b', display_name: 'Bob', is_guest: false }, { id: 'g', display_name: 'Marc', is_guest: true }];
const data = {
  round: { id: 'r', played_on: '2027-01-14', status: 'terminee', course_id: 'c' }, course: { id: 'c', name: 'Mont Choisy' }, holes, players,
  groups: [{ id: 'g1', number: 1, tee_time: '07:30:00' }, { id: 'g2', number: 2, tee_time: '07:40:00' }],
  tees: [{ id: 't', name: 'Jaune' }],
  participations: [
    { id: 'pa', round_id: 'r', player_id: 'a', group_id: 'g1', tee_id: 't', handicap_index: 10, playing_handicap: 0 },
    { id: 'pb', round_id: 'r', player_id: 'b', group_id: 'g1', tee_id: 't', handicap_index: 10, playing_handicap: 0 },
    { id: 'pg', round_id: 'r', player_id: 'g', group_id: 'g2', tee_id: 't', handicap_index: 10, playing_handicap: 0 }],
  cards: [{ id: 'ca', participation_id: 'pa', status: 'validee', mode: 'net' }, { id: 'cb', participation_id: 'pb', status: 'validee', mode: 'net' }, { id: 'cg', participation_id: 'pg', status: 'validee', mode: 'net' }],
  hole_scores: [], nearest: [{ round_id: 'r', hole_no: 3, player_id: 'a' }],
};
for (const [card, st] of [['ca', 4], ['cb', 5], ['cg', 3]]) for (let h = 1; h <= 18; h++) data.hole_scores.push({ card_id: card, hole_no: h, strokes: holes[h - 1].par === 3 ? st - 1 : st, pickup: false });
const view = buildRoundView(data);

test('images : classement du jour avec invité et gagnant', () => {
  const s = prepDay(view, { dateLabel: 'vendredi 14 janvier 2027' });
  assert.equal(s.title, 'Classement du jour');
  assert.equal(s.rows.length, 3);
  assert.equal(s.rows[0].name, 'Marc'); assert.equal(s.rows[0].tag, 'invité'); assert.ok(s.rows[0].top);
  assert.ok(!/provisoire/.test(s.subtitle));
  data.round.status = 'en_cours';
  assert.match(prepDay(buildRoundView(data), { dateLabel: 'x' }).subtitle, /provisoire/);
  data.round.status = 'terminee';
});

test('images : nearest du jour, un par 3', () => {
  const s = prepNearestDay(view, { dateLabel: 'x' });
  assert.deepEqual(s.rows.map(r => r.rank), ['T3', 'T8', 'T12', 'T16']);
  assert.equal(s.rows[0].name, 'Alban P'); assert.equal(s.rows[1].name, '—');
});

test('images : tirage du jour', () => {
  const s = prepDraw(view, { dateLabel: 'x' });
  assert.deepEqual(s.groups.map(g => g.time), ['07:30', '07:40']);
  assert.deepEqual(s.groups[1].players, ['Marc (invité)']);
});

test('images : classement annuel et nearest annuel', () => {
  const Y = buildYear({ rounds: [data.round], participations: data.participations, cards: data.cards, hole_scores: data.hole_scores, holes, nearest: data.nearest, settings: [] }, players, 2027);
  const a = prepAnnual(Y);
  assert.deepEqual(a.rows.map(r => r.name), ['Alban P', 'Bob']);          // l'invité n'apparaît pas
  assert.match(a.subtitle, /Saison 2027 · 1 journée$/);
  assert.match(a.footer, /9 meilleures cartes/);
  const n = prepNearestAnnual(Y);
  assert.deepEqual(n.rows.map(r => [r.name, r.value]), [['Alban P', '1']]);
});
