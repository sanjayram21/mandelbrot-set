// Perturbation: iterate a per-pixel offset d against a reference orbit Z that is
// computed once at high precision. z = Z + d, so d' = 2Zd + d^2 + dc and the
// escape test is |Z + d| > 2. This is the shader's loop, statement for statement,
// against a direct 200-bit orbit. If the offsets are right the escape times agree;
// if the reference is too short or the pair arithmetic is wrong they diverge.
//   node test/perturb.mjs [scale]
const scale = Number(process.argv[2] || 1e-8);
const CX = -0.743643887037151, CY = 0.13182590420533, W = 480, MAX = 4000;

const f = Math.fround;
const bits = (x) => new Int32Array(new Float32Array([x]).buffer)[0];
const fb = (i) => new Float32Array(new Int32Array([i]).buffer)[0];
const keep = (x) => fb(bits(x));
const split = (a) => { const h = fb(bits(a) & 0xfffff000); return [h, a - h]; };
const dfAdd = (a, b) => {
  const s = keep(f(a[0] + b[0])), v = keep(f(s - a[0]));
  return [s, f(f(f(f(a[0] - keep(f(s - v))) + f(b[0] - v)) + a[1]) + b[1])];
};
const dfMul = (a, b) => {
  const p = keep(f(a[0] * b[0])), as = split(a[0]), bs = split(b[0]);
  let e = f(f(f(as[0] * bs[0] - p) + f(as[0] * bs[1])) + f(as[1] * bs[0]));
  e = f(e + f(as[1] * bs[1]));
  e = f(e + f(f(a[0] * b[1]) + f(a[1] * b[0])));
  return [p, e];
};
const dfSub = (a, b) => dfAdd(a, [-b[0], -b[1]]);
const dfScale = (a, k) => [f(a[0] * k), f(a[1] * k)];

// --- reference orbit, exact -------------------------------------------------
const P = 200n, S = 1n << P;
const big = (x) => BigInt(Math.round(x * 2 ** 52)) << (P - 52n);
const CXb = big(CX), CYb = big(CY);

// Z_0 = 0, Z' = Z^2 + C, exact until escape, then 40 more in float64: past
// escape |Z| squares every step and 200-bit fixed point overflows within ~10.
function reference() {
  let zx = 0n, zy = 0n;
  const out = [];
  for (let i = 0; i < MAX; i++) {
    out.push([zx, zy]);
    if (zx * zx + zy * zy > 4n * S * S) {
      let x = Number(zx) / 2 ** 200, y = Number(zy) / 2 ** 200;
      for (let k = 0; k < 40; k++) {
        [x, y] = [x * x - y * y + CX, 2 * x * y + CY];
        out.push([x, y]);
      }
      break;
    }
    const nx = (zx * zx - zy * zy) / S + CXb, ny = (2n * zx * zy) / S + CYb;
    zx = nx; zy = ny;
  }
  return out;
}
const REF = reference();
const ESC = REF.findIndex(([a, b]) => (typeof a === "bigint" ? Number(a) / 2 ** 200 : a) ** 2 + (typeof b === "bigint" ? Number(b) / 2 ** 200 : b) ** 2 > 4);
// to float32 pairs; the shader gets hi and lo words. The post-escape points are
// float64 already, so the pair split keeps their low word and Z stays exact to
// ~48 bits while d is still ~0.5.
const REFf = REF.map(([zx, zy]) => {
  const hx = typeof zx === "bigint" ? Number(zx) / 2 ** 200 : zx;
  const hy = typeof zy === "bigint" ? Number(zy) / 2 ** 200 : zy;
  return [f(hx), f(hx - f(hx)), f(hy), f(hy - f(hy))];
});
// where the reference stops being usable: at its escape. Past that |Z| squares
// every step and the pair sum with d loses the pixel within a few iterations.
const TAIL = REFf.findIndex(([hx, , hy]) => hx * hx + hy * hy > 4);

// complex multiply on pairs: (ar + ai i)(br + bi i)
const dfMulC = (ar, ai, br, bi) => {
  const rr = dfMul(ar, br), ii = dfMul(ai, bi), ri = dfMul(ar, bi), ir = dfMul(ai, br);
  return [dfSub(rr, ii), dfAdd(ri, ir)];
};

function perturb(dcx, dcy) {
  let dr = [f(dcx), f(dcx - f(dcx))], di = [f(dcy), f(dcy - f(dcy))];
  const dcr = [f(dcx), f(dcx - f(dcx))], dci = [f(dcy), f(dcy - f(dcy))];
  for (let i = 0; i < MAX; i++) {
    const Zr = [REFf[i][0], REFf[i][1]], Zi = [REFf[i][2], REFf[i][3]];
    const zr = dfAdd(Zr, dr), zi = dfAdd(Zi, di);
    if ((zr[0] + zr[1]) ** 2 + (zi[0] + zi[1]) ** 2 > 4) return i;
    // Step 3 has no reference selection yet, so the reference is the centre's
    // own orbit and it is only stored to its escape. A pixel that outlives it
    // has no Z left to follow; fall back to direct iteration from where it is
    // (df64, so it is the old flat behaviour, not wrong). Step 4 replaces this
    // with a reference that is chosen to outlive its pixels.
    // Fall back to direct iteration as soon as the offset outgrows the
    // reference: past that the sum Z + d is dominated by d and loses the pixel.
    // Both are still modest at the crossing, so z is still good there.
    // |Z| also dips to ~0 where the reference crosses the origin, so the ratio
    // alone fires there; the floor keeps it from firing on a near-zero Z.
    if (i + 1 >= TAIL || (i > 0 && (dr[0] ** 2 + di[0] ** 2) > Math.max(1e-6, Zr[0] ** 2 + Zi[0] ** 2)))
      return direct(zr, zi, [f(CX + dcx), CX + dcx - f(CX + dcx)], [f(CY + dcy), CY + dcy - f(CY + dcy)], i);
    // d' = 2Zd + d^2 + dc
    const [lzr, lzi] = dfMulC(dfAdd(Zr, Zr), dfAdd(Zi, Zi), dr, di);
    const [sqr, sqi] = dfMulC(dr, di, dr, di);
    dr = dfAdd(dfAdd(lzr, sqr), dcr);
    di = dfAdd(dfAdd(lzi, sqi), dci);
  }
  return MAX;
}

// direct df64 iteration from a position, for the tail past the reference
function direct(zr, zi, cr, ci, from) {
  for (let i = from; i < MAX; i++) {
    if ((zr[0] + zr[1]) ** 2 + (zi[0] + zi[1]) ** 2 > 4) return i;
    const p = dfMul(zr, zi);
    const d = dfMul(dfAdd(zr, zi), dfAdd(zr, [-zi[0], -zi[1]]));
    zi = dfAdd(dfAdd(p, p), ci);
    zr = dfAdd(d, cr);
  }
  return MAX;
}

function exact(cx, cy) {
  let zr = 0n, zi = 0n;
  const a0 = big(cx), b0 = big(cy);
  for (let i = 0; i < MAX; i++) {
    const a = (zr * zr) / S, b = (zi * zi) / S;
    if (a + b > 4n * S) return i;
    zi = (2n * zr * zi) / S + b0;
    zr = a - b + a0;
  }
  return MAX;
}

const px = (2 * scale) / W;
let bad = 0;
for (let k = -5; k <= 5; k++) {
  const cx = CX + k * px;
  const e = exact(cx, CY), p = perturb(k * px, 0);
  if (Math.abs(e - p) > 1) bad++;
  console.log(`k=${String(k).padStart(3)} exact=${e} perturb=${p}${Math.abs(e - p) > 1 ? "  MISMATCH" : ""}`);
}
console.log(`\nscale ${scale}: ${bad}/11 pixels off by >1 iter`);
process.exit(bad ? 1 : 0);
