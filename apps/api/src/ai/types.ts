import type { AccessPolicy, Role } from '@irth/db';

export type AiLocale = 'ar' | 'en';

export type AiToolCard =
  | {
      type: 'orders';
      title: string;
      items: Array<{ id: string; orderNumber: string; status: string; totalAmountMinor: string; currency: string; createdAt: string | null }>;
    }
  | {
      type: 'products';
      title: string;
      items: Array<{ id: string; name: string; sku: string; status: string; priceMinor: string; currency: string; stock: number }>;
    }
  | {
      type: 'inventory';
      title: string;
      items: Array<{ id: string; productName: string; variantName: string; sku: string; quantity: number; reorderPoint: number; state: 'out' | 'low' | 'ok' }>;
    }
  | {
      type: 'sales_summary';
      title: string;
      metrics: Array<{ label: string; value: string; tone?: 'neutral' | 'good' | 'warning' }>;
    };

export type AiToolResult = {
  summary: string;
  cards: AiToolCard[];
  data: unknown;
};

export type AiToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type AiMessage =
  | { role: 'system' | 'user' | 'assistant'; content: string; toolCalls?: AiToolCall[] }
  | { role: 'tool'; content: string; toolCallId: string; name: string };

export type AiCompletion = {
  content: string;
  toolCalls: AiToolCall[];
  model: string;
  usage?: unknown;
};

export type AiTextDelta = {
  content: string;
  model: string;
};

export type AiToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type AiProvider = {
  name: string;
  model: string;
  complete(input: { messages: AiMessage[]; tools: AiToolDefinition[] }): Promise<AiCompletion>;
  streamText(input: { messages: AiMessage[] }): AsyncIterable<AiTextDelta>;
};

export type AiRequestContext = {
  orgId: string;
  userId: string;
  role: Role;
  accessPolicy: AccessPolicy | null;
  permissionOverrides: AccessPolicy | null;
  assignedWarehouseIds: string[];
  locale: AiLocale;
};
