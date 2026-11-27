// Mode démo : mêmes fonctions que l'API, données fictives stockées dans ce téléphone (localStorage). Rien n'est envoyé nulle part.
const KEY = 'golf.demo2';
const fail = m => Object.assign(new Error(m), { business: true });

export async function createDemoApi(storage) {
  const [courses, players0] = await Promise.all([
    fetch(new URL('../../data/courses.json', import.meta.url)).then(r => r.json()),
    fetch(new URL('../../data/players.json', import.meta.url)).then(r => r.json()),
  ]);
  const course = courses.find(c => c.id === 'mont_choisy');
  const defTee = c => c.tees.find(t => t.default) || c.tees[0];
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  let st = null;
  try { st = JSON.parse(storage.getItem(KEY)); } catch { /* neuf */ }
  let n = 0;
  const uid = p => `${p}-${Date.now().toString(36)}-${++n}`;

  if (!st) {
    st = { rounds: [], groups: [], participations: [], cards: [], hole_scores: [], nearest: [], guests: [], settings: { top_n: 9, guest_limit: 4 } };
    const regs = players0.filter(p => !p.is_guest);
    let seed = 12345; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const hcp = Object.fromEntries(regs.map((p, i) => [p.id, [12, 18, 9, 24, 15, 20, 6, 28, 14, 10, 17, 22, 8, 19, 13, 26, 11, 16, 21, 7, 25, 23][i % 22]]));
    // trois journées passées, cartes validées, scores plausibles
    for (let k = 3; k >= 1; k--) {
      const d = new Date(); d.setDate(d.getDate() - 7 * k);
      const rid = 'past-' + k;
      st.rounds.push({ id: rid, played_on: iso(d), status: 'terminee', course_id: course.id });
      const present = regs.filter((_, i) => (i + k) % 3 !== 0).slice(0, 12);
      present.forEach((p, i) => {
        const pa = { id: `${rid}-pa${i}`, round_id: rid, player_id: p.id, group_id: `${rid}-g${Math.floor(i / 4) + 1}`, tee_id: defTee(course).id, handicap_index: hcp[p.id], playing_handicap: hcp[p.id] };
        st.participations.push(pa);
        const cid = `${rid}-ca${i}`;
        st.cards.push({ id: cid, participation_id: pa.id, status: 'validee', mode: 'net', excluded_from_net: false, replaced: false, validated_by: present[(i + 1) % present.length].id });
        for (let h = 1; h <= 18; h++) {
          const par = course.par[h - 1], extra = Math.floor(hcp[p.id] / 18) + (course.si[h - 1] <= hcp[p.id] % 18 ? 1 : 0);
          const strokes = Math.max(1, par + extra + Math.floor(rnd() * 3) - 1);
          st.hole_scores.push({ card_id: cid, hole_no: h, strokes, pickup: false });
        }
      });
      for (let g = 1; g <= 3; g++) st.groups.push({ id: `${rid}-g${g}`, round_id: rid, number: g, tee_time: null, marker_player_id: null });
      st.nearest.push({ round_id: rid, hole_no: course.par.indexOf(3) + 1, player_id: present[k].id });
    }
    // journée du jour : 8 joueurs, rien de saisi
    const chosen = regs.slice(0, 8), hs = [12, 18, 9, 24, 15, 20, 6, 28];
    st.rounds.push({ id: 'demo', played_on: iso(new Date()), status: 'en_cours', course_id: course.id });
    st.groups.push({ id: 'g1', round_id: 'demo', number: 1, tee_time: '08:00', marker_player_id: chosen[0].id }, { id: 'g2', round_id: 'demo', number: 2, tee_time: '08:08', marker_player_id: chosen[4].id });
    chosen.forEach((p, i) => {
      st.participations.push({ id: 'pa-' + i, round_id: 'demo', player_id: p.id, group_id: i < 4 ? 'g1' : 'g2', tee_id: defTee(course).id, handicap_index: hs[i], playing_handicap: hs[i] });
      st.cards.push({ id: 'ca-' + i, participation_id: 'pa-' + i, status: 'en_cours', mode: 'net', excluded_from_net: false, replaced: false });
    });
  }
  const save = () => storage.setItem(KEY, JSON.stringify(st));
  const clone = x => JSON.parse(JSON.stringify(x));
  const players = () => [...players0, ...st.guests];
  const courseOf = id => courses.find(c => c.id === id);
  const holesOf = cid => courseOf(cid).par.map((par, i) => ({ course_id: cid, hole_no: i + 1, par, si: courseOf(cid).si[i] }));
  const allHoles = () => courses.flatMap(c => holesOf(c.id));
  const allTees = () => courses.flatMap(c => c.tees.map(t => ({ ...t, course_id: c.id, is_default: !!t.default, par_total: c.par.reduce((a, b) => a + b, 0) })));
  const cardOf = id => st.cards.find(c => c.id === id) || (() => { throw fail('Carte inconnue'); })();
  // sondage de démonstration : jeudi prochain, clôture le lundi 17h30 (heure de Maurice)
  if (!st.polls) {
    const d = new Date(); d.setDate(d.getDate() + ((4 - d.getDay() + 7) % 7 || 7));
    const c = new Date(d); c.setDate(c.getDate() - 3);
    st.polls = [{ id: 'poll-demo', play_date: iso(d), course_id: 'mont_choisy', opens_at: new Date(Date.now() - 86400000).toISOString(), closes_at: `${iso(c)}T17:30:00+04:00` }];
    st.poll_answers = players0.filter(p => !p.is_guest).slice(0, 9).map((p, i) => ({ poll_id: 'poll-demo', player_id: p.id, answer: i % 4 === 3 ? 'non' : 'oui' }));
    save();
  }
  const partOf = card => st.participations.find(p => p.id === card.participation_id);
  const needAdmin = () => { if (!st.admin) throw fail('Réservé à l\'admin'); };

  return {
    demo: true,
    async checkCode() { return true; },
    async players() { return clone(players()); },
    async polls() { return clone(st.polls).sort((a, b) => (a.play_date < b.play_date ? 1 : -1)).map(p => ({ ...p, courses: p.course_id ? { name: courseOf(p.course_id).name } : null })); },
    async pollAnswers(id) { return clone(st.poll_answers.filter(a => a.poll_id === id)); },
    async settings() { return Object.entries(st.settings).map(([key, value]) => ({ key, value })); },
    async courses() { return courses.map((c, i) => ({ id: c.id, name: c.name, sort: i })); },
    async tees() { return allTees(); },
    async rounds() { return clone(st.rounds).sort((a, b) => (a.played_on < b.played_on ? 1 : -1)).map(r => ({ ...r, courses: { name: courseOf(r.course_id).name } })); },
    async round(id) {
      const r = st.rounds.find(x => x.id === id), c = courseOf(r.course_id);
      const parts = st.participations.filter(p => p.round_id === id), cards = st.cards.filter(x => parts.some(p => p.id === x.participation_id));
      return clone({ round: r, course: { id: c.id, name: c.name }, holes: holesOf(c.id), groups: st.groups.filter(g => g.round_id === id), participations: parts,
        tees: allTees().filter(t => t.course_id === c.id), cards, hole_scores: st.hole_scores.filter(s => cards.some(x => x.id === s.card_id)), nearest: st.nearest.filter(x => x.round_id === id) });
    },
    async year(y) {
      const rounds = st.rounds.filter(r => r.played_on.slice(0, 4) === String(y)), rids = new Set(rounds.map(r => r.id));
      const participations = st.participations.filter(p => rids.has(p.round_id)), pids = new Set(participations.map(p => p.id));
      const cards = st.cards.filter(c => pids.has(c.participation_id)), cids = new Set(cards.map(c => c.id));
      return clone({ rounds, participations, cards, hole_scores: st.hole_scores.filter(s => cids.has(s.card_id)), holes: allHoles(), nearest: st.nearest.filter(x => rids.has(x.round_id)),
        settings: Object.entries(st.settings).map(([key, value]) => ({ key, value })) });
    },
    async send(op, code, actor) {
      if (!actor) throw fail('Joueur inconnu : choisis ton nom');
      const roundOfPart = pa => pa.round_id;
      const inRound = rid => st.admin || st.participations.some(p => p.round_id === rid && p.player_id === actor);
      const msg = 'Tu ne fais pas partie du tirage de cette journée : consultation seulement';
      if (op.type === 'score') {
        const c = cardOf(op.card);
        if (!inRound(roundOfPart(partOf(c)))) throw fail(msg);
        if (c.status === 'validee') throw fail('Carte validée : scores verrouillés');
        st.hole_scores = st.hole_scores.filter(s => !(s.card_id === c.id && s.hole_no === op.hole));
        if (op.strokes != null || op.pickup) st.hole_scores.push({ card_id: c.id, hole_no: op.hole, strokes: op.strokes, pickup: !!op.pickup, updated_by: actor });
      } else if (op.type === 'status') {
        const c = cardOf(op.card), pa = partOf(c);
        if (!inRound(pa.round_id)) throw fail(msg);
        if (c.status === 'validee') throw fail('Carte validée : seul l\'admin peut la rouvrir');
        if (op.status === 'validee') {
          if (c.status !== 'a_verifier') throw fail('Passe d\'abord la carte à vérifier');
          if (pa.player_id === actor) throw fail('Un joueur ne peut pas valider sa propre carte');
          if (!st.participations.some(p => p.player_id === actor && p.group_id === pa.group_id)) throw fail('Seul un joueur du même groupe peut valider cette carte');
          if (st.hole_scores.filter(s => s.card_id === c.id).length < 18) throw fail('Carte incomplète : 18 trous attendus');
          c.validated_by = actor;
        }
        c.status = op.status;
      } else if (op.type === 'handicap') {
        const pa = st.participations.find(p => p.id === op.participation);
        if (!inRound(pa.round_id)) throw fail(msg);
        if (st.cards.some(c => c.participation_id === pa.id && c.status === 'validee')) throw fail('Carte validée : handicap verrouillé');
        pa.handicap_index = op.index; pa.playing_handicap = op.playing;
      } else if (op.type === 'poll') {
        const po = st.polls.find(x => x.id === op.poll);
        if (!po) throw fail('Sondage inconnu');
        if (!st.admin && (Date.now() < Date.parse(po.opens_at) || Date.now() > Date.parse(po.closes_at))) throw fail('Le sondage est clos : contacte l\'admin pour modifier ta réponse');
        st.poll_answers = st.poll_answers.filter(x => !(x.poll_id === op.poll && x.player_id === actor));
        if (op.answer) st.poll_answers.push({ poll_id: op.poll, player_id: actor, answer: op.answer });
      } else if (op.type === 'nearest') {
        if (!inRound(op.round)) throw fail(msg);
        st.nearest = st.nearest.filter(x => !(x.round_id === op.round && x.hole_no === op.hole));
        if (op.player) st.nearest.push({ round_id: op.round, hole_no: op.hole, player_id: op.player });
      }
      save();
    },

    // ---- administration ----
    isAdmin: () => !!st.admin,
    async adminLogin(email) { if (!email) throw fail('Saisis un e-mail'); st.admin = true; save(); },
    adminLogout() { st.admin = false; save(); },
    async createRound({ played_on, course_id }) {
      needAdmin();
      if (st.rounds.some(r => r.played_on === played_on)) throw fail('Une journée existe déjà à cette date');
      const r = { id: uid('r'), played_on, status: 'preparation', course_id }; st.rounds.push(r); save(); return clone(r);
    },
    async saveDraw({ round_id, groups }) {
      needAdmin();
      for (const g of groups) {
        const gid = uid('g');
        st.groups.push({ id: gid, round_id, number: g.number, tee_time: g.tee_time || null, marker_player_id: g.marker_player_id || null });
        for (const m of g.members) {
          const pid = uid('pa');
          st.participations.push({ id: pid, round_id, player_id: m.player_id, group_id: gid, tee_id: m.tee_id, handicap_index: m.index, playing_handicap: m.playing });
          st.cards.push({ id: uid('ca'), participation_id: pid, status: 'en_cours', mode: 'net', excluded_from_net: false, replaced: false });
        }
      }
      save();
    },
    async patchParticipation(id, v) { needAdmin(); Object.assign(st.participations.find(p => p.id === id), v); save(); },
    async removeParticipation(id) {
      needAdmin();
      const cs = st.cards.filter(c => c.participation_id === id);
      st.hole_scores = st.hole_scores.filter(s => !cs.some(c => c.id === s.card_id));
      st.cards = st.cards.filter(c => c.participation_id !== id); st.participations = st.participations.filter(p => p.id !== id); save();
    },
    async patchGroup(id, v) { needAdmin(); Object.assign(st.groups.find(g => g.id === id), v); save(); },
    async addGuest(name, code) { needAdmin(); const p = { id: uid('p'), display_name: name, code, is_guest: true, active: true }; st.guests.push(p); save(); return clone(p); },
    async setGross(cardId) {
      needAdmin();
      const c = cardOf(cardId), pa = partOf(c);
      if (players().find(p => p.id === pa.player_id)?.is_guest) throw fail('Un invité n\'a pas de classement annuel');
      if (c.replaced) throw fail('Une carte remplacée ne peut pas redevenir la carte gross');
      for (const o of st.cards) {
        const op = partOf(o);
        if (op.player_id === pa.player_id && o.mode === 'gross' && !o.replaced && o.id !== c.id) { o.replaced = true; o.excluded_from_net = true; }
      }
      c.mode = 'gross'; c.excluded_from_net = true; c.replaced = false; save();
    },
    async resetGross(cardId, reason) {
      needAdmin(); if (!String(reason || '').trim()) throw fail('Motif obligatoire');
      Object.assign(cardOf(cardId), { mode: 'net', excluded_from_net: false, replaced: false }); save();
    },
    async adminCardStatus(cardId, status) { needAdmin(); cardOf(cardId).status = status; save(); },
    async createPoll({ play_date, course_id, closes_at }) {
      needAdmin();
      if (st.polls.some(p => p.play_date === play_date)) throw fail('Un sondage existe déjà à cette date');
      const p = { id: uid('poll'), play_date, course_id: course_id || null, opens_at: new Date().toISOString(), closes_at }; st.polls.push(p); save(); return clone(p);
    },
    async patchPoll(id, values) { needAdmin(); Object.assign(st.polls.find(p => p.id === id), values); save(); },
    async setPollAnswer(poll_id, player_id, answer) {
      needAdmin();
      st.poll_answers = st.poll_answers.filter(x => !(x.poll_id === poll_id && x.player_id === player_id));
      if (answer) st.poll_answers.push({ poll_id, player_id, answer });
      save();
    },
    async setRoundStatus(id, status) { needAdmin(); st.rounds.find(r => r.id === id).status = status; save(); },
    async setSetting(key, value) { needAdmin(); st.settings[key] = value; save(); },
    async setMemberCode() { needAdmin(); },
    async auditLog() { return []; },
    reset() { storage.removeItem(KEY); },
  };
}
