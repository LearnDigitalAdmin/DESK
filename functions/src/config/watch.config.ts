import { bundleSecret } from "./secretsBundle";
/**
 * Landlord Watch configuration.
 * - LW_BOT_API_KEY: Secret Manager secret that already exists in plot-9fd6e. Bound to the WhatsApp webhook function.
 * - LW_API_URL (env, optional): overrides the default lwBotApi endpoint.
 * - LW_MOCK=1 (env): use the in-memory mock instead of the backend.
 */


export const LW_BOT_API_KEY = bundleSecret('LW_BOT_API_KEY');

export const LW_DEFAULT_API_URL = 'https://africa-south1-plot-9fd6e.cloudfunctions.net/lwBotApi';

export function getLwApiUrl(): string {
  return (process.env.LW_API_URL || '').trim() || LW_DEFAULT_API_URL;
}

export function isLwMock(): boolean {
  return (process.env.LW_MOCK || '').trim() === '1';
}

/** The shared secret. Never log this value. */
export function getLwApiKey(): string {
  try {
    const fromSecret = LW_BOT_API_KEY.value();
    if (fromSecret) return fromSecret;
  } catch {
    // secret not bound (local run); fall through to the env var
  }
  return process.env.LW_BOT_API_KEY || '';
}
