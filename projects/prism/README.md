# Prism

## What it is for

Watch an image emerge from stochastic light paths, then inspect one path and measure how noise changes with samples. The scene contains a ground sphere and three spheres with diffuse, rough metal and dielectric materials, lit by a sky gradient.

## How I know

`model.js` is an original JavaScript reference renderer based on the algorithms explained in *Ray Tracing in One Weekend*. `shader.js` implements the same scene, camera, seeded xorshift generator and scattering in WebGL2; `gpu.js` progressively averages linear radiance into two floating-point textures. Display applies square-root gamma. Samples jitter within each pixel; optional depth of field samples a finite lens. The CPU fallback runs in a worker with a smaller image. The material model is deliberately small: cosine-weighted diffuse, a heuristic fuzzed mirror and ideal non-absorbing glass with IOR 1.5 and Schlick reflection. It omits dispersion, volume absorption, explicit lights, multiple importance sampling and Fresnel polarisation. Truncated paths contribute black, so low bounce limits are biased.

Clicking a pixel (or using keyboard arrows and Enter) generates one new reference path, not a reconstruction of all the GPU samples at that pixel. The diagram projects x and z; an out-of-plane bounce can overlap another in this projection. Labels report scattered, reflected, refracted, absorbed or terminated events.

The noise instrument renders a separate 40 × 25 version of the default scene in a worker, comparing its linear radiance against the shipped independent 8,192-sample-per-pixel reference (`reference.js`, seed offset 20,000). It does not measure the display image's pixels. It draws a reference −½ slope and a fit to measured points. A finite reference has noise of its own. Changing the scene or camera disables that comparison until the reference setup is restored. This avoids comparing different ground truths. `tests/generate-reference.js` reproduces the reference and the 128-sample 320 × 200 initial still (convert its PPM to PNG with Pillow). The reference and still use the same default lighting model and camera; no artistic image assets are used.

Run `node projects/prism/tests/run-all.js`. Checks cover a unit-albedo diffuse white furnace, Snell's law (30° incidence into IOR 1.5), total internal reflection, Schlick at normal/grazing incidence, attenuation bounds, and measured RMS convergence. The current seeded 16–512 sample fit is −0.4885, within −0.5 ± 0.1. `tests/browser.html` compares 24 × 15, 512-sample GPU and CPU images in linear radiance, requiring RMS below 0.035. This tolerates stochastic path divergence from float versus double arithmetic; it is not a promise of bit-identical rendering. Recorded results are in `tests/gpu-vs-cpu.json`.

Rendering is capped at 256 samples. Phones start with a lower resolution; the canvas is CSS-scaled while instrument canvases cap device pixel ratio at two. GPU/CPU render loops and metric workers pause through `Kit.onPlay`. A paused preview uses the converged still, starts complete, and plays a 64-sample resolve/reset loop while visible. Reduced-motion previews remain still. No runtime third-party requests are made.

Fonts Manrope and Martian Mono are self-hosted under SIL OFL, with pinned sources in `fonts/`. Serve through the portfolio for the shared kit; use `?cpu` to inspect the worker fallback.

## Sources

- [Shirley, Black and Hollasch: Ray Tracing in One Weekend](https://raytracing.github.io/books/RayTracingInOneWeekend.html) — ray/sphere intersections, scattering, camera and accumulation. Original code, no copied implementation.
- [PBRT, Monte Carlo Basics](https://pbr-book.org/4ed/Monte_Carlo_Integration/Monte_Carlo_Basics) — Monte Carlo error scaling.
- [PBRT, Diffuse Reflection](https://pbr-book.org/4ed/Reflection_Models/Diffuse_Reflection) — Lambertian reflection.
- [Khronos WebGL 2 specification](https://registry.khronos.org/webgl/specs/latest/2.0/) and [EXT_color_buffer_float](https://registry.khronos.org/webgl/extensions/EXT_color_buffer_float/) — floating-point render targets.
