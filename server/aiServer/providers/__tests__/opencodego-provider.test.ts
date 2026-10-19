import { describe, it, expect, mock, afterAll, afterEach } from 'bun:test';
import { generateText } from 'ai';
import {
  OPENCODE_GO_BASE_URL,
  BLINKO_USER_AGENT,
  opencodeSessionId,
  opencodeGoDefaultHeaders,
  opencodeGoConversationHeader
} from '../../opencodeGo';

// Only the proxy module is mocked: `@ai-sdk/openai` stays real so these tests observe the
// requests the SDK actually builds. Bun's `mock.module` is process-wide, so mocking the SDK
// here would leak into (and break) the other provider test files.
mock.module('@server/lib/proxy', () => ({
  fetchWithProxy: async () => fetch
}));

const headersToObject = (headers: Headers): Record<string, string> => {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key] = value;
  });
  return result;
};

const chatCompletion = {
  id: '1',
  object: 'chat.completion',
  created: 0,
  model: 'glm-5.3',
  choices: [
    {
      index: 0,
      message: { role: 'assistant', content: 'ok' },
      finish_reason: 'stop'
    }
  ],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
};

// A real listening socket: proves the headers survive the whole SDK stack, not just a mock call.
const wireRequests: Array<{ url: string; headers: Record<string, string> }> = [];
const server = Bun.serve({
  port: 0,
  fetch: async (req) => {
    wireRequests.push({ url: req.url, headers: headersToObject(req.headers) });
    return Response.json(chatCompletion);
  }
});

afterAll(() => {
  server.stop(true);
});

describe('OpenCode Go headers on the wire', () => {
  it('should send the user agent and provider session id on the real request', async () => {
    const { LLMProvider } = await import('../LLMProvider');
    const model = await new LLMProvider().getLanguageModel({
      provider: 'opencodego',
      apiKey: 'sk-test',
      baseURL: `http://127.0.0.1:${server.port}/v1`,
      modelKey: 'glm-5.3',
      providerId: 7
    });

    const result = await generateText({ model, prompt: 'hi' });

    expect(result.text).toBe('ok');
    expect(wireRequests).toHaveLength(1);
    expect(wireRequests[0].url).toBe(`http://127.0.0.1:${server.port}/v1/chat/completions`);
    expect(wireRequests[0].headers['user-agent']).toBe(BLINKO_USER_AGENT);
    expect(wireRequests[0].headers['x-opencode-session']).toBe(opencodeSessionId('provider/7', 'sk-test'));
  });

  it('should let a conversation session id override the provider default', async () => {
    const { LLMProvider } = await import('../LLMProvider');
    const model = await new LLMProvider().getLanguageModel({
      provider: 'opencodego',
      apiKey: 'sk-test',
      baseURL: `http://127.0.0.1:${server.port}/v1`,
      modelKey: 'glm-5.3',
      providerId: 7
    });

    await generateText({
      model,
      prompt: 'hi',
      headers: opencodeGoConversationHeader(42, 'sk-test')
    });

    expect(wireRequests).toHaveLength(2);
    expect(wireRequests[1].headers['user-agent']).toBe(BLINKO_USER_AGENT);
    expect(wireRequests[1].headers['x-opencode-session']).toBe(opencodeSessionId('conversation/42', 'sk-test'));
    expect(wireRequests[1].headers['x-opencode-session']).not.toBe(opencodeSessionId('provider/7', 'sk-test'));
  });

  it('should not leak the session id to other providers', async () => {
    const { LLMProvider } = await import('../LLMProvider');
    const provider = new LLMProvider();

    for (const name of ['custom', 'minimax', 'litellm']) {
      const model = await provider.getLanguageModel({
        provider: name,
        apiKey: 'sk-test',
        baseURL: `http://127.0.0.1:${server.port}/v1`,
        modelKey: 'glm-5.3',
        providerId: 7
      });
      await generateText({ model, prompt: 'hi' });
    }

    expect(wireRequests).toHaveLength(5);
    for (const request of wireRequests.slice(2)) {
      expect(request.headers).not.toHaveProperty('x-opencode-session');
    }
  });
});

describe('OpenCode Go default gateway URL', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should target the vendor gateway when no base URL is configured', async () => {
    const recordedUrls: string[] = [];
    globalThis.fetch = (async (input) => {
      recordedUrls.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      return Response.json(chatCompletion);
    }) as typeof fetch;

    const { LLMProvider } = await import('../LLMProvider');
    const model = await new LLMProvider().getLanguageModel({
      provider: 'opencodego',
      apiKey: 'sk-test',
      modelKey: 'glm-5.3',
      providerId: 7
    });

    const result = await generateText({ model, prompt: 'hi' });

    expect(result.text).toBe('ok');
    expect(recordedUrls).toHaveLength(1);
    expect(recordedUrls[0]).toBe(`${OPENCODE_GO_BASE_URL}/chat/completions`);
  });
});

describe('OpenCode Go session ids', () => {
  it('should scope the conversation id away from the provider default', () => {
    const conversationHeaders = opencodeGoConversationHeader(42, 'sk-test');
    const defaultHeaders = opencodeGoDefaultHeaders(7, 'sk-test');

    expect(conversationHeaders['x-opencode-session']).toBe(opencodeSessionId('conversation/42', 'sk-test'));
    expect(conversationHeaders['x-opencode-session']).not.toBe(defaultHeaders['x-opencode-session']);
    expect(defaultHeaders['User-Agent']).toBe(BLINKO_USER_AGENT);
    expect(conversationHeaders).not.toHaveProperty('User-Agent');
  });

  it('should salt the session id with the api key', () => {
    expect(opencodeSessionId('conversation/42', 'sk-a')).not.toBe(opencodeSessionId('conversation/42', 'sk-b'));
    expect(opencodeSessionId('conversation/42', 'sk-a')).toBe(opencodeSessionId('conversation/42', 'sk-a'));
  });

  it('should vary the provider default with the provider id', () => {
    expect(opencodeGoDefaultHeaders(7, 'sk-test')['x-opencode-session']).not.toBe(
      opencodeGoDefaultHeaders(8, 'sk-test')['x-opencode-session']
    );
    expect(opencodeGoDefaultHeaders(7, 'sk-test')).toEqual(opencodeGoDefaultHeaders(7, 'sk-test'));
    expect(opencodeGoDefaultHeaders()['x-opencode-session']).toBe(opencodeSessionId('provider/default', ''));
  });
});
