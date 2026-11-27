// File d'attente des modifications faites hors ligne. Sans dépendance, testable avec Node.
// Une modification sur le même élément (même trou, même statut...) remplace la précédente : dernière saisie gagnante.

export function opKey(op) {
  switch (op.type) {
    case 'score': return `s:${op.card}:${op.hole}`;
    case 'status': return `t:${op.card}`;
    case 'handicap': return `h:${op.participation}`;
    case 'nearest': return `n:${op.round}:${op.hole}`;
    default: throw new Error('Opération inconnue : ' + op.type);
  }
}

export function createQueue(storage, key = 'golf.queue') {
  let ops = [];
  let rejected = [];
  try { ops = JSON.parse(storage.getItem(key) || '[]'); } catch { ops = []; }
  const save = () => storage.setItem(key, JSON.stringify(ops));
  let flushing = false;

  return {
    get ops() { return ops.slice(); },
    get rejected() { return rejected.slice(); },
    get size() { return ops.length; },
    add(op) {
      const k = opKey(op);
      const i = ops.findIndex(o => opKey(o) === k);
      if (i >= 0) ops[i] = op; else ops.push(op);
      save();
    },
    clearRejected() { rejected = []; },
    /**
     * Envoie les opérations dans l'ordre. `send(op)` doit lever une erreur avec `.network = true` si le réseau est
     * coupé (on arrête, on garde tout) ou `.business = true` si le serveur refuse (on retire et on signale).
     */
    async flush(send) {
      if (flushing) return { sent: 0, pending: ops.length, busy: true };
      flushing = true;
      let sent = 0;
      try {
        for (;;) {
          const op = ops[0];
          if (!op) break;
          try {
            await send(op);
            sent++;
          } catch (e) {
            if (e && e.network) break;
            rejected.push({ op, message: (e && e.message) || 'Refusé' });
          }
          const i = ops.indexOf(op);   // si l'op a été remplacée pendant l'envoi, la nouvelle reste
          if (i >= 0) ops.splice(i, 1);
          save();
        }
      } finally { flushing = false; }
      return { sent, pending: ops.length };
    },
  };
}
