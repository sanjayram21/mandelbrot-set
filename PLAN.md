# Depth plan

Goal: remove the hardcoded zoom floor and keep frames correct as depth grows.
Precision scales with depth; it is not fixed from the start. "Infinite" means no
constant, not free — frame time and reference cost both climb, so you stop on
time, not on a clamp.

## Step 0 — done (2026-11-19)

Both shader lines fixed, clamp moved to 1e-8, self-check rewritten. Framebuffer
colours in a 256x192 frame at the seahorse site: 1468 at 1e-6, 1464 at 1e-7,
1275 at 1e-8 (was 28 at 1e-7, 1 at 1e-9). The self-check asserts the two shader
lines and scores a JS mirror against a BigInt orbit; it fails on either bug
reintroduced. `test/selfcheck.html` runs it, `test/smoke.js` still passes.

## Step 1 — done (2026-11-19)

Tiled scheduler: a fixed pixel budget, coarse-first, cancel on any camera change
via a geometry signature, whole-tile granularity, nearest-the-centre first. The
shader takes the drawn rect so one shader serves a full draw and a tile draw, and
tiles are clamped to the view, so only visible pixels are ever iterated.

Verified: self-check and smoke pass; 1e-5 renders fully painted with continuous
structure and no seams; 1e-7 paints edge to edge where the old build left black
voids, though its detail is still df64-limited until step 3.

## State before step 0 (measured, 2026-11-19)

`index.html` at commit `3d93d40`. Clamped at `MIN_SCALE = 1e-7`; flat well before it.

Distinct colours in a 1e-7 frame, against a 200-bit BigInt reference:

| scale | colours | verdict |
|-------|---------|---------|
| 1e-3  | 1530    | fine |
| 1e-7  | 28      | flat |
| 1e-9  | 1       | dead |

Two shader bugs, each invisible until the other is fixed:

- `index.html:213` passes `2.0 * zr.y` as the low word of `zr + zi`, so the sum's
  low word is wrong every iteration (~6e-8/iter, 15 pixels at 1e-7).
- `index.html:208` tests escape on the hi word only (`zr.x*zr.x + zi.x*zi.x`), so
  the low word is computed and discarded. Neighbouring pixels collapse to
  identical `mag2`, hence identical colour.

Toggling both bugs on a 1e-7 view: 28 colours. Fixing either alone: 28. Fixing
both: 1464. Nothing else in the frame moves.

Under the bugs, the arithmetic ceiling: direct df64 carries ~45 bits and dies at
1e-9 even fully repaired — 1/96 distinct pixels, against 96/96 for float64. The
orbit amplifies error ~1e10 over 3000 iterations.

Cost: 105 mean iterations/pixel at 1e-3, 3014 at 1e-13. At 1080p that is 6.2e9
iterations per unmitigated frame. Interior rings at radius 1e-6 and 1e-7 did not
escape within 500k iterations.

## Precision ladder

Ordered so the software limit never runs ahead of the arithmetic limit. "Binds"
is what fails next if that step is taken alone.

| Step | Ceiling after | Binds | Why |
|------|---------------|-------|-----|
| now | 1e-7 (clamp), flat from 1e-6 | clamp, then hi-word escape | arithmetic merges pixels |
| 0. Two shader fixes + iteration self-check | ~1e-8 | df64's 45 bits | repair, not depth |
| 1. δ-perturbation, centre reference, f32 δ | ~1e-14 (measured 1e-15) | camera is a double, 1.65e-16 ULP at cx | frame differs pixel to pixel again |
| 2. Newton-search reference to a nucleus; reference past its escape | 1e-16 camera, then 1e-25 δ underflow | camera double; f32 min-normal 1.2e-38 | amplification freezes at the reference's escape |
| 3. Arbitrary-precision camera (offset pairs) | 1e-25 | f32 δ underflow | can name positions deeper than offsets can travel |
| 4. Exponent-carrying δ (mantissa, exp) | 1e-300 dispatch / ~1e-100 usable | BigInt reference cost | no f32 exponent room; time is now the limit |

Amplification from the starting offset is `A = prod |2*Z_k|`, frozen once the
reference escapes. A centre escaping at 2124 caps you near 1e-17 at any bit
depth — a location limit, not a precision limit. Inside a minibrot the orbit is
bounded and `A` keeps growing. Ceilings are for correctness; frame time is the
scheduler's job.

## Steps

0. Repair both shader lines and replace the constant-only `dfAdd` self-check with
   one that iterates against a BigInt reference, so reverting either line fails.
   Raise `MIN_SCALE` off the 1e-7 clamp.
1. Scheduler: fixed pixel budget, coarse-first tiles, wall-clock budget, cancel on
   camera change. Lands on the current renderer so later steps get measured
   against a stable frame budget.
2. Interior dropout: periodicity check; provably interior pixels stop early, tiles
   marked cheap. Biggest frame-time win at depth.
3. Perturbation core: BigInt reference on a blob-URL worker, precision
   `24 - log2(pixelStep)`, f32 δ, `δ' = 2Zδ + δ² + δc`, escape on the full pair.
   Debounced, cancelable, previous frame shown while it builds.
4. Reference selection: Newton to a nucleus/Misiurewicz point, reference runs ~40
   iterations past its escape, rebase on `|δ| > |z|`.
5. Arbitrary-precision camera, then exponent-carrying δ.
6. Colouring: C1 derivative `z' <- 2zz' + 1` and distance estimate
   `d ≈ |z| log|z| / |dz|`; histogram-equalised palette for shallow frames.

Non-goals until measured: multi-reference scattering, precomputed pyramids, BLA.

## Open decisions

1. Camera: double + shift-relative offsets (good to 1e-14, covers steps 0-4) or
   arbitrary precision from 1e-16 (only way to drag deep). Leaning to the first.
2. Autoplay's hardcoded sites run out at depth: park near 1e-30 or let it wander.

## Testing

`test/probe.html` dumps framebuffer stats (colours, sd) into `<title>` for
headless runs — screenshots are misleading here. `test/orbit.mjs` compares the
df64 loop to a 200-bit BigInt orbit. Both read `index.html` directly.

Render: Windows chrome with
`--headless=new --enable-unsafe-swiftshader --use-angle=swiftshader
--virtual-time-budget=N --dump-dom http://127.0.0.1:8080/test/probe.html#cx,cy,scale`.
SwiftShader absolute fps is ~10x pessimistic; iteration counts are exact.
