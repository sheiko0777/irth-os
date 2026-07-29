'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

export default function CreateCustomerDialog() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);

  // Create form state
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');

  const createMutation = trpc.customers.create.useMutation({
    onSuccess: () => {
      toast.success('تم إضافة العميل بنجاح');
      router.refresh();
      setIsOpen(false);
      setName('');
      setEmail('');
      setPhone('');
      setAddress('');
      setNotes('');
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : 'حدث خطأ أثناء إضافة العميل');
    },
  });

  const handleCreateSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    createMutation.mutate({
      name,
      email: email || undefined,
      phone: phone || undefined,
      address: address || undefined,
      notes: notes || undefined,
    });
  };

  const isPending = createMutation.isPending;

  return (
    <>
      <Button onClick={() => setIsOpen(true)}>إضافة عميل</Button>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setIsOpen(false)}>
          <div className="bg-[var(--surface)] border border-[var(--rim1)] rounded-lg p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-4">إضافة عميل جديد</h2>
            <form onSubmit={handleCreateSubmit} className="space-y-3">
              <div>
                <label className="block text-sm text-[var(--t2)] mb-1">الاسم *</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="w-full bg-[var(--surface)] border border-[var(--rim1)] text-[var(--t1)] rounded-md px-3 py-2 outline-none focus:border-[var(--t2)]"
                />
              </div>
              <div>
                <label className="block text-sm text-[var(--t2)] mb-1">البريد الإلكتروني</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  dir="ltr"
                  className="w-full bg-[var(--surface)] border border-[var(--rim1)] text-[var(--t1)] rounded-md px-3 py-2 outline-none focus:border-[var(--t2)]"
                />
              </div>
              <div>
                <label className="block text-sm text-[var(--t2)] mb-1">الهاتف</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  dir="ltr"
                  className="w-full bg-[var(--surface)] border border-[var(--rim1)] text-[var(--t1)] rounded-md px-3 py-2 outline-none focus:border-[var(--t2)]"
                />
              </div>
              <div>
                <label className="block text-sm text-[var(--t2)] mb-1">العنوان</label>
                <input
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="w-full bg-[var(--surface)] border border-[var(--rim1)] text-[var(--t1)] rounded-md px-3 py-2 outline-none focus:border-[var(--t2)]"
                />
              </div>
              <div>
                <label className="block text-sm text-[var(--t2)] mb-1">ملاحظات</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  className="w-full bg-[var(--surface)] border border-[var(--rim1)] text-[var(--t1)] rounded-md px-3 py-2 outline-none focus:border-[var(--t2)] resize-none"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  disabled={isPending}
                  className="flex-1 bg-[var(--t1)] text-[var(--surface)] font-bold py-2 px-4 rounded-md hover:opacity-90 disabled:opacity-50"
                >
                  {isPending ? 'جاري الحفظ...' : 'حفظ'}
                </button>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="flex-1 border border-[var(--rim1)] text-[var(--t2)] py-2 px-4 rounded-md hover:bg-[var(--rim1)]"
                >
                  إلغاء
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
