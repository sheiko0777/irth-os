'use client';

import { useTranslations } from 'next-intl';

export function PrintButton() {
    const t = useTranslations('orders');

    return (
        <button
            onClick={() => window.print()}
            style={{
                background: 'var(--gold)',
                color: 'var(--void)',
                border: 'none',
                padding: '10px 32px',
                borderRadius: 6,
                fontSize: 16,
                cursor: 'pointer',
                fontFamily: 'Cairo, sans-serif',
            }}
        >
            {t('actions.print')}
        </button>
    );
}
