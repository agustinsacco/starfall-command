# Original component library

`src/art.js` builds all six unit classes, eight structures, crystals, gas vents, terrain, shadows, and combat effects from original procedural geometry. Lighting, bevels, surface wear, glass, team-color illumination, animated infantry/drone movement, siege stabilizers, exhaust and aircraft thrusters are generated locally. Art randomness never changes the simulation's random state.

The renderer caches up to 384 high-resolution sprites; it does not continuously rebuild each model. Unit rotations and movement phases use cached views. Terrain is generated once per operation/load from its saved mission seed. The map layout remains Kestrel Basin; changing the seed changes surface detail and the AI's random sequence, not map topology.

`npm run assets` regenerates the transparent PNG component previews, a roster/contact sheet, and the application icon in `assets/generated/` using the actual Electron renderer and an isolated temporary profile. Those previews are for inspection; gameplay generates its own view-angle and pose variants from the models rather than using these static preview PNGs.

This is a detailed 2.5D art upgrade, not photorealistic assets or a full real-time 3D engine. No StarCraft art, audio, models, textures, or external generation service was used.
