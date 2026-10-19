import { createHash } from 'crypto';

/** `aiProviders.provider` value the frontend preset writes for the OpenCode Go gateway. */
export const OPENCODE_GO_PROVIDER = 'opencodego';

/** OpenAI-compatible base URL of the OpenCode Go gateway (OpenAI chat-completions surface). */
export const OPENCODE_GO_BASE_URL = 'https://opencode.ai/inference/go/openai/v1';

/** Public OpenCode Go model catalog; returns an OpenAI-style `{ object: 'list', data: [...] }`. */
export const OPENCODE_GO_MODELS_URL = 'https://opencode.ai/inference/go/v1/models';

/** OpenCode Go requires clients to identify themselves with their own product user agent. */
export const BLINKO_USER_AGENT = 'blinko/1.8.8'; // keep in sync with package.json "version"

/**
 * OpenCode Go wants a stable session id per conversation so it can route requests and
 * cache prompt prefixes. Hash the scope (plus the provider key as a per-deployment salt,
 * so unrelated Blinko installs never share one routing session) so the vendor never
 * receives raw Blinko ids or the key itself.
 */
export function opencodeSessionId(scope: string, salt: string = ''): string {
  return createHash('sha256').update(`blinko:${scope}:${salt}`).digest('hex').slice(0, 32);
}

/** Provider-wide default headers: used for every request sent to the opencodego provider. */
export function opencodeGoDefaultHeaders(providerId?: number, apiKey?: string | null): Record<string, string> {
  return {
    'User-Agent': BLINKO_USER_AGENT,
    'x-opencode-session': opencodeSessionId(`provider/${providerId ?? 'default'}`, apiKey || ''),
  };
}

/** Per-conversation session override so one chat reuses one id across turns/retries. */
export function opencodeGoConversationHeader(conversationId: number, apiKey?: string | null): Record<string, string> {
  return { 'x-opencode-session': opencodeSessionId(`conversation/${conversationId}`, apiKey || '') };
}
