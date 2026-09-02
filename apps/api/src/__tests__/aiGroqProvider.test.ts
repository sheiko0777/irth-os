import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGroqProvider } from '../ai/providers/groq';

function streamBody(text: string) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

describe('Groq AI provider streaming', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.GROQ_API_KEY;
    delete process.env.GROQ_MODEL;
  });

  it('yields text deltas from OpenAI-compatible SSE chunks', async () => {
    process.env.GROQ_API_KEY = 'test-key';
    process.env.GROQ_MODEL = 'test-model';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(streamBody([
      'data: {"model":"test-model","choices":[{"delta":{"content":"Hello"}}]}',
      '',
      'data: {"model":"test-model","choices":[{"delta":{"content":" world"}}]}',
      '',
      'data: [DONE]',
      '',
    ].join('\n')))));

    const provider = createGroqProvider();
    const deltas: string[] = [];

    for await (const delta of provider.streamText({ messages: [{ role: 'user', content: 'Hi' }] })) {
      deltas.push(delta.content);
    }

    expect(deltas).toEqual(['Hello', ' world']);
    expect(fetch).toHaveBeenCalledWith(
      'https://api.groq.com/openai/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"stream":true'),
      }),
    );
  });
});
