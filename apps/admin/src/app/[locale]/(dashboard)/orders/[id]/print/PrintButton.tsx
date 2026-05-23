'use client';

export function PrintButton() {
    return (
        <button
            onClick={() => window.print()}
            style={{
                background: '#b8952a',
                color: '#fff',
                border: 'none',
                padding: '10px 32px',
                borderRadius: 6,
                fontSize: 16,
                cursor: 'pointer',
                fontFamily: 'Cairo, sans-serif',
            }}
        >
            طباعة
        </button>
    );
}
