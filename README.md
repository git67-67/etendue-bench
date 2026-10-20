# Etendue Bench

**Live demo: https://git67-67.github.io/etendue-bench/**

Interactive 2D ray tracer for understanding etendue and conservation of radiance when collimating a Lambertian LED.

Open `index.html` in a browser (no build step, no dependencies). It also works on GitHub Pages.

## What it models

- Lambertian LED of a given diameter and light output, optional domed LED with integrated lens
- Up to three lenses: aspheric and spherical plano-convex, biconvex, plano-concave, biconcave, ball lens, plastic Fresnel lens, ideal thin lenses
- Snell refraction, total internal reflection, unpolarised Fresnel reflection loss, estimated groove-riser loss for Fresnel lenses
- Automatic lens spacing (LED in the focal point, afocal pairs) with trim, or free absolute positions
- Readouts: delivered light, centre brightness vs the sun, apparent source size and shadow blur vs the sun, beam size and flatness, etendue budget
- Sweeps over focal length, lens diameter or LED size

## Reading the numbers

Brightness is capped by LED luminance x pi x sin^2(beam half angle). A larger lens gives a larger beam at the same lux. A longer focal length gives harder shadows and costs light. More lenses never beat etendue.

Efficiency, lux and luminance are estimates for a round LED and round lenses, computed from a 2D meridional trace. Sun reference: 100 klx, 0.53 degrees across, 1.6 Gcd/m2.

## Development

- `src/engine.js` ray tracer and statistics (runs in Node and the browser)
- `src/app.js` UI and drawing
- `src/index.template.html` page and styles
- `python3 build.py` rebuilds `index.html`
- `node test/engine-check.js` prints efficiency, beam angle and etendue for several setups

## Reflectors and TIR (v3)
Primary optics: flashlight parabolic reflector (with hole at the base), cone, CPC and a TIR collimator. Statistics now come from a full 3D skew-ray trace; brightness, source size and shadow blur are measured on the wall at the chosen distance.
