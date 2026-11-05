// commands.js — the common-rail door (naklios docs/app-contract.md, "Common rail").
// commands.json at the repo root declares the commands; these handlers run them. Each
// one calls buildApi(), the object behind window.sheaf, so the developer door and the
// host door are two doors on one core: same reads, same runner, same op-log. The host's
// Grant is the gate here, so nothing in this module looks at state.dev.agentFace.
//
// Every handler returns plain structured-cloneable data: never a SheafDoc, never bytes,
// never page text. An operation that did not happen throws, so the catalog reports an
// error rather than a result.

import { buildApi } from './agent.js';
import { state } from './state.js';

// A caller's small model reads these results, so a long PDF or folder stays short.
const COMMAND_LIST_LIMIT = 50;

const takesBytes = (param) => param.type === 'bytes' || param.items?.type === 'bytes';

// What a command may run: the agent-callable ops that change the open document and need
// nothing a caller cannot send. Left out: open ops, which replace the document and clear
// its undo history; artifact ops, whose output a command could not hand over; ops that
// take file bytes; and signing, because a signature is the person's own act. Everything
// left in stays in memory and undoable until the person saves, and no command saves.
export function runnableOps(ops) {
  return ops.filter(op => op.mutates && op.group !== 'open' && op.id !== 'sign.place' && !Object.values(op.params).some(takesBytes));
}

// The runnable ops that can lose something, so they run through operation.run_destructive
// and the host asks the person each time. One consent to add a page number must not cover
// these. pages.reorder, pages.reverse and pages.duplicate are here because they rebuild the
// document and drop its form fields. annotate.rect and annotate.highlight can draw an opaque
// block, which is a whiteout by another name. forms.fill and metadata.set replace old values.
const DESTRUCTIVE_OPS = new Set([
  'pages.crop', 'pages.delete', 'pages.reorder', 'pages.keepRange', 'pages.nUp', 'pages.reverse',
  'pages.duplicate', 'pages.extract', 'metadata.set', 'annotate.highlight', 'annotate.rect',
  'forms.fill', 'forms.flatten', 'text.whiteout', 'redact.region',
]);

export const commandFor = (id) => (DESTRUCTIVE_OPS.has(id) ? 'operation.run_destructive' : 'operation.run');

export function createCommandHandlers() {
  const core = buildApi();

  // One change at a time: two concurrent ops would both start from the same document
  // and the op-log would no longer replay to what is on screen.
  let queue = Promise.resolve();
  // A caller that gave up while queued has its signal aborted; its work never starts.
  const inTurn = (work, signal) => {
    const turn = queue.then(() => {
      if (signal?.aborted) throw new Error('The call was cancelled before it started.');
      return work();
    });
    queue = turn.catch(() => {});
    return turn;
  };
  const summary = () => {
    const { fileName, pageCount, dirty, history } = core.context();
    return { fileName, pageCount, unsaved: dirty, canUndo: history.canUndo };
  };

  // Each command runs only its own ops, so a caller cannot reach a destructive op
  // through the consent given to operation.run.
  const runThrough = (command) => ({ op, params = {} }, { signal } = {}) => inTurn(async () => {
    if (!runnableOps(core.ops()).some(o => o.id === op)) throw new Error(`Operation "${op}" cannot run as a command.`);
    if (commandFor(op) !== command) throw new Error(`Operation "${op}" runs through ${commandFor(op)}.`);
    const { warning } = await core.run(op, params);
    return { op, ...summary(), ...(warning ? { warning } : {}) };
  }, signal);

  return {
    'operations.list'() {
      return { operations: runnableOps(core.ops()).map(op => ({ ...op, command: commandFor(op.id) })) };
    },

    'document.read'() {
      const context = core.context();
      if (!context.open) return { open: false, message: 'No PDF is open in Sheaf.' };
      const { files, currentIndex } = state.session;
      return {
        ...context,
        pages: context.pages.slice(0, COMMAND_LIST_LIMIT),
        folder: files.length
          ? { count: files.length, current: currentIndex, names: files.slice(0, COMMAND_LIST_LIMIT).map(f => f.name) }
          : null,
      };
    },

    'operation.run': runThrough('operation.run'),

    'operation.run_destructive': runThrough('operation.run_destructive'),

    'operation.undo'(_args, { signal } = {}) {
      return inTurn(async () => {
        if (!core.context().open) throw new Error('No PDF is open in Sheaf.');
        return { undone: await core.undo(), ...summary() };
      }, signal);
    },
  };
}

// Hosted only, and independent of the developer setting. A failure here costs the
// commands, never the app.
export function registerCommands() {
  if (typeof window === 'undefined') return;
  const rail = window.naklios?.experimental_commands;
  if (!rail || window.parent === window) return;
  const handlers = createCommandHandlers();
  fetch('./commands.json').then(response => response.json()).then(manifest =>
    rail.register(manifest.commands.map(command => ({ ...command, handler: handlers[command.name] })))
  ).catch(error => console.warn('[sheaf] commands could not register', error));
}
