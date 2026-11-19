# Mandelbrot

Single-file WebGL2 Mandelbrot viewer (`index.html`). `test/` is a scratch bench:
numbered probes cloned from `index.html`, screenshots, and Playwright drivers.

## Images — do not read them in the main session

The main model is DeepSeek, which 400s on more than 8 images per request and
counts every image still in context. For a screenshot, run this and read the
reply:

```sh
printf '%s\n' test/shot.png | ca "Does this render cleanly, or are there bands/artifacts?"
```

`ca` is defined in `~/.zshrc` (a separate `claude` on `glm-5.3-flash`, `Read`
only). One or two images inline is fine; three or more, or any session that
already holds images, goes through `ca`. Prefer text: `test/dbg5.html`-style
probes that encode shader state into pixels and dump integers beats a screenshot.

## Rendering a frame headlessly

Linux Playwright chromium is missing its shared libs here. Use Windows Chrome
with `--headless=new --enable-unsafe-swiftshader --use-angle=swiftshader
--virtual-time-budget=N --screenshot=... file:///C:/Users/...`. `file://` works;
`test/deep.html` (generated from `index.html`) takes `#cx,cy,scale` in the hash
so deep views can be shot without clicks. `test/check-cdp.js` needs Windows node
20+, which is not installed — prefer the one-shot `--screenshot` call.

## Deep zoom

The shader uses double-float (df64) emulation. Its two-sum must stay the Knuth
form with bitcast barriers (`keep`); the split form loses the pixel step once it
is under half an ULP of the centre and the frame goes flat. Auto-iterations must
scale with depth or interior pixels all hit the cap and render one colour.

## Verify

There is no test suite. A change is checked by rendering the affected view and
reading the numbers/pixels; state is real when the HUD and the sampled pixels
both agree.
