// Accès à Supabase (API REST, sans bibliothèque). Les erreurs portent .network (réseau/serveur indisponible) ou .business (refus des règles).
// Les membres utilisent la clé publique + les fonctions de saisie ; l'admin se connecte (e-mail + mot de passe) et utilise son jeton.
export function createApi({ supabaseUrl, supabaseAnonKey }, storage = null) {
  const SKEY = 'golf.admin';
  let session = null;
  try { session = JSON.parse(storage?.getItem(SKEY) || 'null'); } catch { /* aucune session */ }
  const saveSession = s => { session = s; if (storage) { if (s) storage.setItem(SKEY, JSON.stringify(s)); else storage.removeItem(SKEY); } };
  const PAGE = 1000;

  // Clé publique : si c'est une clé « sb_publishable_... » (pas un jeton JWT), elle ne va que dans l'en-tête apikey
  const isJwt = /^eyJ/.test(supabaseAnonKey);
  const hdr = extra => {
    const h = { apikey: supabaseAnonKey, 'Content-Type': 'application/json', ...extra };
    const bearer = session?.access_token || (isJwt ? supabaseAnonKey : '');
    if (bearer) h.Authorization = 'Bearer ' + bearer;
    return h;
  };

  async function raw(url, opts) {
    try { return await fetch(url, opts); } catch { throw Object.assign(new Error('Pas de réseau'), { network: true }); }
  }
  async function auth(body, grant) {
    const r = await raw(`${supabaseUrl}/auth/v1/token?grant_type=${grant}`, { method: 'POST', headers: { apikey: supabaseAnonKey, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error_description || j.msg || 'Connexion refusée'), r.status >= 500 ? { network: true } : { business: true });
    saveSession({ access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + (j.expires_in || 3600) * 1000 });
  }

  async function call(path, opts = {}, retry = true) {
    const r = await raw(`${supabaseUrl}/rest/v1/${path}`, { ...opts, headers: hdr(opts.headers) });
    const text = await r.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { /* corps vide */ }
    if (r.status === 401 && session && retry) {
      try { await auth({ refresh_token: session.refresh_token }, 'refresh_token'); }
      catch (e) {
        if (e.network) throw e;   // pas de réseau : on garde la session admin, on réessaiera
        saveSession(null); throw Object.assign(new Error('Session admin expirée : reconnecte-toi.'), { business: true });
      }
      return call(path, opts, false);
    }
    if (r.status === 416) return [];   // page au-delà de la fin
    if (!r.ok) {
      const transient = r.status >= 500 || r.status === 408 || r.status === 429;
      throw Object.assign(new Error((body && body.message) || 'Erreur ' + r.status), transient ? { network: true } : { business: true });
    }
    return body;
  }

  // Lecture complète, page par page (Supabase limite à 1000 lignes par requête)
  async function get(q) {
    const out = [];
    for (let from = 0; ; from += PAGE) {
      const rows = await call(q, { headers: { Range: `${from}-${from + PAGE - 1}`, 'Range-Unit': 'items' } });
      out.push(...rows);
      if (rows.length < PAGE) return out;
    }
  }
  const rpc = (fn, args) => call('rpc/' + fn, { method: 'POST', body: JSON.stringify(args) });
  const inList = ids => '(' + ids.join(',') + ')';
  const chunks = (ids, n = 50) => Array.from({ length: Math.ceil(ids.length / n) }, (_, i) => ids.slice(i * n, i * n + n));
  const getIn = async (table, col, ids, extra = '') => (await Promise.all(chunks(ids).map(c => get(`${table}?${col}=in.${inList(c)}${extra}`)))).flat();
  const insert = (table, rows) => call(table, { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(rows) });
  const patch = (table, filter, values) => call(`${table}?${filter}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(values) });

  return {
    demo: false,
    async checkCode(code) { return (await rpc('check_member_code', { p_code: code })) === true; },
    players: () => get('players?select=*&active=eq.true&order=display_name'),
    settings: () => get('settings?select=*'),
    courses: () => get('courses?select=id,name,sort&order=sort'),
    tees: () => get('v_tees?select=*&order=course_id'),
    async vapidKey() { return (await rpc('vapid_public_key', {})) || null; },
    savePush: (sub, code, actor) => rpc('save_push_subscription', { p_code: code, p_actor: actor, p_endpoint: sub.endpoint, p_p256dh: sub.p256dh, p_auth: sub.auth }),
    deletePush: (endpoint, code, actor) => rpc('delete_push_subscription', { p_code: code, p_actor: actor, p_endpoint: endpoint }),
    polls: () => get('polls?select=*,courses(name)&order=play_date.desc&limit=4'),
    pollAnswers: id => get(`poll_answers?poll_id=eq.${id}`),
    rounds: () => get('rounds?select=id,played_on,status,course_id,courses(name)&order=played_on.desc&limit=40'),
    async round(id) {
      const [rounds, groups, participations, nearest] = await Promise.all([
        get(`rounds?select=*,courses(id,name)&id=eq.${id}`), get(`groups?round_id=eq.${id}`),
        get(`participations?round_id=eq.${id}`), get(`nearest_entries?round_id=eq.${id}`),
      ]);
      const round = rounds[0];
      const ids = participations.map(p => p.id);
      const [holes, tees, cards] = await Promise.all([
        get(`holes?course_id=eq.${round.course_id}&order=hole_no`), get(`tees?course_id=eq.${round.course_id}`),
        ids.length ? getIn('cards', 'participation_id', ids) : [],
      ]);
      const hole_scores = cards.length ? await getIn('hole_scores', 'card_id', cards.map(c => c.id)) : [];
      return { round, course: round.courses, holes, groups, participations, tees, cards, hole_scores, nearest };
    },
    // Tirages passés (du plus ancien au plus récent) : historique importé + journées de la nouvelle appli, pour varier les groupes
    async pairHistory() {
      const [old, rounds, groups, parts] = await Promise.all([
        get('history_groups?select=played_on,group_no,player_ids&order=played_on').catch(() => []),
        get('rounds?select=id,played_on&status=in.(en_cours,terminee)').catch(() => []),
        get('groups?select=id,round_id').catch(() => []),
        get('participations?select=round_id,group_id,player_id&group_id=not.is.null').catch(() => []),
      ]);
      const byDate = new Map();
      for (const h of old) { if (!byDate.has(h.played_on)) byDate.set(h.played_on, []); byDate.get(h.played_on).push(h.player_ids); }
      const dateOf = new Map(rounds.map(r => [r.id, r.played_on]));
      const byGroup = new Map();
      for (const p of parts) { if (!dateOf.has(p.round_id)) continue; if (!byGroup.has(p.group_id)) byGroup.set(p.group_id, []); byGroup.get(p.group_id).push(p.player_id); }
      for (const g of groups) {
        const d = dateOf.get(g.round_id), ids = byGroup.get(g.id);
        if (!d || !ids) continue;
        const key = d + '#' + g.round_id;
        if (!byDate.has(key)) byDate.set(key, []);
        byDate.get(key).push(ids);
      }
      return [...byDate.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([, gs]) => gs);
    },
    async year(y) {
      const rounds = await get(`rounds?select=*&played_on=gte.${y}-01-01&played_on=lte.${y}-12-31&order=played_on`);
      const rids = rounds.map(r => r.id);
      const [holes, settings] = await Promise.all([get('holes?select=*'), get('settings?select=*')]);
      const participations = rids.length ? await getIn('participations', 'round_id', rids) : [];
      const cards = participations.length ? await getIn('cards', 'participation_id', participations.map(p => p.id)) : [];
      const [hole_scores, nearest] = await Promise.all([cards.length ? getIn('hole_scores', 'card_id', cards.map(c => c.id)) : [], rids.length ? getIn('nearest_entries', 'round_id', rids) : []]);
      const [history_scores, history_nearest] = await Promise.all([
        get(`history_scores?select=*&played_on=gte.${y}-01-01&played_on=lte.${y}-12-31`).catch(() => []),
        get(`history_nearest?select=*&played_on=gte.${y}-01-01&played_on=lte.${y}-12-31`).catch(() => []),
      ]);
      return { rounds, participations, cards, hole_scores, holes, nearest, settings, history_scores, history_nearest };
    },
    send(op, code, actor) {
      const a = { p_code: code, p_actor: actor };
      switch (op.type) {
        case 'score': return rpc('save_hole_score', { ...a, p_card: op.card, p_hole: op.hole, p_strokes: op.strokes, p_pickup: !!op.pickup });
        case 'status': return rpc('set_card_status', { ...a, p_card: op.card, p_status: op.status });
        case 'handicap': return rpc('set_participation_handicap', { ...a, p_participation: op.participation, p_index: op.index, p_playing: op.playing });
        case 'nearest': return rpc('set_nearest', { ...a, p_round: op.round, p_hole: op.hole, p_player: op.player });
        case 'poll': return rpc('answer_poll', { ...a, p_poll: op.poll, p_answer: op.answer });
      }
      throw new Error('Opération inconnue');
    },

    // ---- administration (compte e-mail + mot de passe) ----
    isAdmin: () => !!session,
    async adminLogin(email, password) {
      await auth({ email, password }, 'password');
      const rows = await get('app_users?select=role');
      if (!rows.length) { saveSession(null); throw Object.assign(new Error('Ce compte n\'est pas administrateur.'), { business: true }); }
    },
    adminLogout() { saveSession(null); },
    async createRound({ played_on, course_id }) { return (await insert('rounds', [{ played_on, course_id, status: 'preparation' }]))[0]; },
    async saveDraw({ round_id, groups }) {
      const gs = await insert('groups', groups.map(g => ({ round_id, number: g.number, tee_time: g.tee_time || null, marker_player_id: g.marker_player_id || null })));
      const byNumber = new Map(gs.map(g => [g.number, g.id]));
      const rows = groups.flatMap(g => g.members.map(m => ({ round_id, player_id: m.player_id, group_id: byNumber.get(g.number), tee_id: m.tee_id, handicap_index: m.index, playing_handicap: m.playing })));
      await insert('participations', rows);
    },
    patchParticipation: (id, values) => patch('participations', `id=eq.${id}`, values),
    removeParticipation: id => call(`participations?id=eq.${id}`, { method: 'DELETE' }),
    patchGroup: (id, values) => patch('groups', `id=eq.${id}`, values),
    async addGuest(name, code) { return (await insert('players', [{ display_name: name, code, is_guest: true }]))[0]; },
    setGross: card => rpc('set_gross_card', { p_card: card }),
    resetGross: (card, reason) => rpc('admin_reset_gross', { p_card: card, p_reason: reason }),
    adminCardStatus: (card, status) => patch('cards', `id=eq.${card}`, { status }),
    setRoundStatus: (id, status) => patch('rounds', `id=eq.${id}`, { status }),
    // Envoi de notifications (fonction Supabase « send-push », réservée à l'admin connecté)
    async notify(type, extra = {}, retry = true) {
      const r = await raw(`${supabaseUrl}/functions/v1/send-push`, { method: 'POST', headers: hdr(), body: JSON.stringify({ type, ...extra }) });
      const j = await r.json().catch(() => ({}));
      if (r.status === 401 && session && retry) { await auth({ refresh_token: session.refresh_token }, 'refresh_token'); return this.notify(type, extra, false); }
      if (!r.ok) throw Object.assign(new Error(j.error || 'Envoi impossible'), r.status >= 500 ? { network: true } : { business: true });
      return j;
    },
    async createPoll({ play_date, course_id, closes_at }) { return (await insert('polls', [{ play_date, course_id: course_id || null, closes_at }]))[0]; },
    patchPoll: (id, values) => patch('polls', `id=eq.${id}`, values),
    async setPollAnswer(poll_id, player_id, answer) {
      if (!answer) return call(`poll_answers?poll_id=eq.${poll_id}&player_id=eq.${player_id}`, { method: 'DELETE' });
      return call('poll_answers?on_conflict=poll_id,player_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify([{ poll_id, player_id, answer }]) });
    },
    setSetting: (key, value) => call('settings?on_conflict=key', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify([{ key, value }]) }),
    setMemberCode: code => rpc('admin_set_member_code', { p_code: code }),
    auditLog: () => get('audit_log?select=at,actor,table_name,action,record&order=at.desc&limit=100'),
  };
}
