// ops/open.js — the canonical document-open ops. The file picker, drag-drop, URL
// mode, and the agent face all funnel through these, so opening goes through the
// same registry + single ingress as everything else. Open ops seed the replay floor
// (runner) rather than appending to the op-log — you don't "replay opening".

import { SheafDoc } from '../core/doc.js';

export const ops = [
  {
    id: 'open.bytes', label: 'Open PDF', group: 'open', icon: 'open',
    description: 'Open a PDF from raw bytes. The single ingress validates the %PDF header before parsing.',
    agentCallable: true,
    params: { bytes: { type: 'bytes', required: true } },
    async run(_doc, { bytes }) {
      return { doc: await SheafDoc.fromBytes(bytes, { validate: true }) };
    },
  },
  {
    id: 'open.blank', label: 'New blank PDF', group: 'open', icon: 'new',
    description: 'Create a new blank document with the given number of US-Letter pages.',
    agentCallable: true,
    params: { pages: { type: 'int', default: 1, min: 1, max: 1000 } },
    async run(_doc, { pages }) {
      return { doc: await SheafDoc.blank(pages) };
    },
  },
];
