import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import { aiConversationLogs, jsonSafe, type Role } from '@irth/db';
import { getDb, withOrg } from '../db';
import { rateLimit } from '../middlewares/rateLimit';
import { envVar } from '../utils/env';
import { handleError } from '../utils/errors';
import { createGroqProvider } from './providers/groq';
import { allowedAiToolDefinitions, executeAiTool } from './tools';
import type { AiLocale, AiMessage, AiProvider, AiToolCard, AiToolDefinition } from './types';

const MAX_HISTORY = 10;
const MAX_TOOL_ITERATIONS = 3;
const MAX_TOOL_CALLS = 6;

const chatSchema = z.object({
  message: z.string().min(1).max(2000),
  locale: z.enum(['ar', 'en']).default('ar'),
  stream: z.boolean().optional(),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().min(1).max(2000),
  })).max(MAX_HISTORY).optional(),
}).strict();

export const aiChatRouter = new Hono();

const trustedProxyCount = () => parseInt(envVar('TRUSTED_PROXY_COUNT') || '0', 10);
aiChatRouter.use('/chat', rateLimit(20, 60_000, trustedProxyCount));

function getAuth(c: Context): { orgId: string; userId: string; role: Role } | null {
  const orgId = c.get('orgId') as string | undefined;
  const userId = c.get('userId') as string | undefined;
  const role = c.get('role') as Role | undefined;
  if (!orgId || !userId || !role) return null;
  return { orgId, userId, role };
}

function systemPrompt(locale: AiLocale): string {
  const language = locale === 'ar' ? 'Arabic' : 'English';
  return [
    `You are IRTH Intelligence, a careful read-only ERP assistant. Answer in ${language}.`,
    'Use tools only when business data is needed. Never invent operational facts.',
    'You may read orders, products, inventory, and sales summaries only through the provided tools.',
    'Never ask for, accept, or use orgId/userId from the user or tool arguments; the server supplies tenant scope.',
    'Do not propose write actions as completed. If action is needed, phrase it as a recommendation for an authorized operator.',
    'Keep answers concise and suitable for an admin dashboard.',
  ].join('\n');
}

async function writeAiLog(input: {
  c: Context;
  orgId: string;
  userId: string;
  role: Role;
  provider: string;
  model: string;
  prompt: string;
  response?: string;
  toolCalls: unknown[];
  status: 'success' | 'error';
  error?: string;
}) {
  await withOrg(input.c, async (tx) => {
    await tx.insert(aiConversationLogs).values({
      orgId: input.orgId,
      userId: input.userId,
      role: input.role,
      provider: input.provider,
      model: input.model,
      prompt: input.prompt,
      response: input.response ?? null,
      toolCalls: jsonSafe(input.toolCalls),
      status: input.status,
      error: input.error ?? null,
    });
  });
}

function summarizeCards(cards: AiToolCard[], locale: AiLocale): string {
  if (cards.length === 0) {
    return locale === 'ar'
      ? 'تم استلام السؤال، لكن لم أحتج إلى قراءة بيانات تشغيلية.'
      : 'I received the question and did not need to read operational data.';
  }
  return locale === 'ar'
    ? 'راجعت البيانات المتاحة وأرفقت النتائج في البطاقات.'
    : 'I reviewed the available data and attached the results as cards.';
}

type ToolAudit = Array<{ name: string; status: 'success' | 'error'; error?: string }>;

type PlanningResult = {
  messages: AiMessage[];
  cards: AiToolCard[];
  toolAudit: ToolAudit;
  model: string;
  fallbackText: string;
  canStreamFinal: boolean;
};

function buildMessages(input: z.infer<typeof chatSchema>): AiMessage[] {
  return [
    { role: 'system', content: systemPrompt(input.locale) },
    ...(input.history ?? []).map((message) => ({ role: message.role, content: message.content }) as AiMessage),
    { role: 'user', content: input.message },
  ];
}

async function runToolPlanning(input: {
  c: Context;
  auth: { orgId: string; userId: string; role: Role };
  parsed: z.infer<typeof chatSchema>;
  provider: AiProvider;
  tools: AiToolDefinition[];
}): Promise<PlanningResult> {
  const messages = buildMessages(input.parsed);
  const cards: AiToolCard[] = [];
  const toolAudit: ToolAudit = [];
  let fallbackText = '';
  let model = input.provider.model;
  let callsUsed = 0;
  let canStreamFinal = true;

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    const completion = await input.provider.complete({ messages, tools: input.tools });
    model = completion.model;
    fallbackText = completion.content;

    if (completion.toolCalls.length === 0) {
      return { messages, cards, toolAudit, model, fallbackText, canStreamFinal };
    }

    const remaining = MAX_TOOL_CALLS - callsUsed;
    const toolCalls = completion.toolCalls.slice(0, remaining);
    callsUsed += toolCalls.length;
    messages.push({ role: 'assistant', content: completion.content, toolCalls });

    for (const call of toolCalls) {
      let toolContent: string;
      try {
        const result = await withOrg(input.c, (tx) => executeAiTool(call.name, call.arguments, {
          db: tx,
          orgId: input.auth.orgId,
          userId: input.auth.userId,
          role: input.auth.role,
          locale: input.parsed.locale,
        }));
        cards.push(...result.cards);
        toolAudit.push({ name: call.name, status: 'success' });
        toolContent = JSON.stringify(jsonSafe({ ok: true, summary: result.summary, data: result.data }));
      } catch (err) {
        const error = handleError(err);
        toolAudit.push({ name: call.name, status: 'error', error });
        toolContent = JSON.stringify({ ok: false, error });
      }

      messages.push({
        role: 'tool',
        toolCallId: call.id,
        name: call.name,
        content: toolContent,
      });
    }

    if (callsUsed >= MAX_TOOL_CALLS) {
      fallbackText = summarizeCards(cards, input.parsed.locale);
      canStreamFinal = false;
      break;
    }
  }

  if (!fallbackText.trim()) {
    fallbackText = summarizeCards(cards, input.parsed.locale);
  }

  return { messages, cards, toolAudit, model, fallbackText, canStreamFinal };
}

function sse(event: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function streamChat(input: {
  c: Context;
  auth: { orgId: string; userId: string; role: Role };
  parsed: z.infer<typeof chatSchema>;
  provider: AiProvider;
  tools: AiToolDefinition[];
}): Response {
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const toolAudit: ToolAudit = [];
      let cards: AiToolCard[] = [];
      let model = input.provider.model;
      let responseText = '';

      try {
        controller.enqueue(sse('ready', { provider: input.provider.name, model }));
        const plan = await runToolPlanning(input);
        toolAudit.push(...plan.toolAudit);
        cards = plan.cards;
        model = plan.model;

        if (plan.canStreamFinal) {
          for await (const delta of input.provider.streamText({ messages: plan.messages })) {
            model = delta.model;
            responseText += delta.content;
            controller.enqueue(sse('delta', { content: delta.content }));
          }
        }

        if (!responseText.trim()) {
          responseText = plan.fallbackText.trim() || summarizeCards(cards, input.parsed.locale);
          controller.enqueue(sse('delta', { content: responseText }));
        }

        controller.enqueue(sse('cards', { cards }));
        await writeAiLog({
          c: input.c,
          orgId: input.auth.orgId,
          userId: input.auth.userId,
          role: input.auth.role,
          provider: input.provider.name,
          model,
          prompt: input.parsed.message,
          response: responseText,
          toolCalls: toolAudit,
          status: 'success',
        });
        controller.enqueue(sse('done', { provider: input.provider.name, model, tools: toolAudit }));
        controller.close();
      } catch (err) {
        const error = handleError(err);
        try {
          await writeAiLog({
            c: input.c,
            orgId: input.auth.orgId,
            userId: input.auth.userId,
            role: input.auth.role,
            provider: input.provider.name,
            model,
            prompt: input.parsed.message,
            response: responseText || undefined,
            toolCalls: toolAudit,
            status: 'error',
            error,
          });
        } catch {
          // Keep the streamed failure about the AI request, not a secondary log write.
        }
        controller.enqueue(sse('error', { error }));
        controller.close();
      }
    },
  });

  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  });
}

aiChatRouter.post('/chat', async (c) => {
  const auth = getAuth(c);
  if (!auth) {
    return c.json({ data: null, error: 'Unauthorized', meta: null }, 401);
  }

  let parsed: z.infer<typeof chatSchema>;
  try {
    parsed = chatSchema.parse(await c.req.json());
  } catch (err) {
    return c.json({ data: null, error: handleError(err), meta: null }, 400);
  }

  const provider = createGroqProvider();
  const tools = allowedAiToolDefinitions(auth.role);

  if (parsed.stream) {
    return streamChat({ c, auth, parsed, provider, tools });
  }

  try {
    const plan = await runToolPlanning({ c, auth, parsed, provider, tools });
    const completionText = plan.fallbackText.trim() || summarizeCards(plan.cards, parsed.locale);

    await writeAiLog({
      c,
      orgId: auth.orgId,
      userId: auth.userId,
      role: auth.role,
      provider: provider.name,
      model: plan.model,
      prompt: parsed.message,
      response: completionText,
      toolCalls: plan.toolAudit,
      status: 'success',
    });

    return c.json({
      data: {
        message: {
          role: 'assistant',
          content: completionText,
          cards: plan.cards,
        },
        provider: provider.name,
        model: plan.model,
      },
      error: null,
      meta: { tools: plan.toolAudit },
    });
  } catch (err) {
    const error = handleError(err);
    try {
      await writeAiLog({
        c,
        orgId: auth.orgId,
        userId: auth.userId,
        role: auth.role,
        provider: provider.name,
        model: provider.model,
        prompt: parsed.message,
        toolCalls: [],
        status: 'error',
        error,
      });
    } catch {
      // Keep the user-facing failure about the AI request, not a secondary log write.
    }

    const status = error.includes('GROQ_API_KEY') ? 503 : 502;
    return c.json({ data: null, error, meta: null }, status);
  }
});
