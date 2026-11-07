// Airfoil presets and coordinate-file parsing (Selig and Lednicer .dat formats).

export const presets = [
  { code: '0012', label: 'NACA 0012', note: 'Symmetric, 12% thick — tails, rotor blades, the classic test case' },
  { code: '2412', label: 'NACA 2412', note: 'Mild camber — the Cessna 172 wing' },
  { code: '4412', label: 'NACA 4412', note: 'More camber — high lift, widely tested' },
  { code: '4415', label: 'NACA 4415', note: 'Thicker high-lift section' },
  { code: '23012', label: 'NACA 23012', note: 'Five-digit series — forward camber, low pitching moment' },
  { code: '0006', label: 'NACA 0006', note: 'Thin symmetric — sharp nose, early leading-edge stall' },
  { code: '6409', label: 'NACA 6409', note: 'Highly cambered thin section — low-speed, model aircraft' },
  { code: '0018', label: 'NACA 0018', note: 'Thick symmetric — wind turbines, struts' },
];

export function parseCoordinates(text, filename = 'Custom') {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length);
  let name = filename.replace(/\.(dat|txt|csv)$/i, '');
  const pts = [];
  for (const line of lines) {
    const nums = line.replace(/,/g, ' ').split(/\s+/).map(Number);
    if (nums.length >= 2 && nums.slice(0, 2).every(isFinite) && /^[-+.\d]/.test(line)) pts.push([nums[0], nums[1]]);
    else if (!pts.length) name = line.slice(0, 60);
  }
  if (pts.length < 10) throw new Error('Could not find enough coordinate pairs in the file.');
  let P = pts;
  // Lednicer: first pair holds point counts (both > 1), then upper LE→TE, then lower LE→TE
  if (P[0][0] > 1.5 && P[0][1] > 1.5 && Number.isInteger(P[0][0]) && Number.isInteger(P[0][1])) {
    const nu = P[0][0], nl = P[0][1];
    const up = P.slice(1, 1 + nu), lo = P.slice(1 + nu, 1 + nu + nl);
    P = [...up.reverse(), ...lo.slice(1)];
  }
  // remove consecutive duplicates
  const Q = [P[0]];
  for (let i = 1; i < P.length; i++) if (Math.hypot(P[i][0] - Q[Q.length - 1][0], P[i][1] - Q[Q.length - 1][1]) > 1e-9) Q.push(P[i]);
  // normalize to unit chord with leading edge at the origin
  let xmin = Infinity, xmax = -Infinity, iLE = 0;
  Q.forEach(([x], i) => { if (x < xmin) { xmin = x; iLE = i; } xmax = Math.max(xmax, x); });
  const c = xmax - xmin, zLE = Q[iLE][1];
  const x = Q.map(p => (p[0] - xmin) / c), z = Q.map(p => (p[1] - zLE) / c);
  return { kind: 'coords', name, x, z };
}
