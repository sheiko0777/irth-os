import { describe, it, expect } from 'vitest';
import { matchIntent } from '@/lib/chatIntents';

describe('chatIntents — matchIntent', () => {
  it('matches help in Arabic and English', () => {
    expect(matchIntent('مساعدة').type).toBe('help');
    expect(matchIntent('help').type).toBe('help');
  });

  it('routes Arabic keywords to nav intents', () => {
    expect(matchIntent('عرض الطلبات')).toEqual({ type: 'nav', query: 'orders' });
    expect(matchIntent('المنتجات')).toEqual({ type: 'nav', query: 'products' });
    expect(matchIntent('جرد')).toEqual({ type: 'nav', query: 'stocktaking' });
    expect(matchIntent('تسوية')).toEqual({ type: 'nav', query: 'courier' });
  });

  it('routes English keywords to nav intents', () => {
    expect(matchIntent('show orders')).toEqual({ type: 'nav', query: 'orders' });
    expect(matchIntent('inventory please')).toEqual({ type: 'nav', query: 'inventory' });
    expect(matchIntent('notifications')).toEqual({ type: 'nav', query: 'notifications' });
  });

  it('first matching rule wins (orders before products)', () => {
    expect(matchIntent('طلب منتج')).toEqual({ type: 'nav', query: 'orders' });
  });

  it('extracts search query and strips trigger words', () => {
    expect(matchIntent('ابحث عن تمر مجدول')).toEqual({ type: 'search', query: 'تمر مجدول' });
    expect(matchIntent('search for dates')).toEqual({ type: 'search', query: 'dates' });
  });

  it('search with no remaining query returns empty query', () => {
    expect(matchIntent('بحث')).toEqual({ type: 'search', query: '' });
  });

  it('unknown input falls through', () => {
    const r = matchIntent('كيف حالك');
    expect(r.type).toBe('unknown');
    expect(r.query).toBe('كيف حالك');
  });

  it('is case-insensitive for English', () => {
    expect(matchIntent('SHOW ORDERS')).toEqual({ type: 'nav', query: 'orders' });
  });
});
