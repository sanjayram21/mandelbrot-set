// Is the df64 loop wrong, or just out of precision? Runs the shader's exact
// df64 algorithm in JS next to a 200-digit BigInt orbit and compares escape
// times across a pixel row at a given scale.
//   node test/orbit.mjs <scale>
const scale = Number(process.argv[2] || 1e-7);
const CX = -0.743643887037151, CY = 0.13182590420533, W = 480;

const bits = (x) => new Int32Array(new Float32Array([x]).buffer)[0];
const fb = (i) => new Float32Array(new Int32Array([i]).buffer)[0];
const keep = (x) => fb(bits(x));
const f = Math.fround;
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

const P = 200n, S = 10n ** P;
const big = (x) => BigInt(Math.round(x * 1e15)) * 10n ** (P - 15n);
const CXb = big(CX), CYb = big(CY);

function exact(cx, cy, max = 4000) {
  let zr = 0n, zi = 0n;
  for (let i = 0; i < max; i++) {
    const a = (zr * zr) / S, b = (zi * zi) / S;
    if (a + b > 4n * S) return i;
    zi = (2n * zr * zi) / S + cy;
    zr = a - b + cx;
  }
  return max;
}

function df(cx, cy, max = 4000) {
  let zr = [0, 0], zi = [0, 0];
  const cr = [f(cx), cx - f(cx)], ci = [f(cy), cy - f(cy)];
  for (let i = 0; i < max; i++) {
    if (f(zr[0] * zr[0] + zi[0] * zi[0]) > 4) return i;
    const p = dfMul(zr, zi);
    const d = dfMul(dfAdd([zr[0], 2 * zr[1]], zi), dfAdd(zr, [-zi[0], -zi[1]]));
    zi = dfAdd(dfAdd(p, p), ci);
    zr = dfAdd(d, cr);
  }
  return max;
}

const px = (2 * scale) / W;
let bad = 0, sum = 0;
for (let k = -5; k <= 5; k++) {
  const cx = CX + k * px, cy = CY;
  const e = exact(big(cx), big(cy)), d = df(cx, cy);
  sum += e;
  if (Math.abs(e - d) > 1) bad++;
  console.log(`k=${String(k).padStart(3)} exact=${e} df64=${d}${Math.abs(e - d) > 1 ? "  MISMATCH" : ""}`);
}
console.log(`\nscale ${scale}: ${bad}/11 pixels off by >1 iter, mean escape ${(sum / 11).toFixed(0)}`);
