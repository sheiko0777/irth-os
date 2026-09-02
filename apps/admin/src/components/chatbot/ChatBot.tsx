'use client';
import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { matchIntent } from '@/lib/chatIntents';
import { routeLabel } from '@/lib/routeLabels';

type Message = {
  id: number;
  role: 'user' | 'bot';
  text: string;
  links?: { label: string; href: string }[];
  results?: { label: string; sub: string; href: string }[];
};

const QUICK_ACTIONS = [
  { label: 'الطلبات', icon: 'O', href: '/orders', keyword: 'orders' },
  { label: 'المنتجات', icon: 'P', href: '/products', keyword: 'products' },
  { label: 'العملاء', icon: 'C', href: '/customers', keyword: 'customers' },
  { label: 'المخزون', icon: 'I', href: '/inventory', keyword: 'inventory' },
  { label: 'التقارير', icon: 'R', href: '/analytics', keyword: 'analytics' },
];

const HELP_TEXT = `الأوامر المتاحة:
• "طلبات" أو "orders" — الانتقال للطلبات
• "منتجات" أو "products" — الانتقال للمنتجات
• "عملاء" أو "customers" — الانتقال للعملاء
• "مخزون" أو "inventory" — الانتقال للمخزون
• "ابحث عن [كلمة]" — البحث في النظام
• "مساعدة" — عرض هذه القائمة`;

interface ChatBotProps {
  locale: string;
}

export function ChatBot({ locale }: ChatBotProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 0, role: 'bot',
      text: 'مرحباً! أنا مساعد IRTH. كيف أقدر أساعدك؟ اكتب "مساعدة" لعرض الأوامر أو استخدم الأزرار السريعة.',
    },
  ]);
  const [msgId, setMsgId] = useState(1);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, open]);

  const addMsg = (msg: Omit<Message, 'id'>) => {
    setMessages(prev => [...prev, { ...msg, id: msgId }]);
    setMsgId(n => n + 1);
  };

  const handleSend = () => {
    const text = input.trim();
    if (!text) return;
    addMsg({ role: 'user', text });
    setInput('');

    const intent = matchIntent(text);

    if (intent.type === 'help') {
      addMsg({ role: 'bot', text: HELP_TEXT });
      return;
    }

    if (intent.type === 'nav') {
      const label = routeLabel(intent.query);
      addMsg({
        role: 'bot',
        text: 'يمكنك الانتقال إلى ' + label,
        links: [{ label: 'انتقل إلى ' + label, href: '/' + locale + '/' + intent.query }],
      });
      return;
    }

    if (intent.type === 'search') {
      if (!intent.query) {
        addMsg({ role: 'bot', text: 'ما الذي تريد البحث عنه؟ مثال: "ابحث عن منتج تمر"' });
        return;
      }
      addMsg({
        role: 'bot',
        text: 'نتائج البحث عن: ' + intent.query,
        links: [
          { label: 'بحث في الطلبات', href: '/' + locale + '/orders?search=' + encodeURIComponent(intent.query) },
          { label: 'بحث في المنتجات', href: '/' + locale + '/products?search=' + encodeURIComponent(intent.query) },
          { label: 'بحث في العملاء', href: '/' + locale + '/customers?search=' + encodeURIComponent(intent.query) },
        ],
      });
      return;
    }

    addMsg({
      role: 'bot',
      text: 'لم أفهم. اكتب "مساعدة" لعرض الأوامر المتاحة.',
    });
  };

  const handleQuickAction = (href: string) => {
    router.push('/' + locale + href);
    setOpen(false);
  };

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          position: 'fixed',
          bottom: 'calc(24px + env(safe-area-inset-bottom))',
          insetInlineEnd: '24px',
          width: '52px',
          height: '52px',
          borderRadius: '50%',
          background: 'var(--gold)',
          color: 'var(--void)',
          border: 'none',
          cursor: 'pointer',
          fontSize: '22px',
          zIndex: 1000,
          boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        aria-label="المساعد الذكي"
      >
        {open ? '✕' : '💬'}
      </button>

      {/* Chat panel */}
      {open && (
        <div
          style={{
            position: 'fixed',
            bottom: '88px',
            insetInlineEnd: '24px',
            width: '340px',
            maxHeight: '520px',
            background: 'var(--surface)',
            border: '1px solid var(--rim1)',
            borderRadius: '16px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
            display: 'flex',
            flexDirection: 'column',
            zIndex: 1000,
            overflow: 'hidden',
          }}
        >
          {/* Header */}
          <div style={{ padding: '12px 16px', background: 'var(--gold)', color: 'var(--void)' }}>
            <p style={{ margin: 0, fontWeight: 700, fontSize: '15px', fontFamily: 'Cairo, sans-serif' }}>
              مساعد IRTH
            </p>
            <p style={{ margin: 0, fontSize: '12px', opacity: 0.85 }}>بحث ومساعدة داخل النظام</p>
          </div>

          {/* Quick actions */}
          <div style={{ display: 'flex', gap: '6px', padding: '10px 12px', borderBottom: '1px solid var(--rim1)', flexWrap: 'wrap' }}>
            {QUICK_ACTIONS.map(a => (
              <button
                key={a.keyword}
                onClick={() => handleQuickAction(a.href)}
                style={{
                  padding: '4px 10px',
                  borderRadius: '99px',
                  border: '1px solid var(--rim1)',
                  background: 'transparent',
                  color: 'var(--t1)',
                  fontSize: '12px',
                  cursor: 'pointer',
                  fontFamily: 'Cairo, sans-serif',
                }}
              >
                {a.label}
              </button>
            ))}
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {messages.map(msg => (
              <div key={msg.id} style={{ display: 'flex', flexDirection: 'column', alignItems: msg.role === 'user' ? 'flex-start' : 'flex-end' }}>
                <div
                  style={{
                    maxWidth: '85%',
                    padding: '8px 12px',
                    borderRadius: msg.role === 'user' ? '12px 12px 12px 2px' : '12px 12px 2px 12px',
                    background: msg.role === 'user' ? 'color-mix(in srgb, var(--gold) 15%, transparent)' : 'var(--rim1)',
                    color: 'var(--t1)',
                    fontSize: '13px',
                    lineHeight: '1.6',
                    fontFamily: 'Cairo, sans-serif',
                    whiteSpace: 'pre-line',
                  }}
                >
                  {msg.text}
                </div>
                {msg.links && msg.links.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '6px', maxWidth: '85%' }}>
                    {msg.links.map((link, i) => (
                      <button
                        key={i}
                        onClick={() => { router.push(link.href); setOpen(false); }}
                        style={{
                          padding: '6px 12px',
                          borderRadius: '8px',
                          border: '1px solid var(--gold)',
                          background: 'transparent',
                          color: 'var(--gold)',
                          fontSize: '12px',
                          cursor: 'pointer',
                          fontFamily: 'Cairo, sans-serif',
                          textAlign: 'start',
                        }}
                      >
                        {link.label} ←
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div style={{ padding: '10px 12px', borderTop: '1px solid var(--rim1)', display: 'flex', gap: '8px' }}>
            <input
              value={input}
              onChange={(e: { target: { value: string } }) => setInput(e.target.value)}
              onKeyDown={(e: { key: string; preventDefault: () => void }) => { if (e.key === 'Enter') { e.preventDefault(); handleSend(); } }}
              placeholder="اكتب سؤالك..."
              style={{
                flex: 1,
                padding: '8px 12px',
                borderRadius: '8px',
                border: '1px solid var(--rim1)',
                background: 'transparent',
                color: 'var(--t1)',
                fontSize: '13px',
                fontFamily: 'Cairo, sans-serif',
                outline: 'none',
                direction: 'rtl',
              }}
            />
            <button
              onClick={handleSend}
              style={{
                padding: '8px 14px',
                borderRadius: '8px',
                background: 'var(--gold)',
                color: 'var(--void)',
                border: 'none',
                cursor: 'pointer',
                fontSize: '14px',
                fontFamily: 'Cairo, sans-serif',
              }}
            >
              ارسال
            </button>
          </div>
        </div>
      )}
    </>
  );
}