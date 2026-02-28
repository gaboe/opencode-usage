/**
 * Action service — ensures all plugin adapter commands are registered.
 *
 * Call `ensureActionsRegistered()` once at server startup so that
 * account and action commands are available in the command registry.
 */

const isBun = typeof globalThis.Bun !== "undefined";

// Suppress unused-variable lint — runtime detection guard kept for parity
void isBun;

let registered = false;

/**
 * Import plugin-adapters as a side-effect to register all commands.
 * Safe to call multiple times — registration happens only once.
 */
export function ensureActionsRegistered(): void {
  if (registered) return;
  registered = true;

  // Side-effect import — triggers registerCommand calls at module load
  import("./plugin-adapters.js");
}
