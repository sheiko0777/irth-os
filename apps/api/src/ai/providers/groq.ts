import { envVar } from '../../utils/env';
import type { AiCompletion, AiMessage, AiProvider, AiTextDelta, AiToolDefinition } from '../types';

type GroqToolCall = {
  id?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
};

type GroqChoice = {
  message?: {
    content?: string | null;
    tool_calls?: GroqToolCall[];
  };
};

type GroqStreamChoice = {
  delta?: {
    content?: string | null;
  };
};

function parseToolArguments(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function toGroqMessage(message: AiMessage) {
  if (message.role === 'tool') {
    return {
      role: 'tool',
      tool_call_id: message.toolCallId,
      name: message.name,
      content: message.content,
    };
  }

  return {
    role: message.role,
    content: message.content,
    ...(message.toolCalls?.length
      ? {
          tool_calls: message.toolCalls.map((call) => ({
            id: call.id,
            type: 'function',
            function: {
              name: call.name,
              arguments: JSON.stringify(call.arguments),
            },
          })),
        }
      : {}),
  };
}

async function postGroq(input: {
  apiKey: string;
  model: string;
  messages: AiMessage[];
  tools?: AiToolDefinition[];
  stream?: boolean;
}) {
  const tools = input.tools ?? [];
  const body: Record<string, unknown> = {
    model: input.model,
    messages: input.messages.map(toGroqMessage),
    temperature: 0.2,
    stream: input.stream ?? false,
    tool_choice: tools.length > 0 ? 'auto' : 'none',
  };

  if (tools.length > 0) {
    body.tools = tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${input.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Groq request failed with ${res.status}: ${detail.slice(0, 400)}`);
  }

  return res;
}

async function* readGroqStream(res: Response, fallbackModel: string): AsyncIterable<AiTextDelta> {
  if (!res.body) {
    throw new Error('Groq stream response had no body');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split('\n\n');
    buffer = events.pop() ?? '';

    for (const event of events) {
      const lines = event
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('data:'));

      for (const line of lines) {
        const data = line.slice('data:'.length).trim();
        if (!data || data === '[DONE]') continue;

        const payload = JSON.parse(data) as { choices?: GroqStreamChoice[]; model?: string };
        const content = payload.choices?.[0]?.delta?.content;
        if (content) {
          yield { content, model: payload.model ?? fallbackModel };
        }
      }
    }
  }

  const tail = decoder.decode();
  if (tail) buffer += tail;
}

export function createGroqProvider(): AiProvider {
  const apiKey = envVar('GROQ_API_KEY');
  const model = envVar('GROQ_MODEL') ?? 'openai/gpt-oss-120b';

  return {
    name: 'groq',
    model,
    async complete({ messages, tools }: { messages: AiMessage[]; tools: AiToolDefinition[] }): Promise<AiCompletion> {
      if (!apiKey) {
        throw new Error('GROQ_API_KEY is not configured');
      }

      const res = await postGroq({ apiKey, model, messages, tools });

      const payload = await res.json() as { choices?: GroqChoice[]; model?: string; usage?: unknown };
      const message = payload.choices?.[0]?.message;
      const toolCalls = (message?.tool_calls ?? [])
        .map((call, index) => ({
          id: call.id ?? `tool-${index}`,
          name: call.function?.name ?? '',
          arguments: parseToolArguments(call.function?.arguments),
        }))
        .filter((call) => call.name.length > 0);

      return {
        content: message?.content ?? '',
        toolCalls,
        model: payload.model ?? model,
        usage: payload.usage,
      };
    },
    async *streamText({ messages }: { messages: AiMessage[] }): AsyncIterable<AiTextDelta> {
      if (!apiKey) {
        throw new Error('GROQ_API_KEY is not configured');
      }

      const res = await postGroq({ apiKey, model, messages, stream: true });
      yield* readGroqStream(res, model);
    },
  };
}
