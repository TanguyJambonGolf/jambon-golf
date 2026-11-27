import test from 'node:test';
import assert from 'node:assert/strict';
import { createQueue } from '../src/queue.js';
import { buildRoundView, canEdit, canValidate, stepScore, inDraw } from '../src/model.js';

const mem = () => { const m = {}; return { getItem: k => m[k] ?? null, setItem: (k, v) => { m[k] = v; } }; };
const netErr = () => Object.assign(new Error('réseau'), { network: true });
const bizErr = msg => Object.assign(new Error(msg), { business: true });

test('file : une saisie remplace la précédente sur le même trou', () => {
  const q = createQueue(mem());
  q.add({ type: 'score', card: 'c1', hole: 3, strokes: 4, pickup: false });
  q.add({ type: 'score', card: 'c1', hole: 3, strokes: 5, pickup: false });
  q.add({ type: 'score', card: 'c1', hole: 4, strokes: 3, pickup: false });
  assert.equal(q.size, 2);
  assert.equal(q.ops[0].strokes, 5);
});

test('file : conservée après redémarrage, vidée quand le réseau revient', async () => {
  const st = mem();
  const q = createQueue(st);
  q.add({ type: 'score', card: 'c1', hole: 1, strokes: 4, pickup: false });
  q.add({ type: 'status', card: 'c1', status: 'a_verifier' });
  const q2 = createQueue(st);                       // redémarrage de l'appli
  assert.equal(q2.size, 2);
  const r1 = await q2.flush(async () => { throw netErr(); });
  assert.equal(r1.pending, 2);                      // hors ligne : rien n'est perdu
  const sent = [];
  const r2 = await q2.flush(async op => { sent.push(op.type); });
  assert.deepEqual(sent, ['score', 'status']);      // ordre conservé
  assert.equal(r2.pending, 0);
  assert.equal(createQueue(st).size, 0);
});

test('file : un refus du serveur est signalé et ne bloque pas la suite', async () => {
  const q = createQueue(mem());
  q.add({ type: 'score', card: 'c1', hole: 1, strokes: 4, pickup: false });
  q.add({ type: 'score', card: 'c1', hole: 2, strokes: 5, pickup: false });
  await q.flush(async op => { if (op.hole === 1) throw bizErr('Carte validée : scores verrouillés'); });
  assert.equal(q.size, 0);
  assert.equal(q.rejected.length, 1);
  assert.match(q.rejected[0].message, /verrouill/);
});

test('file : une saisie faite pendant l\'envoi n\'est pas perdue', async () => {
  const q = createQueue(mem());
  q.add({ type: 'score', card: 'c1', hole: 1, strokes: 4, pickup: false });
  const sent = [];
  await q.flush(async op => { sent.push(op.strokes); if (sent.length === 1) q.add({ type: 'score', card: 'c1', hole: 1, strokes: 6, pickup: false }); });
  assert.deepEqual(sent, [4, 6]);
  assert.equal(q.size, 0);
});

// ---- vues ----
const parOf = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5];
const holes = parOf.map((par, i) => ({ hole_no: i + 1, par, si: ((i * 7) % 18) + 1 }));
const data = () => ({
  round: { id: 'r1', played_on: '2027-01-14' }, course: { id: 'x', name: 'Test' }, holes,
  groups: [{ id: 'g1', number: 1 }, { id: 'g2', number: 2 }],
  players: [{ id: 'a', display_name: 'A' }, { id: 'b', display_name: 'B' }, { id: 'c', display_name: 'C' }, { id: 'z', display_name: 'Z' }],
  tees: [{ id: 't', name: 'Jaune' }],
  participations: [
    { id: 'pa', round_id: 'r1', player_id: 'a', group_id: 'g1', tee_id: 't', handicap_index: 10, playing_handicap: 0 },
    { id: 'pb', round_id: 'r1', player_id: 'b', group_id: 'g1', tee_id: 't', handicap_index: 10, playing_handicap: 18 },
    { id: 'pc', round_id: 'r1', player_id: 'c', group_id: 'g2', tee_id: 't', handicap_index: 10, playing_handicap: 18 },
  ],
  cards: [{ id: 'ca', participation_id: 'pa', status: 'en_cours' }, { id: 'cb', participation_id: 'pb', status: 'en_cours' }, { id: 'cc', participation_id: 'pc', status: 'validee' }],
  hole_scores: [], nearest: [],
});

test('vue : les modifications en attente s\'affichent tout de suite', () => {
  const v = buildRoundView(data(), [{ type: 'score', card: 'ca', hole: 1, strokes: 4, pickup: false }]);
  const a = v.members.find(m => m.name === 'A');
  assert.equal(a.scores[0].strokes, 4);
  assert.equal(a.totals.net, 2);   // par 4, 4 coups, 0 reçu = 2 points
});

test('vue : HJ 18 = un coup reçu partout, points en net', () => {
  const d = data(); d.hole_scores = [{ card_id: 'cb', hole_no: 1, strokes: 5, pickup: false }];
  const b = buildRoundView(d).members.find(m => m.name === 'B');
  assert.equal(b.totals.net, 2);   // 5 coups, par 4, 1 reçu -> 2 + 4 + 1 - 5 = 2
});

test('droits : seuls les joueurs du tirage saisissent ; carte validée verrouillée', () => {
  const v = buildRoundView(data());
  const [a, b, c] = ['A', 'B', 'C'].map(n => v.members.find(m => m.name === n));
  assert.ok(inDraw(v, 'a') && !inDraw(v, 'z'));
  assert.ok(canEdit(v, 'a', b));          // A peut saisir pour B
  assert.ok(!canEdit(v, 'z', a));         // Z, hors tirage : non
  assert.ok(!canEdit(v, 'a', c));         // carte validée : non (même groupe ou pas)
  assert.ok(canEdit(v, 'c', b));          // C (autre groupe) peut saisir pour B
});

test('validation : autre joueur du même groupe, carte complète à vérifier', () => {
  const d = data();
  d.cards[0].status = 'a_verifier';
  d.hole_scores = holes.map(h => ({ card_id: 'ca', hole_no: h.hole_no, strokes: 5, pickup: false }));
  const v = buildRoundView(d);
  const a = v.members.find(m => m.name === 'A');
  assert.ok(canValidate(v, 'b', a));      // B, même groupe
  assert.ok(!canValidate(v, 'a', a));     // pas sa propre carte
  assert.ok(!canValidate(v, 'c', a));     // autre groupe
  d.hole_scores.pop();
  const v2 = buildRoundView(d);
  assert.ok(!canValidate(v2, 'b', v2.members.find(m => m.name === 'A')));   // incomplète
});

test('saisie : + et - partent du par, la croix = ramassé', () => {
  const empty = { strokes: null, pickup: false };
  assert.deepEqual(stepScore(empty, 4, 0, +1), { strokes: 5, pickup: false });
  assert.deepEqual(stepScore(empty, 4, 0, -1), { strokes: 3, pickup: false });
  assert.deepEqual(stepScore({ strokes: 5, pickup: false }, 4, 0, +1), { strokes: null, pickup: true }); // la croix est à 6 (par 4 + 2)
  assert.deepEqual(stepScore({ strokes: null, pickup: true }, 4, 0, -1), { strokes: 5, pickup: false });
  assert.equal(stepScore({ strokes: null, pickup: true }, 4, 0, +1), null);
  assert.equal(stepScore({ strokes: 1, pickup: false }, 4, 0, -1), null);
  assert.deepEqual(stepScore({ strokes: 6, pickup: false }, 4, 1, +1), { strokes: null, pickup: true }); // 1 coup reçu : croix à 7
});
