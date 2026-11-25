// The shader's interior dropout (Myers periodicity check). It has to be exact:
// a false hit paints an escaping pixel as interior, and a check that never fires
// is dead weight. Mirrors the shader statement for statement, float32, against a
// no-check run.   node test/period.mjs
const f = Math.fround;
const N = 12;

function run(cx, cy, max, drop) {
  const g = new Float64Array(3 * N); // x = mark, yz = z
  let zx = 0, zy = 0, mark = 1, victim = 0;
  for (let i = 0; i < max; i++) {
    const a = f(zx * zx), b = f(zy * zy), mag2 = f(a + b);
    if (mag2 > 4) return { i, hit: false };
    if (drop) {
      let hit = false;
      for (let k = 0; k < N; k++) if (g[3 * k] === mark && zx === g[3 * k + 1] && zy === g[3 * k + 2]) hit = true;
      if (hit) return { i, hit: true };
    }
    g[3 * victim] = mark; g[3 * victim + 1] = zx; g[3 * victim + 2] = zy;
    if (++victim === N) { victim = 0; mark = mark === 255 ? 1 : mark + 1; }
    const nx = f(a - b + cx);
    zy = f(2 * zx * zy + cy);
    zx = nx;
  }
  return { i: max, hit: false };
}

const fails = [];
const ok = (name, pass, extra = "") => {
  if (!pass) fails.push(name);
  console.log((pass ? "PASS " : "FAIL ") + name + (extra ? " " + extra : ""));
};

// 1. The check must fire at all. A mark bumped every iteration instead of every
// pass of the ring leaves each slot live for one iteration and nothing ever hits.
{
  const r = run(0.2, 0, 4000, true);
  ok("an interior pixel hits", r.hit);
  // 2. And not on iteration 0: the buffer starts zeroed, so a mark of 0 would
  // match every empty slot at z = 0.
  ok("iteration 0 is not a hit", r.hit && r.i > 0, "stopped at " + r.i);
}

// 3. No false hits over rows of one-pixel steps on edges where an escape is
// easily taken for a repeat. An escaping pixel must keep its exact escape time.
const ROWS = [
  [-0.75, 0.1, 1e-7], [-0.743643887037151, 0.13182590420533, 1e-7],
  [-0.7746806106269039, -0.137416885603787, 1e-6], [0.25, 0.0, 1e-7],
  [-1.4011, 0.0001, 1e-7], [-0.1011, 0.9563, 1e-6], [0.2, 0.0, 1e-7],
  [-0.5, 0.5, 1e-6], [0.28, 0.01, 1e-6], [-1.25, 0.02, 1e-6],
];
{
  let bad = 0, n = 0;
  for (const [cx, cy, step] of ROWS)
    for (let k = -24; k < 24; k++) {
      const x = cx + k * step;
      const want = run(x, cy, 4000, false), got = run(x, cy, 4000, true);
      n++;
      if (want.i < 4000 && (got.hit || got.i !== want.i)) bad++;
    }
  ok("no escaping pixel is stopped early", bad === 0, bad + " wrong of " + n);
}

// 4. Worth having: interior pixels stop in ~tens of iterations, not thousands.
{
  let iters = 0, hits = 0;
  for (let k = -12; k < 12; k++) {
    const r = run(0.2 + k * 1e-7, 0, 4000, true);
    if (r.hit) { hits++; iters += r.i; }
  }
  ok("interior orbit stops in tens, not thousands", hits === 24 && iters < 24 * 400,
     (iters / Math.max(hits, 1)).toFixed(0) + " mean iterations");
}

console.log(fails.length ? "FAIL " + fails.join(" | ") : "PASS all");
process.exit(fails.length ? 1 : 0);
