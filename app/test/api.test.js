import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApi } from '../src/api.js';

// Faux serveur Supabase (PostgREST) : vérifie les adresses appelées, les en-têtes et la forme des réponses.
function start(handler) {
  return new Promise(res => {
    const calls = [];
    const srv = http.createServer((req, rsp) => {
      let body = ''; req.on('data', d => body += d);
      req.on('end', () => { calls.push({ method: req.method, url: req.url, headers: req.headers, body }); handler(req, rsp, body); });
    }).listen(0, () => res({ srv, calls, url: 'http://127.0.0.1:' + srv.address().port }));
  });
}
const json = (rsp, status, obj) => { rsp.writeHead(status, { 'content-type': 'application/json' }); rsp.end(obj === undefined ? '' : JSON.stringify(obj)); };

test('api : charge une journée complète et envoie la clé publique', async () => {
  const tables = {
    rounds: [{ id: 'r1', course_id: 'mc', played_on: '2027-01-14', courses: { id: 'mc', name: 'Mont Choisy' } }],
    groups: [{ id: 'g1' }], participations: [{ id: 'p1', player_id: 'a' }, { id: 'p2', player_id: 'b' }],
    nearest_entries: [], holes: [{ hole_no: 1, par: 4, si: 1 }], tees: [{ id: 't' }],
    cards: [{ id: 'c1', participation_id: 'p1' }], hole_scores: [{ card_id: 'c1', hole_no: 1, strokes: 4 }],
  };
  const { srv, calls, url } = await start((req, rsp) => json(rsp, 200, tables[req.url.split('?')[0].split('/').pop()] ?? []));
  const api = createApi({ supabaseUrl: url, supabaseAnonKey: 'cle-publique' });
  const d = await api.round('r1');
  assert.equal(d.course.name, 'Mont Choisy');
  assert.equal(d.hole_scores.length, 1);
  assert.ok(calls.every(c => c.headers.apikey === 'cle-publique'));
  assert.ok(calls.some(c => c.url.includes('cards?participation_id=in.(p1,p2)')));
  srv.close();
});

test('api : les saisies appellent les bonnes fonctions avec le code et le joueur', async () => {
  const { srv, calls, url } = await start((req, rsp) => json(rsp, 200, undefined));
  const api = createApi({ supabaseUrl: url, supabaseAnonKey: 'k' });
  await api.send({ type: 'score', card: 'c1', hole: 3, strokes: 5, pickup: false }, 'CODE', 'joueur1');
  await api.send({ type: 'status', card: 'c1', status: 'validee' }, 'CODE', 'joueur1');
  await api.send({ type: 'nearest', round: 'r1', hole: 4, player: null }, 'CODE', 'joueur1');
  assert.equal(calls[0].url, '/rest/v1/rpc/save_hole_score');
  assert.deepEqual(JSON.parse(calls[0].body), { p_code: 'CODE', p_actor: 'joueur1', p_card: 'c1', p_hole: 3, p_strokes: 5, p_pickup: false });
  assert.equal(calls[1].url, '/rest/v1/rpc/set_card_status');
  assert.equal(JSON.parse(calls[2].body).p_player, null);
  srv.close();
});

test('api : refus des règles = business ; serveur indisponible ou coupé = network', async () => {
  let mode = 'refus';
  const { srv, url } = await start((req, rsp) => mode === 'refus' ? json(rsp, 400, { message: 'Carte validée : scores verrouillés' }) : json(rsp, 503, { message: 'indisponible' }));
  const api = createApi({ supabaseUrl: url, supabaseAnonKey: 'k' });
  const op = { type: 'score', card: 'c', hole: 1, strokes: 4 };
  await assert.rejects(api.send(op, 'C', 'a'), e => e.business && /verrouill/.test(e.message));
  mode = '503';
  await assert.rejects(api.send(op, 'C', 'a'), e => e.network);
  srv.close();
  await new Promise(r => setTimeout(r, 50));
  await assert.rejects(api.send(op, 'C', 'a'), e => e.network);     // plus de serveur : hors ligne
});

test('api : check_member_code renvoie un booléen', async () => {
  const { srv, url } = await start((req, rsp, body) => json(rsp, 200, JSON.parse(body).p_code === 'bon'));
  const api = createApi({ supabaseUrl: url, supabaseAnonKey: 'k' });
  assert.equal(await api.checkCode('bon'), true);
  assert.equal(await api.checkCode('faux'), false);
  srv.close();
});

test('api : lecture page par page au-delà de 1000 lignes (limite Supabase)', async () => {
  const { srv, calls, url } = await start((req, rsp) => {
    const from = +/^items|^(\d+)-/.exec(req.headers.range || '0-0')[1] || +(req.headers.range || '0').split('-')[0];
    const n = from === 0 ? 1000 : from === 1000 ? 1000 : 250;
    json(rsp, 206, Array.from({ length: n }, (_, i) => ({ i: from + i })));
  });
  const api = createApi({ supabaseUrl: url, supabaseAnonKey: 'k' });
  const rows = await api.players();
  assert.equal(rows.length, 2250);
  assert.equal(calls.length, 3);
  srv.close();
});

test('api admin : connexion, jeton utilisé ensuite, création du tirage', async () => {
  const store = {}; const storage = { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v; }, removeItem: k => { delete store[k]; } };
  const { srv, calls, url } = await start((req, rsp, body) => {
    if (req.url.startsWith('/auth/v1/token')) return json(rsp, 200, { access_token: 'JETON', refresh_token: 'R', expires_in: 3600 });
    if (req.url.startsWith('/rest/v1/app_users')) return json(rsp, 200, [{ role: 'admin' }]);
    if (req.url === '/rest/v1/groups') return json(rsp, 201, JSON.parse(body).map((g, i) => ({ ...g, id: 'G' + g.number })));
    json(rsp, 201, JSON.parse(body || '[]').map(r => ({ ...r, id: 'X' })));
  });
  const api = createApi({ supabaseUrl: url, supabaseAnonKey: 'cle' }, storage);
  assert.equal(api.isAdmin(), false);
  await api.adminLogin('a@b.c', 'pw');
  assert.equal(api.isAdmin(), true);
  assert.ok(JSON.parse(store['golf.admin']).access_token === 'JETON');
  await api.saveDraw({ round_id: 'R1', groups: [{ number: 1, tee_time: '08:00', marker_player_id: 'p1', members: [{ player_id: 'p1', tee_id: 't', index: 12.3, playing: 14 }] }] });
  const last = calls[calls.length - 1];
  assert.equal(last.url, '/rest/v1/participations');
  assert.equal(last.headers.authorization, 'Bearer JETON');      // les actions admin utilisent le jeton du compte
  assert.deepEqual(JSON.parse(last.body)[0], { round_id: 'R1', player_id: 'p1', group_id: 'G1', tee_id: 't', handicap_index: 12.3, playing_handicap: 14 });
  api.adminLogout();
  assert.equal(api.isAdmin(), false);
  srv.close();
});

test('api admin : un compte sans ligne app_users est refusé', async () => {
  const { srv, url } = await start((req, rsp) => req.url.startsWith('/auth') ? json(rsp, 200, { access_token: 'J', refresh_token: 'R' }) : json(rsp, 200, []));
  const api = createApi({ supabaseUrl: url, supabaseAnonKey: 'k' }, { getItem: () => null, setItem() {}, removeItem() {} });
  await assert.rejects(api.adminLogin('x@y.z', 'pw'), /pas administrateur/);
  assert.equal(api.isAdmin(), false);
  srv.close();
});

test('api : une clé sb_publishable_ ne part que dans apikey, un jeton JWT aussi dans Authorization', async () => {
  const { srv, calls, url } = await start((req, rsp) => json(rsp, 200, []));
  await createApi({ supabaseUrl: url, supabaseAnonKey: 'sb_publishable_abc' }).players();
  await createApi({ supabaseUrl: url, supabaseAnonKey: 'eyJhbGciOi.payload.sig' }).players();
  assert.equal(calls[0].headers.apikey, 'sb_publishable_abc');
  assert.equal(calls[0].headers.authorization, undefined);
  assert.equal(calls[1].headers.authorization, 'Bearer eyJhbGciOi.payload.sig');
  srv.close();
});
