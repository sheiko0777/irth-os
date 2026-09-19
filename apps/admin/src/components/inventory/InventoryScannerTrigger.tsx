'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { WarehouseScannerModal } from './WarehouseScannerModal';
import { Camera } from 'lucide-react';
import { useRouter } from 'next/navigation';

export function InventoryScannerTrigger() {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        style={{ background: 'var(--gold)', color: 'var(--void)' }}
        className="flex items-center gap-2 font-bold shadow-md hover:brightness-105 transition"
      >
        <Camera className="w-4 h-4" />
        <span>ماسح الكاميرا والباركود</span>
      </Button>

      <WarehouseScannerModal
        open={open}
        onOpenChange={setOpen}
        onSuccess={() => router.refresh()}
      />
    </>
  );
}
