import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  playingHandicap, roundHalfUp, strokesReceived, holePoints, crossScore, scoreOptions, cardTotals,
  dayRanking, setGrossCard, annualRanking, guestStatus, par3Holes, nearestRanking, validateCourse,
} from "./engine.js";

const courses = JSON.parse(readFileSync(new URL("../data/courses.json", import.meta.url)));
const course = (id) => courses.find((c) => c.id === id);
const holesOf = (id) => course(id).par.map((par, i) => ({ par, si: course(id).si[i] }));

test("handicap de jeu : exemple officiel de la fédération (15,6 / Tamarina rouge dames) = 17", () => {
  assert.equal(playingHandicap({ index: 15.6, slope: 123, cr: 72.5, par: 72 }), 17);
});

test("handicap de jeu : cas des parcours réels", () => {
  assert.equal(playingHandicap({ index: 10, slope: 126, cr: 70.8, par: 72 }), 10); // Mont Choisy jaune
  assert.equal(playingHandicap({ index: 18, slope: 129, cr: 71.2, par: 72 }), 20); // Tamarina jaune
  assert.equal(playingHandicap({ index: 12, slope: 136, cr: 68.9, par: 72 }), 11); // Legend blanc
  assert.equal(playingHandicap({ index: 12, slope: 135, cr: 72.2, par: 72 }), 15); // Réserve jaune (CR > par)
});

test("arrondi : .5 vers le haut, handicap plus inclus", () => {
  assert.equal(playingHandicap({ index: 0, slope: 113, cr: 72.5, par: 72 }), 1);
  assert.equal(roundHalfUp(-0.5), 0);
  assert.equal(playingHandicap({ index: -2, slope: 113, cr: 72, par: 72 }), -2);
});

test("coups reçus : HJ 10 sur Mont Choisy", () => {
  const rec = holesOf("mont_choisy").map((h) => strokesReceived(10, h.si));
  assert.deepEqual(rec, [0, 1, 0, 0, 1, 1, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1, 0, 1]);
});

test("coups reçus : 20 donne 2 coups sur les index 1 et 2 ; 36 donne 2 partout ; 0 rien", () => {
  assert.equal(strokesReceived(20, 1), 2);
  assert.equal(strokesReceived(20, 2), 2);
  assert.equal(strokesReceived(20, 3), 1);
  for (let si = 1; si <= 18; si++) {
    assert.equal(strokesReceived(36, si), 2);
    assert.equal(strokesReceived(0, si), 0);
  }
});

test("coups reçus : handicap plus rend des coups sur les index 17 et 18", () => {
  assert.equal(strokesReceived(-2, 18), -1);
  assert.equal(strokesReceived(-2, 17), -1);
  assert.equal(strokesReceived(-2, 16), 0);
});

test("coups reçus : la somme sur 18 trous égale toujours le handicap de jeu", () => {
  for (let hj = -5; hj <= 40; hj++) {
    let sum = 0;
    for (let si = 1; si <= 18; si++) sum += strokesReceived(hj, si);
    assert.equal(sum, hj, `HJ ${hj}`);
  }
});

test("points Stableford d'un trou", () => {
  assert.equal(holePoints({ par: 4, strokes: 5, received: 1 }), 2);
  assert.equal(holePoints({ par: 4, strokes: 4, received: 1 }), 3);
  assert.equal(holePoints({ par: 4, strokes: 3, received: 1 }), 4);
  assert.equal(holePoints({ par: 4, strokes: 6, received: 1 }), 1);
  assert.equal(holePoints({ par: 4, strokes: 7, received: 1 }), 0);
  assert.equal(holePoints({ par: 4, strokes: 5, received: 0 }), 1);
  assert.equal(holePoints({ par: 4, strokes: 6, received: 0 }), 0);
  assert.equal(holePoints({ par: 4, strokes: null, pickup: true, received: 2 }), 0);
  assert.equal(holePoints({ par: 4, strokes: null, received: 2 }), 0);
});

test("croix : premier score à 0 point net", () => {
  assert.equal(crossScore(4, 1), 7);
  assert.equal(crossScore(3, 0), 5);
  assert.equal(crossScore(5, 2), 9);
  const opts = scoreOptions(4, 1);
  assert.equal(opts.length, 7);
  assert.equal(opts[6].cross, true);
  assert.equal(opts[6].points, 0);
  assert.equal(opts[5].points, 1);
  assert.deepEqual(opts.filter((o) => o.isDefault).map((o) => o.score), [4]); // le par est proposé d'office
  // jamais de points sur la croix, et au moins 1 point juste avant
  for (const [par, rec] of [[3, 0], [4, 2], [5, 1], [3, -1]]) {
    const o = scoreOptions(par, rec);
    assert.equal(o[o.length - 1].points, 0);
    if (o.length > 1) assert.ok(o[o.length - 2].points >= 1);
  }
});

test("la croix ne coûte aucun point gross : ce score vaut aussi 0 en gross", () => {
  for (const [par, rec] of [[3, 0], [4, 1], [5, 2], [4, 2]]) {
    const cross = crossScore(par, rec);
    assert.equal(holePoints({ par, strokes: cross, received: 0 }), 0);
  }
});

test("carte : tout au par avec HJ 10 = 36 + 10 points net, 36 gross", () => {
  const holes = holesOf("mont_choisy");
  const scores = holes.map((h) => ({ strokes: h.par, pickup: false }));
  const t = cardTotals({ holes, scores, playingHandicap: 10 });
  assert.equal(t.net, 46);
  assert.equal(t.gross, 36);
  assert.equal(t.strokesTotal, 72);
  assert.equal(t.complete, true);
});

test("carte partielle : trou ramassé compte joué, trou vide non", () => {
  const holes = holesOf("mont_choisy");
  const scores = holes.map(() => ({ strokes: null, pickup: false }));
  scores[0] = { strokes: 4, pickup: false }; // par 4, index 11, HJ 10 -> 0 coup reçu
  scores[1] = { strokes: null, pickup: true };
  const t = cardTotals({ holes, scores, playingHandicap: 10 });
  assert.equal(t.net, 2);
  assert.equal(t.played, 2);
  assert.equal(t.complete, false);
});

test("classement du jour : un invité peut gagner, ex aequo partagés", () => {
  const r = dayRanking([
    { playerId: "g1", isGuest: true, net: 36 },
    { playerId: "p1", isGuest: false, net: 36 },
    { playerId: "p2", isGuest: false, net: 30 },
  ]);
  assert.deepEqual(r.rows.map((x) => x.rank), [1, 1, 3]);
  assert.equal(r.winners.length, 2);
  assert.ok(r.winners.some((w) => w.isGuest));
});

const card = (id, playerId, date, net, extra = {}) => ({
  id, playerId, date, status: "validee", mode: "net", excludedFromNet: false, replaced: false, net, gross: 0, ...extra,
});

test("carte gross : sort du net, le remplacement ne rend jamais la carte remplacée au net", () => {
  let cards = [card("c1", "p", "2027-01-14", 30), card("c2", "p", "2027-01-21", 40, { gross: 20 }), card("c3", "p", "2027-01-28", 35, { gross: 25 })];
  cards = setGrossCard(cards, "p", "c2");
  assert.equal(cards[1].mode, "gross");
  assert.equal(cards[1].excludedFromNet, true);
  cards = setGrossCard(cards, "p", "c3");
  const byId = Object.fromEntries(cards.map((c) => [c.id, c]));
  assert.equal(byId.c2.replaced, true);
  assert.equal(byId.c2.excludedFromNet, true);
  assert.equal(byId.c3.mode, "gross");
  assert.equal(byId.c1.mode, "net");
  // c2 (40, meilleure carte) ne revient pas au net : total = 30 (c1) + 25 (gross de c3)
  const r = annualRanking([{ id: "p", name: "P", isGuest: false }], cards);
  assert.equal(r[0].netTotal, 30);
  assert.equal(r[0].grossPoints, 25);
  assert.equal(r[0].total, 55);
  assert.throws(() => setGrossCard(cards, "p", "c2"), /remplacée/);
  assert.throws(() => setGrossCard(cards, "autre", "c1"), /inconnue/);
});

test("classement annuel : 9 meilleures cartes nettes + carte gross, non validées et invités exclus", () => {
  const nets = [30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40];
  const cards = nets.map((n, i) => card("n" + i, "p1", `2027-0${1 + (i % 9)}-10`, n));
  cards.push(card("g", "p1", "2027-05-01", 0, { mode: "gross", excludedFromNet: true, gross: 25 }));
  cards.push(card("x", "p1", "2027-06-01", 50, { status: "a_verifier" })); // non validée : ignorée
  cards.push(card("inv", "g1", "2027-06-02", 45));
  const players = [{ id: "p1", name: "P1", isGuest: false }, { id: "g1", name: "Invité", isGuest: true }];
  const r = annualRanking(players, cards);
  assert.equal(r.length, 1); // l'invité n'apparaît pas
  assert.equal(r[0].netTotal, 324); // 40+39+...+32
  assert.equal(r[0].netCards.length, 9);
  assert.equal(r[0].total, 349);
});

test("classement annuel : moins de 9 cartes = on compte ce qui existe ; nombre de cartes modifiable", () => {
  const cards = [card("a", "p", "2027-01-14", 30), card("b", "p", "2027-01-21", 20), card("c", "p", "2027-01-28", 10)];
  const players = [{ id: "p", name: "P", isGuest: false }];
  assert.equal(annualRanking(players, cards)[0].total, 60);
  assert.equal(annualRanking(players, cards, { topN: 2 })[0].total, 50);
});

test("classement annuel : départage par meilleure carte nette, puis points gross", () => {
  const players = ["p1", "p2", "p5", "p6"].map((id) => ({ id, name: id, isGuest: false }));
  const g = (id, p, pts) => card(id, p, "2027-02-01", 0, { mode: "gross", excludedFromNet: true, gross: pts });
  const cards = [
    card("1a", "p1", "2027-01-01", 20), card("1b", "p1", "2027-01-02", 20),
    card("2a", "p2", "2027-01-01", 30), card("2b", "p2", "2027-01-02", 10),
    card("5a", "p5", "2027-01-01", 25), card("5b", "p5", "2027-01-02", 10), g("5g", "p5", 5),
    card("6a", "p6", "2027-01-01", 25), card("6b", "p6", "2027-01-02", 5), g("6g", "p6", 10),
  ];
  const r = annualRanking(players, cards, { topN: 2 });
  assert.deepEqual(r.map((x) => x.total), [40, 40, 40, 40]);
  assert.deepEqual(r.map((x) => x.playerId), ["p2", "p6", "p5", "p1"]);
  assert.deepEqual(r.map((x) => x.rank), [1, 2, 3, 4]);
});

test("classement annuel : égalité parfaite = même rang", () => {
  const players = ["a", "b"].map((id) => ({ id, name: id, isGuest: false }));
  const cards = [card("a1", "a", "2027-01-01", 30), card("b1", "b", "2027-01-01", 30)];
  assert.deepEqual(annualRanking(players, cards).map((x) => x.rank), [1, 1]);
});

test("invités : plafond de 4 parties par an, journées distinctes", () => {
  const p = (roundId, date) => ({ guestId: "g", roundId, date });
  let parts = [p("r1", "2027-01-14"), p("r1", "2027-01-14"), p("r2", "2027-02-11"), p("r3", "2027-03-11"), p("old", "2026-12-01")];
  let s = guestStatus(parts, "g", 2027);
  assert.equal(s.count, 3);
  assert.equal(s.remaining, 1);
  assert.equal(s.atLimit, false);
  parts.push(p("r4", "2027-04-08"));
  s = guestStatus(parts, "g", 2027);
  assert.equal(s.atLimit, true);
  assert.equal(s.remaining, 0);
  assert.equal(s.exceeded, false);
  parts.push(p("r5", "2027-05-13"));
  assert.equal(guestStatus(parts, "g", 2027).exceeded, true);
  assert.equal(guestStatus(parts, "autre", 2027).count, 0);
});

test("nearest : par 3 de chaque parcours, invités exclus du classement", () => {
  assert.deepEqual(par3Holes(holesOf("mont_choisy")), [4, 8, 11, 15, 17]);
  assert.deepEqual(par3Holes(holesOf("tamarina")), [6, 9, 13, 17]);
  const r = nearestRanking([
    { roundId: "r1", holeNo: 4, playerId: "a", isGuest: false },
    { roundId: "r1", holeNo: 8, playerId: "g", isGuest: true },
    { roundId: "r1", holeNo: 11, playerId: "a", isGuest: false },
    { roundId: "r1", holeNo: 15, playerId: "b", isGuest: false },
  ]);
  assert.deepEqual(r.map((x) => [x.playerId, x.wins, x.rank]), [["a", 2, 1], ["b", 1, 2]]);
});

test("données des parcours : 11 parcours valides, 1 tee par défaut chacun", () => {
  assert.equal(courses.length, 11);
  for (const c of courses) {
    assert.deepEqual(validateCourse(c), [], c.name);
    assert.equal(c.tees.filter((t) => t.default).length, 1, c.name);
    for (const t of c.tees) {
      assert.ok(t.slope >= 55 && t.slope <= 155, `${c.name} ${t.name}`);
      assert.ok(t.cr > 50 && t.cr < 90, `${c.name} ${t.name}`);
    }
  }
  const par = (id) => course(id).par.reduce((a, b) => a + b, 0);
  assert.equal(par("constance_links"), 71);
  assert.equal(par("gymkhana"), 68);
  assert.equal(par("tamarina"), 72);
  const def = (id) => course(id).tees.find((t) => t.default).name;
  assert.equal(def("constance_legend"), "Blanc");
  assert.equal(def("constance_links"), "Blanc");
  assert.equal(def("paradis"), "Men");
  assert.equal(def("mont_choisy"), "Jaune");
  assert.equal(def("heritage_reserve"), "Jaune");
});
