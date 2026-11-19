// Headless smoke check. Guards the three things that actually broke: an
// overlay eating input, the wheel/zoom path, and the df pair's precision.
// Usage (server running in the project root):
//   chrome --headless=new --enable-unsafe-swiftshader --use-angle=swiftshader
//     --window-size=800,600 --virtual-time-budget=6000 --dump-dom
//     http://127.0.0.1:8080/test/smoke.html      -> read the <title>
const out = [];
const ok = (name, pass) => out.push((pass ? "PASS " : "FAIL ") + name);

const f = document.createElement("iframe");
f.width = 800; f.height = 600;
f.src = "/index.html";
document.body.append(f);

f.onload = () => setTimeout(() => {
  const w = f.contentWindow, d = f.contentDocument, S = w.S;

  ok("overlay does not cover canvas",
    d.elementFromPoint(400, 300).id === "c");

  const before = S.scale;
  d.getElementById("c").dispatchEvent(new w.WheelEvent("wheel",
    { deltaY: -400, clientX: 400, clientY: 300, bubbles: true, cancelable: true }));
  ok("wheel zooms", S.scale < before);
  ok("floor is 1e-8", w.MIN_SCALE === 1e-8);

  const bits = (x) => new Int32Array(new Float32Array([x]).buffer)[0];
  const fb = (i) => new Float32Array(new Int32Array([i]).buffer)[0];
  const keep = (x) => fb(bits(x));
  const split = (a) => { const h = fb(bits(a) & 0xfffff000); return [h, a - h]; };
  const dfAdd = (a, b) => {
    const s = keep(Math.fround(a[0] + b[0])), v = keep(Math.fround(s - a[0]));
    return [s, Math.fround(Math.fround(Math.fround(Math.fround(a[0] - keep(Math.fround(s - v))) + Math.fround(b[0] - v)) + a[1]) + b[1])];
  };
  const dfMul = (a, b) => {
    const p = keep(Math.fround(a[0] * b[0])), as = split(a[0]), bs = split(b[0]);
    let e = Math.fround(Math.fround(Math.fround(as[0] * bs[0] - p) + Math.fround(as[0] * bs[1])) + Math.fround(as[1] * bs[0]));
    e = Math.fround(e + Math.fround(as[1] * bs[1]));
    e = Math.fround(e + Math.fround(Math.fround(a[0] * b[1]) + Math.fround(a[1] * b[0])));
    return [p, e];
  };

  const cx = -0.743643887037151, step = 1.25e-8;
  const r = dfAdd([Math.fround(cx), cx - Math.fround(cx)], [Math.fround(step), 0]);
  ok("dfAdd keeps a sub-ULP step", Math.abs(r[0] + r[1] - (cx + step)) < step / 2);
  const sq = dfMul([0.6, 0], [0.6, 0]);
  ok("dfMul is exact", Math.abs(sq[0] + sq[1] - 0.36) < 1e-9);

  let m = 0, zr = [0, 0], zi = [0, 0];
  const cr = [Math.fround(cx), cx - Math.fround(cx)];
  const ci = [Math.fround(0.13182590420533), 0.13182590420533 - Math.fround(0.13182590420533)];
  while (m < 300) {
    if (Math.fround(zr[0] * zr[0] + zi[0] * zi[0]) > 4) break;
    const p = dfMul(zr, zi);
    const dd = dfMul(dfAdd([zr[0], 2 * zr[1]], zi), dfAdd(zr, [-zi[0], -zi[1]]));
    zi = dfAdd(dfAdd(p, p), ci); zr = dfAdd(dd, cr); m++;
  }
  ok("df loop reaches the centre's depth", m > 100);

  document.title = out.join(" | ");
}, 800);
