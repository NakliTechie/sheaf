// sendto.js — PDFs sent from the NakliOS Files app (naklios docs/file-handoff-v1.md,
// "Send to (v2)"). commands.json declares `accepts`; each grant here is a read-only copy.
// A send opens through the same path as a dropped file, with the same unsaved-work guard.

import { openIncoming } from './fileops.js';

// Sheaf holds one document, so grants open one at a time, in the order they arrived.
export function createSendHandler(files, open = openIncoming) {
  let queue = Promise.resolve();
  const openGrant = async (grant) => {
    try {
      await open(async () => {
        const { bytes, name } = await files.read(grant.token);
        return { bytes: new Uint8Array(bytes), name };
      }, 'Could not open the sent file');
    } finally {
      files.release(grant.token);
    }
  };
  return (grant) => {
    if (grant?.kind !== 'send') return queue;
    queue = queue.then(() => openGrant(grant)).catch(() => {});
    return queue;
  };
}

// Hosted only. The host holds a grant until the app calls ready(), so ready() comes last.
export function initSendTo() {
  const sdk = window.naklios;
  if (!sdk?.files || window.parent === window) return;
  sdk.files.onOpen(createSendHandler(sdk.files));
  sdk.ready();
}
