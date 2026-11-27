// Interface téléphone : lien -> choix du nom -> journées / saisie / classements / admin (tirage, gross, corrections).
import { CONFIG } from '../config.js';
import { createApi } from './api.js';
import { createDemoApi } from './demo.js';
import { createQueue } from './queue.js';
import { buildRoundView, canEdit, canValidate, inDraw, stepScore, strokesReceived, crossScore } from './model.js';
import { buildYear, playerSheet } from './year.js';
import { makeGroups, groupSizes, teeTimes, whatsappText, whatsappLink, whatsappToLink, golfMail, mailtoLink, nextGuestCode } from './draw.js';
import { holePoints, playingHandicap } from '../../engine/engine.js';
import { prepDay, prepNearestDay, prepNearestAnnual, prepAnnual, prepDraw } from './sharedata.js';
import { draw as drawImage, toBlob, shareFiles, loadLogo, loadFonts } from './share.js';

const $app = document.getElementById('app');
const ls = window.localStorage;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const FIRST_YEAR = 2026;   // saison 2026 = historique importé de l'ancienne appli
const seasonNow = () => Math.max(FIRST_YEAR, new Date().getFullYear());
const fmtDate = d => new Date(d + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const STATUS = { en_cours: 'En cours', a_verifier: 'À vérifier', validee: 'Validée ✔' };

const S = {
  screen: 'loading', code: ls.getItem('golf.code') || '', actor: ls.getItem('golf.actor') || '',
  players: [], rounds: [], roundId: null, data: null, view: null, groupIdx: 0, hole: 1, online: true, toast: '', error: '',
  push: { state: 'unknown' }, contacts: {}, polls: [], poll: null, pollAnswers: [], year: seasonNow(), yearData: null, sheetId: null, courses: [], tees: [], draw: null, guestsOpen: false, newCode: '',
};
let api, queue;
const isAdmin = () => !!api && api.isAdmin();

// ------------------------------------------------------------------ démarrage
async function boot() {
  const m = /[#&]c=([^&]+)/.exec(location.hash);   // le code est dans le fragment : jamais envoyé à un serveur
  if (m) { S.code = decodeURIComponent(m[1]); ls.setItem('golf.code', S.code); history.replaceState(null, '', location.pathname + location.search); }
  if (!S.code && CONFIG.groupCode) S.code = CONFIG.groupCode;
  const demo = !CONFIG.supabaseUrl || /[?&]demo/.test(location.search);
  api = demo ? await createDemoApi(ls) : createApi(CONFIG, ls);
  queue = createQueue({ getItem: () => null, setItem() {} });   // en mémoire seulement : sert à réessayer si la connexion saute une seconde
  if (!api.demo && !S.code && !isAdmin()) return go('nocode');
  try {
    S.players = await api.players();
    if (!api.demo && !isAdmin() && !(await api.checkCode(S.code))) { ls.removeItem('golf.code'); S.code = ''; return go('nocode', 'Ce lien n\'est plus valable. Demande le nouveau lien dans le groupe WhatsApp.'); }
  } catch { return go('offline'); }
  if (!S.players.length) return go('offline');
  if (!S.actor || !S.players.some(p => p.id === S.actor)) return go('who');
  await openHome();
}

function go(screen, error = '') { S.screen = screen; S.error = error; render(); window.scrollTo(0, 0); }

async function loadPoll() {
  try {
    S.polls = await api.polls();
    const today = localDate();
    S.poll = S.polls.filter(p => p.play_date >= today).sort((a, b) => (a.play_date < b.play_date ? -1 : 1))[0] || null;
    S.pollAnswers = S.poll ? await api.pollAnswers(S.poll.id) : [];
  } catch { /* le sondage n'est pas essentiel */ }
}

async function openHome() {
  S.roundId = null;
  try { S.rounds = await api.rounds(); S.online = true; }
  catch { S.online = false; }
  await loadPoll();
  await refreshPush();
  go('home');
  flush();
}

async function openRound(id) {
  S.roundId = id; S.data = null; S.view = null;
  go('round');
  if (isAdmin()) { try { await loadContacts(); } catch { /* sans contacts */ } }
  await refresh();
  if (S.view) S.groupIdx = Math.max(0, S.view.groups.findIndex(g => g.members.some(m => m.playerId === S.actor)));
  render();
}

async function loadYear(y = S.year) {
  S.year = y;
  try { const d = await api.year(y); S.yearData = buildYear(d, S.players, y); S.online = true; }
  catch { S.online = false; }
}

async function openRanking(y = S.year) { S.yearData = null; go('ranking'); await loadYear(y); render(); }

// ------------------------------------------------------------------ données et synchronisation
async function refresh() {
  if (!S.roundId) return;
  try { S.data = await api.round(S.roundId); S.online = true; }
  catch { S.online = false; }
  rebuild();
  render();
}

function rebuild() { if (S.data) S.view = buildRoundView({ ...S.data, players: S.players }, queue.ops); }

async function flush() {
  if (!queue.size) return;
  const before = queue.rejected.length;
  const r = await queue.flush(op => api.send(op, S.code, S.actor));
  S.online = !(r.pending > 0 && !r.busy);
  if (queue.rejected.length > before) {
    toast('Refusé : ' + queue.rejected[queue.rejected.length - 1].message);
    queue.clearRejected();
  }
  if (S.roundId) await refresh(); else render();
}

function toast(msg) { S.toast = msg; render(); setTimeout(() => { if (S.toast === msg) { S.toast = ''; render(); } }, 6000); }
function addOp(op) { queue.add(op); rebuild(); render(); flush(); }

/** Action admin : envoyée tout de suite (pas de file hors ligne), erreur affichée. */
async function adminDo(fn, after) {
  try { await fn(); if (after) await after(); }
  catch (e) { toast(e.network ? 'Pas de réseau : action admin impossible hors ligne.' : e.message); }
}

window.addEventListener('online', () => flush());
setInterval(() => { if (['round', 'hole', 'recap'].includes(S.screen)) (queue.size ? flush() : refresh()); }, 10000);

// ------------------------------------------------------------------ affichage
function render() {
  const y = window.scrollY;
  const fn = { loading: () => '<p class="center">Chargement…</p>', offline: screenOffline, nocode: screenNoCode, who: screenWho, home: screenHome, round: screenRound, hole: screenHole, recap: screenRecap,
    ranking: screenRanking, sheet: screenSheet, share: screenShare, adminLogin: screenAdminLogin, admin: screenAdmin, draw: screenDraw, adminRound: screenAdminRound, guests: screenGuests, settings: screenSettings, code: screenCode, pollAdmin: screenPollAdmin, contacts: screenContacts }[S.screen];
  const showNav = !['loading', 'nocode', 'offline', 'who', 'hole', 'recap'].includes(S.screen);
  $app.innerHTML = header() + `<main class="${showNav ? 'withnav' : ''}">${fn()}</main>` + (showNav ? nav() : '') + (S.toast ? `<div class="toast">${esc(S.toast)}</div>` : '');
  window.scrollTo(0, y);
}

function header() {
  if (['loading', 'nocode', 'offline', 'who'].includes(S.screen)) return '<header><img class="hlogo" src="logo.png" alt=""><b>Jambon Golf</b></header>';
  const me = S.players.find(p => p.id === S.actor);
  const n = queue.size;
  const chip = !S.online ? `<span class="chip warn">Connexion perdue${n ? ' · ' + n + ' en attente' : ''}</span>` : n ? `<span class="chip">Envoi… ${n}</span>` : '<span class="chip ok">À jour</span>';
  return `<header><img class="hlogo" src="logo.png" alt=""><b>Jambon Golf</b>${api.demo ? '<span class="chip demo">DÉMO</span>' : ''}${isAdmin() ? '<span class="chip">Admin</span>' : ''}${chip}<button class="link" data-act="who">${esc(me?.display_name || '')}</button></header>`;
}

function nav() {
  const tab = ['home', 'round'].includes(S.screen) ? 'rounds' : ['ranking', 'sheet'].includes(S.screen) ? 'ranking' : S.screen === 'share' ? (S.share?.from === 'ranking' ? 'ranking' : 'rounds') : 'admin';
  const b = (id, label, act) => `<button class="${tab === id ? 'sel' : ''}" data-act="${act}">${label}</button>`;
  return `<nav>${b('rounds', 'Journées', 'home')}${b('ranking', 'Classement', 'ranking')}${b('admin', 'Admin', 'admin')}</nav>`;
}

function screenOffline() {
  return `<div class="card center"><img class="biglogo" src="logo.png" alt="Jambon Golf"><h2>Connexion requise</h2><p>L'appli a besoin d'internet pour fonctionner. Vérifie ta connexion puis réessaie.</p><button class="primary" data-act="retry">Réessayer</button></div>`;
}

function screenNoCode() {
  return `<div class="card"><img class="biglogo" src="logo.png" alt="Jambon Golf"><h2 class="center">Lien d'accès</h2>${S.error ? `<p class="err">${esc(S.error)}</p>` : ''}
    <p>Ouvre le lien que Tanguy a envoyé dans le groupe WhatsApp. Il suffit de le faire une fois sur ce téléphone.</p>
    <label class="fld">Ou colle ici ton code d'accès (ou le lien complet)<input type="text" id="code-in" autocapitalize="off" autocomplete="off" spellcheck="false" placeholder="jambon-…"></label>
    <button class="primary" data-act="code-enter">Valider le code</button>
    <button class="secondary" data-act="admin-direct">Je suis l'admin</button></div>`;
}

function screenWho() {
  const reg = S.players.filter(p => !p.is_guest), gst = S.players.filter(p => p.is_guest);
  const btn = p => `<button class="who ${p.id === S.actor ? 'sel' : ''}" data-act="pick" data-id="${esc(p.id)}">${esc(p.display_name)}</button>`;
  return `<div class="hero"><img class="biglogo" src="logo.png" alt="Jambon Golf"><p>Since 2019</p></div><div class="card"><h2>Qui es-tu ?</h2><p>Choisis ton nom, une seule fois. Il sera retenu sur ce téléphone.</p>
    <div class="grid2">${reg.map(btn).join('')}</div>${gst.length ? `<h3>Invités</h3><div class="grid2">${gst.map(btn).join('')}</div>` : ''}</div>`;
}

function screenHome() {
  const today = localDate();
  const list = S.rounds.map(r => `<button class="row big ${r.played_on === today ? 'today' : ''}" data-act="round" data-id="${esc(r.id)}">
      <span><b>${esc(fmtDate(r.played_on))}</b><br><small>${esc(r.courses?.name || '')} · ${{ preparation: 'tirage', en_cours: 'en cours', terminee: 'terminée' }[r.status] || ''}</small></span><span>${r.played_on === today ? 'Aujourd\'hui ›' : '›'}</span></button>`).join('');
  return `${pollCard()}${pushCard()}<div class="card"><h2>Journées</h2>${list || '<p>Aucune journée pour le moment. L\'admin doit préparer le tirage.</p>'}</div>
    ${api.demo ? '<p class="note">Mode démo : données fictives, uniquement dans ce téléphone. <button class="link" data-act="demoreset">Remettre à zéro</button></p>' : ''}`;
}

function memberLine(m) {
  return `<span><b>${esc(m.name)}</b>${m.isGuest ? ' <small>(invité)</small>' : ''}<br><small>HJ ${m.hj} · ${m.tee ? esc(m.tee.name) : ''} · ${STATUS[m.status]}</small></span>
    <span class="pts">${m.totals.net}<small> pts</small><br><small>${m.totals.played}/18</small></span>`;
}

function screenRound() {
  const v = S.view;
  if (!v) return '<p class="center">Chargement…</p>';
  const mine = inDraw(v, S.actor), adm = isAdmin();
  const tabs = v.groups.map((g, i) => `<button class="tab ${i === S.groupIdx ? 'sel' : ''}" data-act="group" data-i="${i}">Groupe ${g.number}${g.teeTime ? ' · ' + g.teeTime.slice(0, 5) : ''}</button>`).join('');
  const g = v.groups[S.groupIdx] || { members: [] };
  const done = v.round.status === 'terminee';
  const rank = v.ranking.rows.map(r => `<div class="rk"><span>${r.rank}</span><span>${esc(r.name)}${r.isGuest ? ' <small>(invité)</small>' : ''}${done && r.rank === 1 ? ' 🏆' : ''}</span><span>${r.net} pts <small>· ${r.played}/18</small></span></div>`).join('');
  const regs = v.members.filter(m => !m.isGuest);
  const nearest = v.par3.map(h => `<label class="ne">Trou ${h}<select data-act="nearest" data-hole="${h}" ${mine || adm ? '' : 'disabled'}>
      <option value="">—</option>${regs.map(m => `<option value="${esc(m.playerId)}" ${v.nearest.get(h) === m.playerId ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></label>`).join('');
  const par = v.holes.reduce((a, h) => a + h.par, 0);
  const idx = g.members.map(m => {
    const ed = canEdit(v, S.actor, m, adm);
    return `<label class="ne"><span>${esc(m.name)}<br><small>${m.index > 0 ? 'HJ ' + m.hj : '⚠ index à saisir'}</small></span>
      <input type="number" inputmode="decimal" step="0.1" min="-10" max="54" value="${m.index > 0 ? m.index : ''}" placeholder="index" data-act="index" data-part="${esc(m.participationId)}" data-par="${par}" ${ed ? '' : 'disabled'}></label>`;
  }).join('');
  return `<button class="link" data-act="home">‹ Journées</button>
    <div class="card"><h2>${esc(v.course.name)}</h2><p>${esc(fmtDate(v.round.played_on))}</p>
    ${mine || adm ? '' : '<p class="note">Tu ne fais pas partie du tirage de cette journée : consultation seulement.</p>'}
    <div class="tabs">${tabs}</div>
    ${g.members.map(m => `<div class="row">${memberLine(m)}</div>`).join('')}
    <button class="primary" data-act="open-hole">${mine || adm ? 'Saisir les scores' : 'Voir les scores'}</button>
    <button class="secondary" data-act="recap">Récap et validation</button>
    ${adm ? '<button class="secondary" data-act="admin-round">Gérer la journée (admin)</button>' : ''}</div>
    <div class="card"><h3>Tirage du jour</h3>${v.groups.map(gr => `<div class="dl ${gr.members.some(m => m.playerId === S.actor) ? 'mine' : ''}"><b>${esc(gr.teeTime ? String(gr.teeTime).slice(0, 5) : '--:--')}</b> <span>Groupe ${gr.number}</span><br><small>${gr.members.map(m => esc(m.name) + (m.isGuest ? ' (invité)' : '')).join(' · ')}</small></div>`).join('')}
      ${adm ? `<button class="secondary" data-act="share-open">Partager en images (WhatsApp)</button>${golfSendBlock(v)}` : ''}</div>
    ${mine || adm ? `<div class="card"><h3>Index officiel du jour (groupe ${g.number})</h3><p class="small">À vérifier avant de partir. Le handicap de jeu se recalcule tout seul.</p>${idx}</div>` : ''}
    <div class="card"><h3>Classement du jour ${done ? '' : '(provisoire)'}</h3>${rank || '<p>Pas encore de score.</p>'}</div>
    ${v.par3.length ? `<div class="card"><h3>Nearest</h3>${nearest}</div>` : ''}`;
}

function curGroup() { return S.view.groups[S.groupIdx] || { members: [] }; }

function firstOpenHole(g) {
  for (let h = 1; h <= 18; h++) if (g.members.some(m => !m.scores[h - 1].pickup && m.scores[h - 1].strokes == null)) return h;
  return 18;
}

function screenHole() {
  const v = S.view, g = curGroup(), h = S.hole, hole = v.holes[h - 1], adm = isAdmin();
  const dots = Array.from({ length: 18 }, (_, i) => {
    const done = g.members.every(m => m.scores[i].pickup || m.scores[i].strokes != null);
    return `<button class="dot ${done ? 'done' : ''} ${i + 1 === h ? 'cur' : ''}" data-act="goto" data-h="${i + 1}">${i + 1}</button>`;
  }).join('');
  const rows = g.members.map(m => {
    const sc = m.scores[h - 1], rec = strokesReceived(m.hj, hole.si), cross = crossScore(hole.par, rec);
    const ed = canEdit(v, S.actor, m, adm);
    const empty = !sc.pickup && sc.strokes == null;
    const label = sc.pickup ? '✗' : empty ? hole.par : sc.strokes;
    const pts = empty ? '' : holePoints({ par: hole.par, strokes: sc.strokes, pickup: sc.pickup, received: rec });
    const recTxt = rec > 0 ? ' · ' + '●'.repeat(Math.min(rec, 4)) + ' ' + rec + ' coup' + (rec > 1 ? 's' : '') : rec < 0 ? ' · rend ' + (-rec) : '';
    return `<div class="player ${m.status === 'validee' ? 'locked' : ''}">
      <div class="pl-top"><b>${esc(m.name)}</b><small>HJ ${m.hj}${recTxt}</small><span class="hp">${pts === '' ? '' : pts + ' pt' + (pts > 1 ? 's' : '')}</span></div>
      ${ed ? `<div class="step"><button class="pm" data-act="step" data-card="${esc(m.cardId)}" data-dir="-1">−</button>
        <button class="val ${empty ? 'proposed' : ''} ${sc.pickup ? 'pick' : ''}" data-act="confirm" data-card="${esc(m.cardId)}">${label}</button>
        <button class="pm" data-act="step" data-card="${esc(m.cardId)}" data-dir="1">+</button></div>
        <div class="hint">${empty ? 'Touche le chiffre pour valider le par' : (sc.pickup ? 'Ramassé (0 point) · ' : sc.strokes + 1 >= cross ? 'Prochain + = ✗ ramassé · ' : '') + `<button class="link" data-act="clear" data-card="${esc(m.cardId)}">Effacer</button>`}</div>`
      : `<div class="step ro"><span class="val ${empty ? 'proposed' : ''}">${empty ? '–' : label}</span></div>`}
    </div>`;
  }).join('');
  const allDone = g.members.every(m => m.scores[h - 1].pickup || m.scores[h - 1].strokes != null);
  return `<button class="link" data-act="round-back">‹ Groupe ${g.number}</button>
    <div class="holebar"><div><b>Trou ${h}</b></div><div>Par ${hole.par} · Index ${hole.si}</div></div>
    ${rows}
    <div class="nav"><button class="secondary" data-act="prev" ${h === 1 ? 'disabled' : ''}>‹ Précédent</button>
      <button class="${allDone ? 'primary pulse' : 'secondary'}" data-act="next" ${h === 18 ? 'disabled' : ''}>Suivant ›</button></div>
    <div class="dots">${dots}</div><button class="secondary" data-act="recap">Récap et validation</button>`;
}

function screenRecap() {
  const v = S.view, g = curGroup(), adm = isAdmin();
  const blocks = g.members.map(m => {
    const t = m.totals;
    const cells = t.perHole.map(p => `<span class="cell ${p.done ? '' : 'empty'}"><i>${p.hole}</i>${p.pickup ? '✗' : p.strokes ?? '·'}</span>`).join('');
    const ed = canEdit(v, S.actor, m, adm);
    let act = '';
    if (m.status === 'validee') act = `<p class="note">Validée${m.validatedBy ? ' par ' + esc(m.validatedBy) : ''}. Scores verrouillés.</p>`;
    else {
      if (m.status === 'en_cours' && ed) act = `<button class="primary" data-act="status" data-card="${esc(m.cardId)}" data-st="a_verifier" ${t.complete ? '' : 'disabled'}>${t.complete ? 'Passer à vérifier' : 'Il manque ' + (18 - t.played) + ' trou(s)'}</button>`;
      if (m.status === 'a_verifier') {
        if (canValidate(v, S.actor, m)) act += `<button class="primary" data-act="status" data-card="${esc(m.cardId)}" data-st="validee">Valider (conforme à la carte papier)</button>`;
        else if (m.playerId === S.actor) act += '<p class="note">Un autre joueur du groupe doit valider ta carte.</p>';
        if (ed) act += `<button class="secondary" data-act="status" data-card="${esc(m.cardId)}" data-st="en_cours">Rouvrir pour corriger</button>`;
      }
    }
    return `<div class="card"><div class="pl-top"><b>${esc(m.name)}</b><small>${STATUS[m.status]}</small></div>
      <div class="cells">${cells}</div>
      <p class="tot"><b>${t.net}</b> pts net · ${t.gross} pts brut · ${t.strokesTotal} coups</p>${act}</div>`;
  }).join('');
  return `<button class="link" data-act="round-back">‹ Groupe ${g.number}</button><h2>Récap du groupe ${g.number}</h2>${blocks}`;
}

// ------------------------------------------------------------------ classement annuel et fiches
function screenRanking() {
  const Y = S.yearData;
  const head = `<div class="yearbar"><button data-act="year" data-d="-1" ${S.year <= FIRST_YEAR ? 'disabled' : ''}>‹</button><b>Saison ${S.year}</b><button data-act="year" data-d="1">›</button></div>`;
  if (!Y) return head + (S.online ? '<p class="center">Chargement…</p>' : '<div class="card"><p>Connexion requise pour afficher le classement.</p><button class="primary" data-act="ranking">Réessayer</button></div>');
  const rows = Y.ranking.map(r => `<button class="rkrow" data-act="sheet" data-id="${esc(r.playerId)}"><span class="rkn">${r.rank}</span><span class="rkname">${esc(r.name)}<br><small>net ${r.netTotal} (${r.netCards.length} carte${r.netCards.length > 1 ? 's' : ''}) · brut ${r.grossPoints}</small></span><span class="rkt">${r.total}</span></button>`).join('');
  const ne = Y.nearest.map(r => `<div class="rk"><span>${r.rank}</span><span>${esc(r.name)}</span><span>${r.wins} nearest</span></div>`).join('');
  const gs = Y.guests.map(g => `<div class="rk"><span></span><span>${esc(g.player.display_name)}</span><span class="${g.atLimit ? 'err' : ''}">${g.count}/${g.limit} parties${g.exceeded ? ' · plafond dépassé' : g.atLimit ? ' · plafond atteint' : ''}</span></div>`).join('');
  const text = `🏆 Classement Les Jambons ${S.year}\n` + Y.ranking.filter(r => r.total > 0).map(r => `${r.rank}. ${r.name} : ${r.total} pts`).join('\n');
  return `${head}<div class="card"><h2>Classement annuel</h2>
    <p class="small">Total = ${Y.topN} meilleures cartes net validées + points brut de la carte gross. Seules les cartes validées comptent.</p>
    ${rows || '<p>Aucune carte validée pour le moment.</p>'}
    ${isAdmin() ? `<button class="secondary" data-act="share-annual">Partager en images (WhatsApp)</button>
    <a class="btn" href="${esc(whatsappLink(text))}" target="_blank" rel="noopener">Partager en texte</a>` : ''}</div>
    <div class="card"><h3>Nearest (annuel)</h3>${ne || '<p>Aucun nearest pour le moment.</p>'}</div>
    ${gs ? `<div class="card"><h3>Invités</h3>${gs}</div>` : ''}`;
}

function screenSheet() {
  const Y = S.yearData, p = S.players.find(x => x.id === S.sheetId);
  if (!Y || !p) return '<p class="center">Chargement…</p>';
  const sh = playerSheet(Y, p.id), adm = isAdmin();
  const roundName = c => { const r = S.rounds.find(x => x.id === c.roundId); return r?.courses?.name || ''; };
  const list = sh.cards.map(c => {
    const tags = [c.mode === 'gross' && !c.replaced ? '<span class="tag gross">Gross</span>' : '', c.replaced ? '<span class="tag">Remplacée</span>' : '', sh.counted.has(c.id) ? '<span class="tag ok">Retenue</span>' : '',
      c.status !== 'validee' ? `<span class="tag warn">${STATUS[c.status]}</span>` : ''].join('');
    const act = adm && !c.imported && c.status === 'validee' && !p.is_guest && !(c.mode === 'gross' && !c.replaced) && !c.replaced ? `<button class="link" data-act="setgross" data-card="${esc(c.id)}">Définir comme carte gross</button>` : '';
    return `<div class="row col"><div class="rowtop"><span><b>${esc(fmtDate(c.date).replace(/^\w+ /, ''))}</b><br><small>${c.imported ? (c.mode === 'gross' ? 'Points brut (historique)' : 'Historique importé') : `${esc(roundName(c))} · HJ ${c.hj}`}</small></span><span class="pts">${c.imported && c.mode === 'gross' ? `${c.gross}<small> brut</small>` : `${c.net}<small> net</small>${c.imported ? '' : `<br><small>${c.gross} brut</small>`}`}</span></div><div>${tags}</div>${act}</div>`;
  }).join('');
  return `<button class="link" data-act="ranking">‹ Classement</button>
    <div class="card"><h2>${esc(p.display_name)}</h2>${p.is_guest ? '<p class="note">Invité : pas de classement annuel.</p>' : `<p><b>${sh.row ? sh.row.total : 0} pts</b> · rang ${sh.row ? sh.row.rank : '-'}</p>
    <p class="small">Moyenne net : ${sh.average ?? '–'} · meilleure carte : ${sh.best ?? '–'}</p>
    <p class="goal">🎯 Score à battre : <b>${sh.lowestCounted ?? '–'}</b> <small>${sh.lowestCounted != null ? `(plus bas des ${sh.topN} cartes retenues)` : `(moins de ${sh.topN} cartes : tout score compte)`}</small></p>
    ${sh.pending ? `<p class="small">${sh.pending} carte(s) pas encore validée(s)</p>` : ''}`}</div>
    <div class="card"><h3>Cartes ${S.year}</h3>${list || '<p>Aucune carte.</p>'}</div>`;
}

// ------------------------------------------------------------------ partage en images
async function buildShare(from) {
  const logo = await loadLogo();
  await loadFonts();
  let sets;
  if (from === 'ranking') {
    sets = [{ label: 'Classements de la saison', specs: [prepAnnual(S.yearData), prepNearestAnnual(S.yearData)] }];
  } else {
    const v = S.view, dl = fmtDate(v.round.played_on), o = { dateLabel: dl };
    sets = [{ label: 'Avant la partie', specs: [prepDraw(v, o)] },
      { label: 'Après la partie', specs: [prepDay(v, o), prepNearestDay(v, o), prepNearestAnnual(S.yearData), prepAnnual(S.yearData)] }];
  }
  const date = (S.view?.round.played_on || localDate());
  for (const set of sets) {
    set.items = await Promise.all(set.specs.map(async spec => {
      const blob = await toBlob(drawImage(spec, logo));
      return { spec, url: URL.createObjectURL(blob), file: new File([blob], `${spec.file}-${date}.png`, { type: 'image/png' }) };
    }));
  }
  (S.share?.sets || []).forEach(st => st.items.forEach(i => URL.revokeObjectURL(i.url)));
  S.share = { from, sets, text: from === 'ranking' ? `Classements ${S.year}` : `Jambon Golf · ${fmtDate(S.view.round.played_on)}` };
}

function screenShare() {
  if (!isAdmin()) return '<div class="card"><p>Réservé à l\'administrateur.</p><button class="primary" data-act="home">Retour</button></div>';
  const sh = S.share;
  if (!sh) return '<p class="center">Préparation des images…</p>';
  const back = sh.from === 'ranking' ? 'ranking' : 'round-back';
  const sets = sh.sets.map((set, si) => `<div class="card"><h3>${esc(set.label)}</h3>
    ${set.items.map((it, ii) => `<div class="shareimg"><img src="${it.url}" alt="${esc(it.spec.title)}"><button class="link" data-act="share-one" data-s="${si}" data-i="${ii}">Partager cette image</button></div>`).join('')}
    <button class="primary" data-act="share-set" data-s="${si}">${set.items.length > 1 ? `Partager les ${set.items.length} images` : 'Partager l\'image'}</button></div>`).join('');
  return `<button class="link" data-act="${back}">‹ Retour</button><h2>Partager</h2>
    <p class="small">Le bouton ouvre la feuille de partage du téléphone : choisis WhatsApp et le groupe. Sur ordinateur, les images sont téléchargées.</p>${sets}`;
}

async function doShare(files) {
  const r = await shareFiles(files, S.share.text);
  if (r === 'telechargement') toast('Images téléchargées : joins-les dans WhatsApp.');
}

// ------------------------------------------------------------------ administration
function screenAdminLogin() {
  return `<div class="card"><h2>Connexion admin</h2>${S.error ? `<p class="err">${esc(S.error)}</p>` : ''}
    <input id="a-mail" type="email" placeholder="E-mail" autocomplete="username"><input id="a-pass" type="password" placeholder="Mot de passe" autocomplete="current-password">
    <button class="primary" data-act="admin-login">Se connecter</button>${api.demo ? '<p class="small">Démo : n\'importe quel e-mail.</p>' : ''}</div>`;
}

// ------------------------------------------------------------------ notifications (Web Push)
const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const b64ToBytes = b => { const p = '='.repeat((4 - (b.length % 4)) % 4), s = atob((b + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(s, c => c.charCodeAt(0)); };

async function refreshPush() {
  if (api.demo) { S.push = { state: 'demo' }; return; }
  if (!pushSupported()) { S.push = { state: isIos() && !isStandalone() ? 'ios-install' : 'unsupported' }; return; }
  if (Notification.permission === 'denied') { S.push = { state: 'denied' }; return; }
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    S.push = { state: sub && ls.getItem('golf.pushActor') === S.actor ? 'on' : 'off' };
  } catch { S.push = { state: 'off' }; }
}

async function enablePush() {
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { S.push = { state: perm === 'denied' ? 'denied' : 'off' }; return render(); }
    const reg = await navigator.serviceWorker.register('sw.js');
    await navigator.serviceWorker.ready;
    const key = await api.vapidKey();
    if (!key) throw new Error('Notifications non disponibles pour le moment');
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
    const j = sub.toJSON();
    await api.savePush({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth }, S.code, S.actor);
    ls.setItem('golf.pushActor', S.actor);
    S.push = { state: 'on' }; toast('Notifications activées sur ce téléphone.');
  } catch (e) { toast('Activation impossible : ' + (e.message || e)); await refreshPush(); render(); }
}

async function disablePush() {
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    if (sub) { await api.deletePush(sub.endpoint, S.code, S.actor).catch(() => {}); await sub.unsubscribe(); }
    ls.removeItem('golf.pushActor'); S.push = { state: 'off' }; toast('Notifications désactivées sur ce téléphone.');
  } catch (e) { toast(e.message || String(e)); }
}

function pushCard() {
  const st = S.push.state;
  if (st === 'on' || st === 'demo' || st === 'unknown' || st === 'unsupported') return st === 'on' ? '<p class="note">🔔 Notifications activées. <button class="link" data-act="push-off">Désactiver</button></p>' : '';
  if (st === 'ios-install') return `<div class="card"><h3>🔔 Notifications</h3><p class="small">Sur iPhone, ajoute d'abord l'appli à l'écran d'accueil : bouton Partager, puis « Sur l'écran d'accueil ». Ouvre-la ensuite depuis l'icône pour activer les notifications.</p></div>`;
  if (st === 'denied') return `<div class="card"><h3>🔔 Notifications</h3><p class="small">Les notifications sont bloquées pour cette appli. Autorise-les dans les réglages du téléphone (Notifications), puis reviens ici.</p></div>`;
  return `<div class="card"><h3>🔔 Notifications</h3><p class="small">Sois prévenu à l'ouverture du sondage, au rappel du lundi et quand le tirage est publié.</p><button class="primary" data-act="push-on">Activer les notifications</button></div>`;
}

async function sendNotify(type, extra = {}) {
  try {
    const r = await api.notify(type, extra);
    toast(r.note || `${r.sent ?? 0} notification(s) envoyée(s)${r.failed ? ', ' + r.failed + ' en échec' : ''}.`);
  } catch (e) { toast(e.network ? 'Pas de réseau.' : e.message); }
}

// ------------------------------------------------------------------ envoi du tirage au golf
async function loadContacts() {
  S.contacts = Object.fromEntries((await api.settings()).filter(x => x.key.startsWith('contact_')).map(x => [x.key.slice(8), x.value]));
}

function golfSendBlock(v) {
  const c = S.contacts[v.round.course_id] || {};
  const { subject, body } = golfMail({ dateLabel: fmtDate(v.round.played_on), courseName: v.course.name,
    groups: v.groups.map(g => ({ time: g.teeTime ? String(g.teeTime).slice(0, 5) : '', players: g.members.map(m => m.name + (m.isGuest ? ' (invité)' : '')) })) });
  const mail = mailtoLink({ to: c.email, subject, body });
  const wa = whatsappToLink(c.whatsapp, body);
  return `<h3>Envoyer le tirage au golf</h3>
    <p class="small">${c.email ? 'E-mail : ' + esc(c.email) : 'Pas d\'e-mail enregistré pour ce golf : ton application mail s\'ouvrira sans destinataire.'}</p>
    <a class="btn mail" href="${esc(mail)}">Envoyer par e-mail</a>
    ${c.whatsapp ? `<a class="btn secondary" href="${esc(wa)}" target="_blank" rel="noopener">Envoyer par WhatsApp (${esc(c.whatsapp)})</a>` : ''}
    <button class="link" data-act="contacts">Modifier les contacts des golfs</button>
    <h3>Notifications</h3><button class="secondary" data-act="notify-draw">Notifier les joueurs du tirage</button>`;
}

function screenContacts() {
  if (!isAdmin()) return screenAdminLogin();
  const rows = S.courses.map(c => { const k = S.contacts[c.id] || {}; return `<div class="card"><b>${esc(c.name)}</b>
    <label class="fld">E-mail<input type="email" value="${esc(k.email || '')}" data-act="contact-set" data-c="${esc(c.id)}" data-f="email" placeholder="reservation@golf.mu"></label>
    <label class="fld">WhatsApp (avec indicatif)<input type="tel" value="${esc(k.whatsapp || '')}" data-act="contact-set" data-c="${esc(c.id)}" data-f="whatsapp" placeholder="230 5xxx xxxx"></label></div>`; }).join('');
  return `<button class="link" data-act="admin">‹ Admin</button><h2>Contacts des golfs</h2>
    <p class="small">Utilisés par le bouton « Envoyer le tirage au golf » de l'écran de la journée. L'envoi se fait depuis ton application mail ou WhatsApp : tu vérifies et tu appuies sur envoyer.</p>${rows}`;
}

// ------------------------------------------------------------------ sondage hebdomadaire
const fmtClose = iso => new Date(iso).toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Indian/Mauritius' }).replace(':', 'h');
const pollOpen = p => Date.now() >= Date.parse(p.opens_at) && Date.now() <= Date.parse(p.closes_at);
const nextThursday = () => { const d = new Date(); d.setDate(d.getDate() + ((4 - d.getDay() + 7) % 7 || 7)); return localDate(d); };
const closeInput = iso => new Date(Date.parse(iso) + 4 * 3600000).toISOString().slice(0, 16);   // heure de Maurice (UTC+4)

function pollLists() {
  const ans = new Map(S.pollAnswers.map(a => [a.player_id, a.answer]));
  const regs = S.players.filter(p => !p.is_guest);
  const pick = f => regs.filter(p => f(ans.get(p.id))).map(p => esc(p.display_name));
  return { ans, oui: pick(a => a === 'oui'), non: pick(a => a === 'non'), sans: pick(a => !a) };
}

function pollCard() {
  const p = S.poll;
  if (!p) return '';
  const L = pollLists(), open = pollOpen(p), mine = L.ans.get(S.actor);
  const btn = (a, t) => `<button class="${mine === a ? 'primary' : 'secondary'}" data-act="poll-answer" data-a="${a}" ${open ? '' : 'disabled'}>${t}</button>`;
  return `<div class="card poll"><h2>${esc(fmtDate(p.play_date).replace(/^./, c => c.toUpperCase()))}</h2>
    <p>${p.courses?.name ? esc(p.courses.name) : '<small>Golf à confirmer</small>'}</p>
    <p class="small">${open ? 'Réponds avant ' + esc(fmtClose(p.closes_at)) + ' (heure de Maurice).' : 'Sondage clos depuis ' + esc(fmtClose(p.closes_at)) + '.'}</p>
    <div class="pollbtns">${btn('oui', 'Je joue')}${btn('non', 'Je ne joue pas')}</div>
    ${mine ? `<p class="small">Ta réponse : <b>${mine === 'oui' ? 'tu joues' : 'tu ne joues pas'}</b>${open ? ' · <button class="link" data-act="poll-answer" data-a="">effacer</button>' : ''}</p>` : (open ? '<p class="small">Tu n\'as pas encore répondu.</p>' : '')}
    <p><b>${L.oui.length}</b> jouent · <b>${L.non.length}</b> ne jouent pas · <b>${L.sans.length}</b> sans réponse</p>
    <details><summary>Qui joue (${L.oui.length})</summary><p>${L.oui.join(', ') || '—'}</p></details>
    <details><summary>Ne jouent pas (${L.non.length})</summary><p>${L.non.join(', ') || '—'}</p></details>
    <details><summary>Sans réponse (${L.sans.length})</summary><p>${L.sans.join(', ') || '—'}</p></details></div>`;
}

function screenPollAdmin() {
  if (!isAdmin()) return screenAdminLogin();
  const p = S.poll;
  if (!p) return `<button class="link" data-act="admin">‹ Admin</button><div class="card"><h2>Sondage de la semaine</h2><p>Aucun sondage ouvert. Il s'ouvre tout seul le samedi à 8h00 (heure de Maurice) pour le jeudi suivant.</p>
    <label class="fld">Jeudi de jeu<input type="date" id="poll-date" value="${nextThursday()}"></label>
    <button class="primary" data-act="poll-create">Ouvrir le sondage maintenant</button></div>`;
  const L = pollLists();
  const courses = `<option value="">— à confirmer —</option>` + S.courses.map(c => `<option value="${esc(c.id)}" ${c.id === p.course_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  const rows = S.players.filter(x => !x.is_guest).map(x => { const a = L.ans.get(x.id) || ''; return `<label class="ne"><span>${esc(x.display_name)}</span>
    <select data-act="poll-set" data-p="${esc(x.id)}"><option value="" ${a === '' ? 'selected' : ''}>—</option><option value="oui" ${a === 'oui' ? 'selected' : ''}>Joue</option><option value="non" ${a === 'non' ? 'selected' : ''}>Ne joue pas</option></select></label>`; }).join('');
  return `<button class="link" data-act="admin">‹ Admin</button><div class="card"><h2>Sondage · ${esc(fmtDate(p.play_date))}</h2>
    <label class="ne"><span>Golf</span><select data-act="poll-course">${courses}</select></label>
    <label class="ne"><span>Clôture (heure de Maurice)</span><input type="datetime-local" data-act="poll-close" value="${closeInput(p.closes_at)}"></label>
    <p class="small">${L.oui.length} jouent · ${L.non.length} ne jouent pas · ${L.sans.length} sans réponse. Le tirage coche automatiquement ceux qui jouent.</p>
    <button class="secondary" data-act="notify-poll" data-t="poll_open">Annoncer l'ouverture maintenant (notification)</button>
    <button class="secondary" data-act="notify-poll" data-t="poll_reminder">Relancer ceux qui n'ont pas répondu (notification)</button></div>
    <div class="card"><h3>Réponses (correction par l'admin)</h3>${rows}</div>`;
}

function screenAdmin() {
  if (!isAdmin()) return screenAdminLogin();
  return `<div class="card"><h2>Admin</h2>
    <button class="primary" data-act="draw-new">Nouvelle journée · tirage</button>
    <button class="secondary" data-act="poll-admin">Sondage de la semaine</button>
    <button class="secondary" data-act="contacts">Contacts des golfs (envoi du tirage)</button>
    <button class="secondary" data-act="notify-test">Tester les notifications (sur mon téléphone)</button>
    <button class="secondary" data-act="guests">Invités</button>
    <button class="secondary" data-act="settings">Réglages du classement</button>
    <button class="secondary" data-act="code">Lien d'accès WhatsApp</button>
    <button class="secondary" data-act="admin-logout">Se déconnecter</button></div>
    <p class="note">Pour corriger une journée : Journées, ouvrir la journée, « Gérer la journée (admin) ». Pour la carte gross : Classement, ouvrir le joueur.</p>`;
}

const teesOf = cid => S.tees.filter(t => t.course_id === cid);
const defTee = cid => teesOf(cid).find(t => t.is_default || t.default) || teesOf(cid)[0];
const hjFor = (tee, idx) => (tee && Number.isFinite(idx) ? playingHandicap({ index: idx, slope: tee.slope, cr: Number(tee.cr), par: tee.par_total }) : 0);

async function startDraw() {
  go('draw');
  try { [S.courses, S.tees] = await Promise.all([api.courses(), api.tees()]); } catch (e) { return toast(e.message); }
  await loadYear(seasonNow());
  const last = {};   // dernier index connu de chaque joueur (cette saison)
  try { const d = await api.year(S.year); const rd = new Map(d.rounds.map(r => [r.id, r.played_on])); d.participations.slice().sort((a, b) => (rd.get(a.round_id) < rd.get(b.round_id) ? -1 : 1)).forEach(p => { last[p.player_id] = p.handicap_index; }); } catch { /* sans historique */ }
  S.players.forEach(p => { const h = p.handicap_index; if (h !== null && h !== undefined && Number.isFinite(Number(h))) last[p.id] = Number(h); });   // l'index actuel du joueur prime
  const course = S.courses.find(c => c.id === 'mont_choisy') || S.courses[0];
  let cfg = {};
  try { cfg = Object.fromEntries((await api.settings()).filter(x => x.key.startsWith('draw_')).map(x => [x.key.slice(5), x.value])); } catch { /* valeurs par défaut */ }
  S.drawCfg = cfg;
  const c0 = cfg[course.id] || {};
  await loadPoll();
  const pl = S.poll;
  const yes = new Set(S.pollAnswers.filter(a => a.answer === 'oui').map(a => a.player_id));
  S.draw = { date: pl ? pl.play_date : localDate(), courseId: pl && pl.course_id ? pl.course_id : course.id, pollYes: yes.size, start: c0.start || '08:00', interval: c0.interval || 8, format: 'auto', present: new Set(yes), last, groups: null, times: [], sel: null, forced: [], together: [[]] };
  render();
}

function sizesNow() { try { return groupSizes(S.draw.present.size, S.draw.format); } catch { return []; } }

function forceCards() {
  const D = S.draw, sizes = sizesNow();
  if (!sizes.length) return '<div class="card"><h3>Imposer des groupes ou des paires</h3><p class="small">Coche au moins 3 présents (6 ou plus s\'il y a 5 ou 6 joueurs hors format) pour afficher les groupes.</p></div>';
  const pres = S.players.filter(p => D.present.has(p.id));
  const opts = sel => `<option value="">—</option>` + pres.map(p => `<option value="${esc(p.id)}" ${p.id === sel ? 'selected' : ''}>${esc(p.display_name)}</option>`).join('');
  const groups = sizes.map((size, gi) => `<div class="forcerow"><span>Groupe ${gi + 1}<br><small>${size} joueurs</small></span>${Array.from({ length: size }, (_, si) =>
    `<select data-act="force-slot" data-g="${gi}" data-s="${si}">${opts((D.forced[gi] || [])[si] || '')}</select>`).join('')}</div>`).join('');
  const pairs = D.together.map((row, ri) => `<div class="forcerow"><span>Ensemble<br><small>même groupe</small></span>${[0, 1, 2].map(si => `<select data-act="together-slot" data-r="${ri}" data-s="${si}">${opts(row[si] || '')}</select>`).join('')}</div>`).join('');
  return `<div class="card"><h3>Imposer des groupes</h3><p class="small">Les petits groupes partent en premier, les groupes de 4 en dernier. Les cases vides sont tirées au sort.</p>${groups}
    <h3>Joueurs à mettre ensemble</h3><p class="small">Ils seront dans le même groupe, le tirage choisit lequel.</p>${pairs}<button class="link" data-act="add-together">+ Ajouter une paire</button></div>`;
}

function drawPresentIds() { return [...S.draw.present]; }

function generateDraw() {
  const D = S.draw, ids = drawPresentIds();
  try {
    const groups = makeGroups(ids, { format: D.format, forced: D.forced, together: D.together.map(r => r.filter(Boolean)) });
    D.times = teeTimes(D.start, groups.length, D.interval);
    D.groups = groups.map(g => ({ markerId: g[0], players: g.map(id => ({ id, teeId: defTee(D.courseId)?.id, index: D.last[id] ?? NaN })) }));
    D.sel = null;
  } catch (e) { toast(e.message); }
  render();
}

function drawTexts() {
  const D = S.draw, times = D.times;
  const name = id => S.players.find(p => p.id === id)?.display_name || '?';
  const text = whatsappText({ dateLabel: fmtDate(D.date), courseName: S.courses.find(c => c.id === D.courseId)?.name, groups: D.groups.map(g => g.players.map(p => name(p.id))), times });
  return { times, text };
}

function screenDraw() {
  if (!isAdmin()) return screenAdminLogin();
  const D = S.draw;
  if (!D) return '<p class="center">Chargement…</p>';
  const regs = S.players.filter(p => !p.is_guest), gst = S.players.filter(p => p.is_guest);
  const gInfo = id => S.yearData?.guests.find(g => g.player.id === id);
  const tile = p => { const gi = p.is_guest ? gInfo(p.id) : null; return `<label class="tile"><input type="checkbox" data-act="present" data-id="${esc(p.id)}" ${D.present.has(p.id) ? 'checked' : ''}><span>${esc(p.display_name)}${gi ? `<br><small class="${gi.atLimit ? 'err' : ''}">${gi.count}/${gi.limit} parties</small>` : ''}</span></label>`; };
  const form = `<div class="card"><h2>Nouvelle journée</h2>
    <label class="fld">Date<input type="date" data-act="draw-field" data-f="date" value="${esc(D.date)}"></label>
    <label class="fld">Parcours<select data-act="draw-field" data-f="courseId">${S.courses.map(c => `<option value="${esc(c.id)}" ${c.id === D.courseId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
    <label class="fld">1er départ<input type="time" data-act="draw-field" data-f="start" value="${esc(D.start)}"></label>
    <label class="fld">Intervalle entre départs (minutes)<input type="number" min="1" max="60" inputmode="numeric" data-act="draw-field" data-f="interval" value="${esc(D.interval)}"></label>
    <button class="link" data-act="draw-memo">Mémoriser ces horaires pour ce golf</button>
    <label class="fld">Groupes<select data-act="draw-field" data-f="format"><option value="auto" ${D.format === 'auto' ? 'selected' : ''}>Automatique (3 ou 4)</option><option value="four" ${D.format === 'four' ? 'selected' : ''}>Que des 4</option><option value="three" ${D.format === 'three' ? 'selected' : ''}>Que des 3</option></select></label></div>
    <div class="card"><h3>Présents (${D.present.size})</h3><div class="tiles">${regs.map(tile).join('')}</div>
    <h3>Invités</h3><div class="tiles">${gst.map(tile).join('') || '<small>Aucun invité enregistré.</small>'}</div>
    <div class="addrow"><input id="g-name" placeholder="Nouvel invité (nom)"><button data-act="add-guest">Ajouter</button></div>
    </div>${forceCards()}
    <button class="primary" data-act="draw-go" ${D.present.size >= 3 ? '' : 'disabled'}>${D.groups ? 'Relancer le tirage' : 'Tirer les groupes'}</button>`;
  if (!D.groups) return form;
  const { times, text } = drawTexts();
  const name = id => esc(S.players.find(p => p.id === id)?.display_name || '?');
  const groups = D.groups.map((g, gi) => `<div class="card"><div class="gh"><h3>Groupe ${gi + 1} · ${g.players.length} joueurs</h3><input type="time" data-act="draw-time" data-g="${gi}" value="${esc(times[gi])}"></div>
    ${g.players.map((p, pi) => { const tee = teesOf(D.courseId).find(t => t.id === p.teeId); const sel = D.sel && D.sel.g === gi && D.sel.i === pi;
      return `<div class="dp ${sel ? 'sel' : ''}"><button class="swap" data-act="swap" data-g="${gi}" data-i="${pi}">${name(p.id)}${S.players.find(x => x.id === p.id)?.is_guest ? ' <small>(invité)</small>' : ''}</button>
        <select data-act="draw-tee" data-g="${gi}" data-i="${pi}">${teesOf(D.courseId).map(t => `<option value="${esc(t.id)}" ${t.id === p.teeId ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>
        <input type="number" step="0.1" inputmode="decimal" placeholder="index" value="${Number.isFinite(p.index) ? p.index : ''}" data-act="draw-index" data-g="${gi}" data-i="${pi}">
        <span class="hjv">HJ ${Number.isFinite(p.index) ? hjFor(tee, p.index) : '–'}</span></div>`; }).join('')}
    <label class="fld">Marqueur<select data-act="draw-marker" data-g="${gi}">${g.players.map(p => `<option value="${esc(p.id)}" ${p.id === g.markerId ? 'selected' : ''}>${name(p.id)}</option>`).join('')}</select></label></div>`).join('');
  const missing = D.groups.flatMap(g => g.players).filter(p => !Number.isFinite(p.index)).length;
  return form + `<h2>Tirage</h2><p class="small">Touche un joueur puis un autre pour les échanger de groupe. Index : le dernier connu est proposé, à vérifier.</p>${groups}
    <div class="card"><h3>Texte WhatsApp</h3><pre class="wa">${esc(text)}</pre><a class="btn" href="${esc(whatsappLink(text))}" target="_blank" rel="noopener">Partager sur WhatsApp</a>
    ${missing ? `<p class="note">${missing} index manquant(s) : ils seront à saisir avant le départ (la journée affichera « index à saisir »).</p>` : ''}
    <button class="primary" data-act="draw-save">Valider et créer la journée</button></div>`;
}

async function saveDraw() {
  const D = S.draw, times = D.times;
  await adminDo(async () => {
    const round = await api.createRound({ played_on: D.date, course_id: D.courseId });
    await api.saveDraw({ round_id: round.id, groups: D.groups.map((g, i) => ({ number: i + 1, tee_time: times[i], marker_player_id: g.markerId,
      members: g.players.map(p => { const tee = teesOf(D.courseId).find(t => t.id === p.teeId); const idx = Number.isFinite(p.index) ? p.index : 0; return { player_id: p.id, tee_id: p.teeId, index: idx, playing: hjFor(tee, idx) }; }) })) });
    await api.setRoundStatus(round.id, 'en_cours');
    S.draw = null; S.rounds = await api.rounds(); await openRound(round.id);
    toast('Journée créée. Envoie le tirage dans WhatsApp.');
  });
}

function screenAdminRound() {
  if (!isAdmin()) return screenAdminLogin();
  const v = S.view; if (!v) return '<p class="center">Chargement…</p>';
  const cid = v.round.course_id;
  const blocks = v.members.map(m => {
    const tees = teesOf(cid);
    const st = m.status;
    return `<div class="card"><div class="pl-top"><b>${esc(m.name)}</b><small>${STATUS[st]}${m.mode === 'gross' ? ' · carte gross' : ''}</small></div>
      <label class="fld">Tee<select data-act="adm-tee" data-part="${esc(m.participationId)}" data-index="${m.index}" data-par="${v.holes.reduce((a, h) => a + h.par, 0)}">${tees.map(t => `<option value="${esc(t.id)}" ${m.tee?.id === t.id ? 'selected' : ''}>${esc(t.name)} (${t.cr}/${t.slope})</option>`).join('')}</select></label>
      <p class="small">HJ ${m.hj} · ${m.totals.net} pts net · ${m.totals.played}/18</p>
      ${st === 'validee' ? `<button class="secondary" data-act="adm-status" data-card="${esc(m.cardId)}" data-st="en_cours">Rouvrir la carte (correction)</button>` : ''}
      ${st === 'a_verifier' ? `<button class="secondary" data-act="adm-status" data-card="${esc(m.cardId)}" data-st="validee">Valider (admin)</button>` : ''}
      ${st === 'en_cours' && m.totals.complete ? `<button class="secondary" data-act="adm-status" data-card="${esc(m.cardId)}" data-st="validee">Valider directement (admin)</button>` : ''}
      ${m.mode === 'gross' ? `<button class="link" data-act="reset-gross" data-card="${esc(m.cardId)}">Remettre au net (erreur de manipulation)</button>` : ''}
      <button class="link" data-act="remove-part" data-id="${esc(m.participationId)}" ${m.totals.played ? 'disabled' : ''}>Retirer du tirage${m.totals.played ? ' (des scores existent)' : ''}</button></div>`;
  }).join('');
  return `<button class="link" data-act="round-back">‹ Journée</button><h2>Gérer la journée</h2><p class="small">${esc(fmtDate(v.round.played_on))} · ${esc(v.course.name)}</p>${blocks}
    <div class="card">${v.round.status === 'terminee' ? '<button class="secondary" data-act="round-status" data-st="en_cours">Rouvrir la journée</button>' : '<button class="primary" data-act="round-status" data-st="terminee">Terminer la journée</button>'}</div>`;
}

function screenGuests() {
  if (!isAdmin()) return screenAdminLogin();
  const Y = S.yearData;
  const list = S.players.filter(p => p.is_guest).map(p => { const g = Y?.guests.find(x => x.player.id === p.id); return `<div class="rk"><span></span><span>${esc(p.display_name)} <small>${esc(p.code)}</small></span><span>${g ? g.count : 0}/${Y?.guestLimit ?? 4} parties</span></div>`; }).join('');
  return `<button class="link" data-act="admin">‹ Admin</button><div class="card"><h2>Invités</h2>${list || '<p>Aucun invité.</p>'}
    <div class="addrow"><input id="g-name" placeholder="Nom de l'invité"><button data-act="add-guest">Ajouter</button></div>
    <p class="small">Les invités peuvent gagner la journée, mais pas le classement annuel ni les nearest. Plafond par an : voir Réglages.</p></div>`;
}

function screenSettings() {
  if (!isAdmin()) return screenAdminLogin();
  const Y = S.yearData;
  return `<button class="link" data-act="admin">‹ Admin</button><div class="card"><h2>Réglages du classement</h2>
    <label class="fld">Cartes net retenues<input type="number" min="1" max="30" value="${Y?.topN ?? 9}" data-act="setting" data-key="top_n"></label>
    <label class="fld">Parties max par invité et par an<input type="number" min="1" max="30" value="${Y?.guestLimit ?? 4}" data-act="setting" data-key="guest_limit"></label>
    <p class="small">Le changement s'applique tout de suite au classement.</p></div>`;
}

function screenCode() {
  if (!isAdmin()) return screenAdminLogin();
  const link = `${location.origin}${location.pathname.replace(/[^/]*$/, '')}index.html`;
  const msg = `Voici le lien de l'appli de scores des Jambons. Ouvre-le, choisis ton nom, et c'est tout :\n${link}`;
  return `<button class="link" data-act="admin">‹ Admin</button><div class="card"><h2>Lien d'accès WhatsApp</h2>
    <p>Le code du groupe est intégré à l'appli : le lien simple suffit, sans rien coller.</p>
    <pre class="wa">${esc(link)}</pre><a class="btn" href="${esc(whatsappLink(msg))}" target="_blank" rel="noopener">Envoyer dans WhatsApp</a></div>`;
}

// ------------------------------------------------------------------ actions
const find = id => S.view.members.find(m => m.cardId === id);
const setScore = (m, sc) => addOp({ type: 'score', card: m.cardId, hole: S.hole, strokes: sc.strokes, pickup: sc.pickup });
const reloadRound = async () => { await refresh(); };

const actions = {
  'push-on': () => enablePush(),
  'push-off': () => disablePush(),
  'notify-test': () => sendNotify('test'),
  'notify-draw': () => sendNotify('draw', { round_id: S.roundId }),
  'notify-poll': el => sendNotify(el.dataset.t),
  contacts: async () => { try { S.courses = await api.courses(); await loadContacts(); } catch (e) { return toast(e.message); } go('contacts'); },
  'poll-answer': async el => {
    const a = el.dataset.a || null;
    try { await api.send({ type: 'poll', poll: S.poll.id, answer: a }, S.code, S.actor); S.pollAnswers = await api.pollAnswers(S.poll.id); render(); }
    catch (e) { toast(e.network ? 'Pas de réseau : réessaie dans un instant.' : e.message); }
  },
  'poll-admin': async () => { await loadPoll(); try { if (!S.courses.length) S.courses = await api.courses(); } catch { /* liste des golfs facultative */ } go('pollAdmin'); },
  'poll-create': () => adminDo(async () => {
    const play = document.getElementById('poll-date')?.value || nextThursday();
    const d = new Date(play + 'T12:00:00Z');
    if (d.getUTCDay() !== 4) throw new Error('Choisis un jeudi.');
    const c = new Date(d); c.setUTCDate(c.getUTCDate() - 3);
    await api.createPoll({ play_date: play, closes_at: `${c.toISOString().slice(0, 10)}T17:30:00+04:00` });
  }, async () => { await loadPoll(); render(); }),
  'code-enter': async () => {
    const raw = (document.getElementById('code-in')?.value || '').trim();
    const m = /[#&]c=([^&\s]+)/.exec(raw);
    const code = decodeURIComponent(m ? m[1] : raw);
    if (!code) return toast('Colle ton code d\'accès.');
    try {
      if (!(await api.checkCode(code))) return go('nocode', 'Code incorrect : vérifie-le ou redemande le lien dans le groupe WhatsApp.');
    } catch { return toast('Pas de réseau : réessaie dans un instant.'); }
    S.code = code; ls.setItem('golf.code', code); await boot();
  },
  pick: async el => { S.actor = el.dataset.id; ls.setItem('golf.actor', S.actor); await openHome(); },
  who: () => go('who'),
  home: () => openHome(),
  round: el => openRound(el.dataset.id),
  group: el => { S.groupIdx = +el.dataset.i; render(); },
  'open-hole': () => { S.hole = firstOpenHole(curGroup()); go('hole'); },
  'round-back': () => go('round'),
  recap: () => go('recap'),
  goto: el => { S.hole = +el.dataset.h; render(); },
  prev: () => { S.hole = Math.max(1, S.hole - 1); render(); window.scrollTo(0, 0); },
  next: () => { S.hole = Math.min(18, S.hole + 1); render(); window.scrollTo(0, 0); },
  step: el => {
    const m = find(el.dataset.card), hole = S.view.holes[S.hole - 1];
    const next = stepScore(m.scores[S.hole - 1], hole.par, strokesReceived(m.hj, hole.si), +el.dataset.dir);
    if (next) setScore(m, next);
  },
  confirm: el => {
    const m = find(el.dataset.card), sc = m.scores[S.hole - 1];
    if (!sc.pickup && sc.strokes == null) setScore(m, { strokes: S.view.holes[S.hole - 1].par, pickup: false });
  },
  clear: el => setScore(find(el.dataset.card), { strokes: null, pickup: false }),
  status: el => addOp({ type: 'status', card: el.dataset.card, status: el.dataset.st }),
  retry: () => location.reload(),
  demoreset: () => { api.reset(); ls.removeItem('golf.queue.demo'); location.reload(); },
  // partage en images
  'share-open': async () => { S.share = null; go('share'); if (!S.yearData || S.yearData.year !== +S.view.round.played_on.slice(0, 4)) await loadYear(+S.view.round.played_on.slice(0, 4)); try { await buildShare('round'); } catch (e) { toast('Impossible de créer les images : ' + e.message); } render(); },
  'share-annual': async () => { S.share = null; go('share'); try { await buildShare('ranking'); } catch (e) { toast('Impossible de créer les images : ' + e.message); } render(); },
  'share-set': el => doShare(S.share.sets[+el.dataset.s].items.map(i => i.file)),
  'share-one': el => doShare([S.share.sets[+el.dataset.s].items[+el.dataset.i].file]),
  // classement
  ranking: () => openRanking(),
  year: el => { const y = S.year + +el.dataset.d; if (y >= FIRST_YEAR) openRanking(y); },
  sheet: async el => { S.sheetId = el.dataset.id; if (!S.rounds.length) S.rounds = await api.rounds().catch(() => []); go('sheet'); },
  // admin
  admin: () => { go('admin'); },
  'admin-direct': () => go('adminLogin'),
  'admin-login': async () => {
    const mail = document.getElementById('a-mail').value.trim(), pass = document.getElementById('a-pass').value;
    try { await api.adminLogin(mail, pass); S.error = ''; if (!S.players.length) return location.reload(); go('admin'); } catch (e) { go('adminLogin', e.message); }
  },
  'admin-logout': () => { api.adminLogout(); go('admin'); },
  'draw-new': () => startDraw(),
  guests: async () => { await loadYear(seasonNow()); go('guests'); },
  settings: async () => { await loadYear(seasonNow()); go('settings'); },
  code: () => { S.newCode = ''; go('code'); },
  'add-guest': () => {
    const name = document.getElementById('g-name').value.trim(); if (!name) return;
    adminDo(async () => {
      const code = nextGuestCode(S.players.map(p => p.code));
      const g = await api.addGuest(name, code); S.players = await api.players(); if (S.draw) S.draw.present.add(g.id);
      render();
    });
  },
  'draw-go': () => generateDraw(),
  'add-together': () => { S.draw.together.push([]); render(); },
  'draw-memo': () => { const D = S.draw; adminDo(() => api.setSetting('draw_' + D.courseId, { start: D.start, interval: +D.interval }), async () => { S.drawCfg[D.courseId] = { start: D.start, interval: +D.interval }; toast('Horaires mémorisés pour ce golf.'); }); },
  swap: el => {
    const D = S.draw, g = +el.dataset.g, i = +el.dataset.i;
    if (!D.sel) D.sel = { g, i };
    else if (D.sel.g === g && D.sel.i === i) D.sel = null;
    else { const a = D.groups[D.sel.g].players, b = D.groups[g].players; [a[D.sel.i], b[i]] = [b[i], a[D.sel.i]]; D.groups.forEach(x => { if (!x.players.some(p => p.id === x.markerId)) x.markerId = x.players[0].id; }); D.sel = null; }
    render();
  },
  'draw-save': () => saveDraw(),
  'admin-round': async () => { await Promise.all([api.tees().then(t => { S.tees = t; }).catch(() => {})]); go('adminRound'); },
  'adm-status': el => adminDo(() => api.adminCardStatus(el.dataset.card, el.dataset.st), reloadRound),
  'reset-gross': el => { const why = window.prompt('Motif de la remise au net (obligatoire) :'); if (why) adminDo(() => api.resetGross(el.dataset.card, why), reloadRound); },
  'remove-part': el => { if (window.confirm('Retirer ce joueur du tirage ?')) adminDo(() => api.removeParticipation(el.dataset.id), reloadRound); },
  'round-status': el => adminDo(() => api.setRoundStatus(S.roundId, el.dataset.st), async () => { await reloadRound(); }),
  setgross: el => { if (window.confirm('Cette carte devient la carte gross : elle sort définitivement du Stableford net, et l\'ancienne carte gross ne revient jamais au net. Confirmer ?')) adminDo(() => api.setGross(el.dataset.card), async () => { await loadYear(); render(); }); },
};

// champs (select / input / case) : déclenchés au changement
const changes = {
  'contact-set': el => adminDo(async () => {
    const id = el.dataset.c, cur = S.contacts[id] || {};
    const val = { ...cur, [el.dataset.f]: el.value.trim() };
    await api.setSetting('contact_' + id, val); S.contacts[id] = val;
  }, async () => { toast('Enregistré'); }),
  'poll-course': el => adminDo(() => api.patchPoll(S.poll.id, { course_id: el.value || null }), async () => { await loadPoll(); render(); }),
  'poll-close': el => adminDo(() => api.patchPoll(S.poll.id, { closes_at: el.value + ':00+04:00' }), async () => { await loadPoll(); render(); }),
  'poll-set': el => adminDo(() => api.setPollAnswer(S.poll.id, el.dataset.p, el.value || null), async () => { S.pollAnswers = await api.pollAnswers(S.poll.id); render(); }),
  nearest: el => addOp({ type: 'nearest', round: S.roundId, hole: +el.dataset.hole, player: el.value || null }),
  index: el => {
    const idx = parseFloat(String(el.value).replace(',', '.')); if (!Number.isFinite(idx)) return;
    const m = S.view.members.find(x => x.participationId === el.dataset.part);
    const hj = playingHandicap({ index: idx, slope: m.tee.slope, cr: Number(m.tee.cr), par: +el.dataset.par });
    addOp({ type: 'handicap', participation: m.participationId, index: idx, playing: hj });
  },
  present: el => {
    const D = S.draw; if (el.checked) D.present.add(el.dataset.id); else D.present.delete(el.dataset.id);
    D.groups = null;
    const keep = id => (D.present.has(id) ? id : '');
    D.forced = D.forced.map(g => g.map(keep)); D.together = D.together.map(r => r.map(keep));
    render();
  },
  'draw-field': el => {
    const D = S.draw, f = el.dataset.f; D[f] = el.value;
    if (f === 'courseId') { const c = S.drawCfg[D.courseId] || {}; D.start = c.start || '08:00'; D.interval = c.interval || 8; D.groups = null; D.forced = []; }
    if (f === 'format') { D.groups = null; D.forced = []; }
    if (D.groups && ['start', 'interval'].includes(f)) { try { D.times = teeTimes(D.start, D.groups.length, D.interval); } catch (e) { toast(e.message); } }
    render();
  },
  'draw-time': el => { S.draw.times[+el.dataset.g] = el.value; render(); },
  'force-slot': el => { const D = S.draw, g = +el.dataset.g; D.forced[g] = D.forced[g] || []; D.forced[g][+el.dataset.s] = el.value; },
  'together-slot': el => { S.draw.together[+el.dataset.r][+el.dataset.s] = el.value; },
  'draw-tee': el => { S.draw.groups[+el.dataset.g].players[+el.dataset.i].teeId = el.value; render(); },
  'draw-index': el => { const v = parseFloat(String(el.value).replace(',', '.')); S.draw.groups[+el.dataset.g].players[+el.dataset.i].index = Number.isFinite(v) ? v : NaN; render(); },
  'draw-marker': el => { S.draw.groups[+el.dataset.g].markerId = el.value; },
  'adm-tee': el => { const m = S.view.members.find(x => x.participationId === el.dataset.part), tee = S.tees.find(t => t.id === el.value); adminDo(() => api.patchParticipation(m.participationId, { tee_id: tee.id, playing_handicap: hjFor(tee, +el.dataset.index) }), reloadRound); },
  setting: el => { const v = Math.max(1, Math.round(+el.value)); adminDo(() => api.setSetting(el.dataset.key, v), async () => { await loadYear(seasonNow()); render(); }); },
};

$app.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.matches('select,input') || el.disabled) return;
  if (actions[el.dataset.act]) actions[el.dataset.act](el);
});
$app.addEventListener('change', e => {
  const el = e.target.closest('[data-act]');
  if (el && el.matches('select,input') && changes[el.dataset.act]) changes[el.dataset.act](el);
});

window.__golf = { S, render, get api() { return api; }, get queue() { return queue; } };   // utile pour les tests
boot().catch(e => { S.screen = 'nocode'; S.error = 'Erreur de démarrage : ' + e.message; render(); });
