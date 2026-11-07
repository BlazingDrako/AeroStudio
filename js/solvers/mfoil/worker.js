// Web worker: runs airfoil solves and polar sweeps off the UI thread.
import { AirfoilSession } from './api.js';

const live = new AirfoilSession();   // interactive solves
const sweepSession = new AirfoilSession(); // polar sweeps (separate warm-start state)
let sweepToken = 0;

self.onmessage = async (ev) => {
  const msg = ev.data;
  if (msg.type === 'solve') {
    let res;
    try { res = live.solve(msg.spec); }
    catch (e) { res = { ok: false, error: e.message || String(e) }; }
    self.postMessage({ type: 'result', id: msg.id, res });
  } else if (msg.type === 'sweep') {
    const token = ++sweepToken;
    const { spec, alphas } = msg;
    // march outward from the alpha closest to zero, warm-starting each branch
    const sorted = alphas.slice().sort((a, b) => a - b);
    let i0 = 0; for (let i = 0; i < sorted.length; i++) if (Math.abs(sorted[i]) < Math.abs(sorted[i0])) i0 = i;
    const order = [...sorted.slice(i0), ...sorted.slice(0, i0).reverse()];
    let n = 0, branchStart = true;
    for (let k = 0; k < order.length; k++) {
      if (token !== sweepToken) return; // cancelled
      const a = order[k];
      if (k === sorted.length - i0) branchStart = true; // switching to the negative branch
      const s = { ...spec, oper: { ...spec.oper, mode: 'alpha', alpha: a }, warm: !branchStart };
      let pt;
      try {
        const r = sweepSession.solve(s);
        pt = { alpha: a, ok: r.ok && (r.conv || !r.viscous), cl: r.coef.cl, cd: r.coef.cd, cm: r.coef.cm, cdf: r.coef.cdf, cdp: r.coef.cdp,
          xtrU: r.transition ? r.transition[1].x : null, xtrL: r.transition ? r.transition[0].x : null, ms: r.timeMs };
        branchStart = !pt.ok; // after a failure, restart cold
      } catch (e) { pt = { alpha: a, ok: false, error: e.message }; branchStart = true; }
      n++;
      self.postMessage({ type: 'sweepPoint', id: msg.id, pt, done: n, total: order.length });
      await new Promise(r => setTimeout(r, 0)); // let cancel messages in
    }
    if (token === sweepToken) self.postMessage({ type: 'sweepDone', id: msg.id });
  } else if (msg.type === 'cancelSweep') {
    sweepToken++;
  }
};
