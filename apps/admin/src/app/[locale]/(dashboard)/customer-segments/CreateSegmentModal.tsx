'use client';

import { useState } from 'react';
import { FormDialog } from '@/components/ui/FormDialog';
import { useTranslations } from 'next-intl';

const PRESET_COLORS = ['#B0885E', '#D4AF37', '#2E7D32', '#1565C0', '#6A1B9A', '#C62828', '#00695C', '#4E342E'];

type CreateSegmentModalProps = {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: { name: string; color: string; description?: string }) => void;
  isPending: boolean;
  error?: string;
  onClearError: () => void;
};

export function CreateSegmentModal({
  open,
  onClose,
  onSubmit,
  isPending,
  error,
  onClearError,
}: CreateSegmentModalProps) {
  const t = useTranslations('customerSegments');
  const [name, setName] = useState('');
  const [color, setColor] = useState('#B0885E');
  const [description, setDescription] = useState('');

  const handleClose = () => {
    onClose();
    onClearError();
    // Reset form when closing if needed, but the parent handles re-mounting or we can reset here.
    // Parent actually resets form in onSuccess of mutation, but we can reset on close too.
    setName('');
    setColor('#B0885E');
    setDescription('');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({ name, color, description: description || undefined });
  };

  return (
    <FormDialog open={open} title={t('createModal.title')} onClose={handleClose} width="440px">
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div>
          <label style={{ fontSize: '12px', color: 'var(--t2)', display: 'block', marginBottom: '5px' }}>{t('createModal.nameRequired')}</label>
          <input
            className="bg-[var(--surface)] border border-[var(--rim1)] rounded-lg px-3 py-2 text-[14px] text-[var(--t1)] w-full outline-none"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('createModal.namePlaceholder')}
            maxLength={100}
          />
        </div>
        <div>
          <label style={{ fontSize: '12px', color: 'var(--t2)', display: 'block', marginBottom: '5px' }}>{t('createModal.descriptionOptional')}</label>
          <input
            className="bg-[var(--surface)] border border-[var(--rim1)] rounded-lg px-3 py-2 text-[14px] text-[var(--t1)] w-full outline-none"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t('createModal.descriptionPlaceholder')}
            maxLength={500}
          />
        </div>
        <div>
          <label style={{ fontSize: '12px', color: 'var(--t2)', display: 'block', marginBottom: '8px' }}>{t('createModal.color')}</label>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                style={{
                  width: '28px', height: '28px', borderRadius: '50%', background: c,
                  border: color === c ? '3px solid var(--t1)' : '2px solid transparent',
                  cursor: 'pointer',
                }}
              />
            ))}
          </div>
        </div>
        {error && <div style={{ color: 'var(--crimson)', fontSize: '13px' }}>{error}</div>}
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '6px' }}>
          <button
            type="button"
            className="bg-transparent text-[var(--t2)] border border-[var(--rim1)] rounded-lg px-4 py-2 text-[13px] cursor-pointer"
            onClick={handleClose}
          >
            {t('actions.cancel')}
          </button>
          <button
            type="submit"
            className="bg-[var(--gold)] text-void border-none rounded-lg px-[18px] py-2 text-[13px] font-semibold cursor-pointer"
            disabled={isPending}
          >
            {isPending ? t('actions.saving') : t('createModal.submit')}
          </button>
        </div>
      </form>
    </FormDialog>
  );
}
