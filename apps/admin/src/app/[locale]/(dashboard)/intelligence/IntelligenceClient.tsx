'use client';

import { FormEvent, useMemo, useState } from 'react';
import { BrainCircuit, PackageSearch, Send, ShoppingCart, Sparkles, Warehouse } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type Locale = 'ar' | 'en';

type Card =
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

type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  cards?: Card[];
};

export type IntelligenceCopy = {
  title: string;
  subtitle: string;
  placeholder: string;
  send: string;
  thinking: string;
  error: string;
  emptyTitle: string;
  emptyHint: string;
  examples: string[];
  labels: {
    sku: string;
    status: string;
    total: string;
    quantity: string;
    reorderPoint: string;
    state: string;
    out: string;
    low: string;
    ok: string;
  };
};

type ApiResponse = {
  data?: {
    message?: {
      content: string;
      cards: Card[];
    };
  } | null;
  error?: string | null;
};

function formatMinor(minor: string, currency: string, locale: Locale) {
  const amount = Number(minor) / 100;
  return new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}

function stateLabel(state: 'out' | 'low' | 'ok', labels: IntelligenceCopy['labels']) {
  return labels[state];
}

function ResultCard({ card, locale, labels }: { card: Card; locale: Locale; labels: IntelligenceCopy['labels'] }) {
  if (card.type === 'sales_summary') {
    return (
      <div className="rounded-md border border-[var(--rim1)] bg-[var(--card-bg)] p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--t1)]">
          <Sparkles size={15} className="text-[var(--gold)]" />
          {card.title}
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {card.metrics.map((metric) => (
            <div key={metric.label} className="rounded-md border border-[var(--rim1)] bg-[var(--surface)] p-3">
              <p className="text-xs text-[var(--t3)]">{metric.label}</p>
              <p
                className={cn(
                  'mt-1 text-lg font-semibold tabular-nums',
                  metric.tone === 'good' ? 'text-[var(--emerald)]' : metric.tone === 'warning' ? 'text-[var(--amber)]' : 'text-[var(--t1)]',
                )}
                dir="ltr"
              >
                {metric.value}
              </p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const icon = card.type === 'orders' ? ShoppingCart : card.type === 'products' ? PackageSearch : Warehouse;
  const Icon = icon;

  return (
    <div className="rounded-md border border-[var(--rim1)] bg-[var(--card-bg)]">
      <div className="flex items-center gap-2 border-b border-[var(--rim1)] px-4 py-3 text-sm font-semibold text-[var(--t1)]">
        <Icon size={15} className="text-[var(--gold)]" />
        {card.title}
      </div>
      <div className="divide-y divide-[var(--rim1)]">
        {card.type === 'orders' && card.items.map((item) => (
          <div key={item.id} className="grid gap-2 px-4 py-3 sm:grid-cols-[1fr_auto]">
            <div>
              <p className="font-mono text-xs font-semibold text-[var(--gold)]">{item.orderNumber}</p>
              <p className="text-xs text-[var(--t3)]">{labels.status}: {item.status}</p>
            </div>
            <p className="text-sm font-semibold text-[var(--t1)] tabular-nums" dir="ltr">
              {formatMinor(item.totalAmountMinor, item.currency, locale)}
            </p>
          </div>
        ))}
        {card.type === 'products' && card.items.map((item) => (
          <div key={item.id} className="grid gap-2 px-4 py-3 sm:grid-cols-[1fr_auto]">
            <div>
              <p className="text-sm font-semibold text-[var(--t1)]">{item.name}</p>
              <p className="text-xs text-[var(--t3)]">{labels.sku}: {item.sku} · {labels.status}: {item.status}</p>
            </div>
            <div className="text-sm text-[var(--t2)] sm:text-end">
              <p className="font-semibold text-[var(--t1)] tabular-nums" dir="ltr">{formatMinor(item.priceMinor, item.currency, locale)}</p>
              <p className="text-xs">{labels.quantity}: {item.stock}</p>
            </div>
          </div>
        ))}
        {card.type === 'inventory' && card.items.map((item) => (
          <div key={item.id} className="grid gap-2 px-4 py-3 sm:grid-cols-[1fr_auto]">
            <div>
              <p className="text-sm font-semibold text-[var(--t1)]">{item.productName}</p>
              <p className="text-xs text-[var(--t3)]">{item.variantName} · {labels.sku}: {item.sku}</p>
            </div>
            <div className="text-sm text-[var(--t2)] sm:text-end">
              <p className="font-semibold text-[var(--t1)] tabular-nums" dir="ltr">{labels.quantity}: {item.quantity}</p>
              <p className="text-xs">{labels.reorderPoint}: {item.reorderPoint} · {labels.state}: {stateLabel(item.state, labels)}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function IntelligenceClient({ locale, copy }: { locale: Locale; copy: IntelligenceCopy }) {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const apiUrl = useMemo(() => process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001', []);

  async function ask(message: string) {
    const trimmed = message.trim();
    if (!trimmed || loading) return;

    const userMessage: Message = { id: crypto.randomUUID(), role: 'user', content: trimmed };
    const history = [...messages, userMessage]
      .slice(-8)
      .map((item) => ({ role: item.role, content: item.content }));

    setMessages((current) => [...current, userMessage]);
    setInput('');
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${apiUrl}/api/ai/chat`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: trimmed, locale, history }),
      });
      const body = await res.json() as ApiResponse;
      if (!res.ok || body.error || !body.data?.message) {
        throw new Error(body.error ?? copy.error);
      }

      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: body.data!.message!.content,
          cards: body.data!.message!.cards,
        },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.error);
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    await ask(input);
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-md border border-[var(--gold-br)] bg-[var(--gold-bg)] px-2.5 py-1 text-xs font-semibold text-[var(--gold)]">
            <BrainCircuit size={14} />
            IRTH Intelligence
          </div>
          <h1 className="text-2xl font-bold text-[var(--t1)]">{copy.title}</h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--t3)]">{copy.subtitle}</p>
        </div>
      </div>

      <div className="grid min-h-[620px] gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <section className="flex min-h-0 flex-col rounded-md border border-[var(--rim1)] bg-[var(--surface)]">
          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            {messages.length === 0 ? (
              <div className="flex h-full min-h-[360px] flex-col items-center justify-center text-center">
                <BrainCircuit size={34} className="mb-3 text-[var(--gold)]" />
                <h2 className="text-lg font-semibold text-[var(--t1)]">{copy.emptyTitle}</h2>
                <p className="mt-1 max-w-md text-sm text-[var(--t3)]">{copy.emptyHint}</p>
              </div>
            ) : (
              messages.map((message) => (
                <div key={message.id} className={cn('flex', message.role === 'user' ? 'justify-end' : 'justify-start')}>
                  <div className={cn('max-w-[88%] space-y-3', message.role === 'user' ? 'items-end' : 'items-start')}>
                    <div
                      className={cn(
                        'rounded-md px-4 py-3 text-sm leading-7',
                        message.role === 'user'
                          ? 'bg-[var(--gold)] text-[var(--void)]'
                          : 'border border-[var(--rim1)] bg-[var(--card-bg)] text-[var(--t1)]',
                      )}
                    >
                      {message.content}
                    </div>
                    {message.cards?.map((card, index) => (
                      <ResultCard key={`${message.id}-${card.type}-${index}`} card={card} locale={locale} labels={copy.labels} />
                    ))}
                  </div>
                </div>
              ))
            )}
            {loading && (
              <div className="inline-flex items-center gap-2 rounded-md border border-[var(--rim1)] bg-[var(--card-bg)] px-4 py-3 text-sm text-[var(--t2)]">
                <Sparkles size={14} className="text-[var(--gold)]" />
                {copy.thinking}
              </div>
            )}
          </div>

          {error && (
            <div className="mx-4 mb-3 rounded-md border border-[var(--crimson)]/30 bg-[var(--crimson)]/10 px-3 py-2 text-sm text-[var(--crimson)]">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex gap-2 border-t border-[var(--rim1)] p-3">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={copy.placeholder}
              className="min-h-12 flex-1 resize-none rounded-md border border-[var(--rim2)] bg-[var(--ink)] px-3 py-2 text-sm text-[var(--t1)] outline-none transition-colors placeholder:text-[var(--t3)] focus:border-[var(--gold)]"
              rows={2}
            />
            <Button type="submit" disabled={loading || !input.trim()} className="h-auto gap-2 bg-[var(--gold)] text-[var(--void)] hover:bg-[var(--gold2)]">
              <Send size={15} />
              <span className="hidden sm:inline">{copy.send}</span>
            </Button>
          </form>
        </section>

        <aside className="rounded-md border border-[var(--rim1)] bg-[var(--surface)] p-4">
          <h2 className="text-sm font-semibold text-[var(--t1)]">IRTH Intelligence</h2>
          <div className="mt-3 space-y-2">
            {copy.examples.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => ask(example)}
                className="w-full rounded-md border border-[var(--rim1)] bg-[var(--card-bg)] px-3 py-2 text-start text-sm text-[var(--t2)] transition-colors hover:border-[var(--gold-br)] hover:text-[var(--t1)]"
              >
                {example}
              </button>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
