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
import type { AiLocale, AiMessage, AiToolCall, AiToolCard } from './types';

const MAX_HISTORY = 10;
const MAX_TOOL_ITERATIONS = 3;
const MAX_TOOL_CALLS = 6;

const chatSchema = z.object({
  message: z.string().min(1).max(2000),
  locale: z.enum(['ar', 'en']).default('ar'),
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
  const messages: AiMessage[] = [
    { role: 'system', content: systemPrompt(parsed.locale) },
    ...(parsed.history ?? []).map((message) => ({ role: message.role, content: message.content }) as AiMessage),
    { role: 'user', content: parsed.message },
  ];
  const cards: AiToolCard[] = [];
  const toolAudit: Array<{ name: string; status: 'success' | 'error'; error?: string }> = [];
  let completionText = '';
  let model = provider.model;
  let callsUsed = 0;

  try {
    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
      const completion = await provider.complete({ messages, tools });
      model = completion.model;
      completionText = completion.content;

      if (completion.toolCalls.length === 0) {
        break;
      }

      const remaining = MAX_TOOL_CALLS - callsUsed;
      const toolCalls = completion.toolCalls.slice(0, remaining);
      callsUsed += toolCalls.length;
      messages.push({ role: 'assistant', content: completion.content, toolCalls });

      for (const call of toolCalls) {
        let toolContent: string;
        try {
          const result = await withOrg(c, (tx) => executeAiTool(call.name, call.arguments, {
            db: tx,
            orgId: auth.orgId,
            userId: auth.userId,
            role: auth.role,
            locale: parsed.locale,
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
        completionText = summarizeCards(cards, parsed.locale);
        break;
      }
    }

    if (!completionText.trim()) {
      completionText = summarizeCards(cards, parsed.locale);
    }

    await writeAiLog({
      c,
      orgId: auth.orgId,
      userId: auth.userId,
      role: auth.role,
      provider: provider.name,
      model,
      prompt: parsed.message,
      response: completionText,
      toolCalls: toolAudit,
      status: 'success',
    });

    return c.json({
      data: {
        message: {
          role: 'assistant',
          content: completionText,
          cards,
        },
        provider: provider.name,
        model,
      },
      error: null,
      meta: { tools: toolAudit },
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
        model,
        prompt: parsed.message,
        toolCalls: toolAudit,
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
