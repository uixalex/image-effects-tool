import { registerEffect } from '../core/registry';
import { ascii } from './ascii';
import { contours } from './contours';
import { crt } from './crt';
import { dither } from './dither';
import { duotone } from './duotone';
import { glitch } from './glitch';
import { lineHalftone } from './lineHalftone';
import { liquid } from './liquid';
import { meshGradient } from './meshGradient';
import { circlePacking } from './circlePacking';
import { dotOverlay } from './dotOverlay';
import { gradientMap } from './gradientMap';
import { halftone } from './halftone';
import { hud } from './hud';
import { pixelMosaic } from './pixelMosaic';

// Novi efekat: napravi modul i dodaj ga ovdje.
for (const effect of [
  ascii, gradientMap, halftone, circlePacking, pixelMosaic, dotOverlay, hud,
  dither, glitch, meshGradient, lineHalftone, contours, liquid, crt, duotone,
]) {
  registerEffect(effect);
}
