import { envVar } from '../../utils/env';
import type { AiCompletion, AiMessage, AiProvider, AiToolDefinition } from '../types';

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

      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: messages.map(toGroqMessage),
          temperature: 0.2,
          tools: tools.map((tool) => ({
            type: 'function',
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
            },
          })),
          tool_choice: tools.length > 0 ? 'auto' : 'none',
        }),
      });

      if (!res.ok) {
        const detail = await res.text();
        throw new Error(`Groq request failed with ${res.status}: ${detail.slice(0, 400)}`);
      }

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
  };
}
