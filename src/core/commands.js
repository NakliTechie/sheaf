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

// What operation.run accepts: the agent-callable ops that change the open document and
// need nothing a caller cannot send. Left out: open ops, which replace the document and
// clear its undo history; artifact ops, whose output a command could not hand over; and
// ops that take file bytes. Every op left in stays in memory and undoable until the
// person saves, and no command saves, which is why operation.run is `write`.
export function runnableOps(ops) {
  return ops.filter(op => op.mutates && op.group !== 'open' && !Object.values(op.params).some(takesBytes));
}

export function createCommandHandlers() {
  const core = buildApi();

  // One change at a time: two concurrent ops would both start from the same document
  // and the op-log would no longer replay to what is on screen.
  let queue = Promise.resolve();
  const inTurn = (work) => {
    const turn = queue.then(work);
    queue = turn.catch(() => {});
    return turn;
  };
  const summary = () => {
    const { fileName, pageCount, dirty, history } = core.context();
    return { fileName, pageCount, unsaved: dirty, canUndo: history.canUndo };
  };

  return {
    'operations.list'() {
      return { operations: runnableOps(core.ops()) };
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

    'operation.run'({ op, params = {} }) {
      return inTurn(async () => {
        if (!runnableOps(core.ops()).some(o => o.id === op)) throw new Error(`Operation "${op}" cannot run as a command.`);
        const { warning } = await core.run(op, params);
        return { op, ...summary(), ...(warning ? { warning } : {}) };
      });
    },

    'operation.undo'() {
      return inTurn(async () => {
        if (!core.context().open) throw new Error('No PDF is open in Sheaf.');
        return { undone: await core.undo(), ...summary() };
      });
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
