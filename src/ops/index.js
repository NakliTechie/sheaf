// ops/index.js — the one place ops register into the registry. Importing a new op
// module and adding it here is the entire wiring; the UI, agent face, and conductor
// all pick it up automatically because they read the registry, not this file.

import { registerAll } from '../core/registry.js';
import { ops as openOps } from './open.js';
import { ops as pageOps } from './pages.js';
import { ops as metadataOps } from './metadata.js';
import { ops as marksOps } from './marks.js';
import { ops as annotateOps } from './annotate.js';
import { ops as formsOps } from './forms.js';
import { ops as textOps } from './text.js';
import { ops as redactOps } from './redact.js';
import { ops as signOps } from './sign.js';
import { ops as convertOps } from './convert.js';

export function registerOps() {
  registerAll([
    ...openOps,
    ...pageOps,
    ...metadataOps,
    ...marksOps,
    ...annotateOps,
    ...formsOps,
    ...textOps,
    ...redactOps,
    ...signOps,
    ...convertOps,
  ]);
}
