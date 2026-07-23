# Holographic Avatar — Layer & Mask Plan

Source plate: `public/assets/source.png` (cyan holographic portrait on pure black).

## Layer stack (bottom → top)

| Z   | Layer                       | Asset / method                       | Purpose                                                                            |
| --- | --------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------- |
| 0   | Background                  | solid `#000000`                      | Pure black void — never drawn over                                                 |
| 1   | Face volume + base features | `source.png`                         | Identity plate: face contours, nose, brows, closed mouth, hair, particles baked in |
| 2   | Hair strand groups          | `source.png` × region masks          | Independent wind deformation per group                                             |
| 3   | Mouth visemes               | `mouth/*.png`                        | Lip-sync crossfade in mouth ROI                                                    |
| 4   | Eye lids                    | `eyes/closed.png` + descending masks | Gradual blink without vertical eye squash                                          |
| 5   | Hologram FX                 | shaders / particles                  | Scanlines, luminosity pulse, contour particles, rare glitches                      |
| 6   | State FX                    | opacity / dissolve                   | materializing / dematerializing / error tint                                       |

## Masks & ROIs (normalized 0–1 of source)

Configured in `src/config/avatarConfig.ts`:

- **Left eye ROI** — upper-lid wipe for blink
- **Right eye ROI** — upper-lid wipe for blink
- **Mouth ROI** — viseme crossfade crop/blend window
- **Hair regions** (5+): crown, left front wisps, right front wisps, left fall, right fall — each with amplitude/phase for wind

## Mouth visemes (Rhubarb-compatible)

| Cue         | State        | Asset                     |
| ----------- | ------------ | ------------------------- |
| `X`         | closed       | `mouth/closed.png`        |
| `A`         | consonant    | `mouth/consonant.png`     |
| `B`         | slightlyOpen | `mouth/slightly-open.png` |
| `C`/`D`/`H` | wideOpen     | `mouth/wide-open.png`     |
| `E`/`F`     | rounded      | `mouth/rounded.png`       |
| `G`         | puckered     | `mouth/puckered.png`      |

Fallback: Web Audio analyser → amplitude/centroid maps to the same six states with interpolation.

## Hair motion method

Each hair region is a masked sprite of the source plate. A shared noise displacement map is scrolled at different UV speeds per region (Pixi `DisplacementFilter`), producing organic multi-strand wind rather than rigid rotation.

## What we deliberately do not do

- No CSS stick figures / emoji substitutes
- No HUD panels, captions baked into the WebGL scene, or cyberpunk chrome
- No redesign of facial identity — overlays stay locked to the source plate
