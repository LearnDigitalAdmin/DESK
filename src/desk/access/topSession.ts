import type { EntityKey, Scope } from "../api";

/** The top desk (COG-0000) needs no customer code: the server returns a session that is already open. Everyone else gets `null` and goes through the code step. */
export function openedSession(
  out: { sessionId: string; verified?: boolean; expiresAt?: number },
  entity: { entityKey: EntityKey; displayName: string },
  scopes: Scope[],
): { sessionId: string; entityKey: EntityKey; displayName: string; scopes: Scope[]; expiresAt: number } | null {
  return out.verified === true && typeof out.expiresAt === "number" ? { sessionId: out.sessionId, entityKey: entity.entityKey, displayName: entity.displayName, scopes, expiresAt: out.expiresAt } : null;
}
/** An action confirmation the server already marked verified (top desk only): the dialog hands the id straight back. */
export const actionAlreadyConfirmed = (out: { verified?: boolean }): boolean => out.verified === true;
