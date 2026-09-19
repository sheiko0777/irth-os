'use client';

import { useState, useCallback } from 'react';
import { trpc } from '@/lib/trpc';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CameraScanner } from '@/components/scanner/CameraScanner';
import { useBarcodeScanner } from '@/hooks/useBarcodeScanner';
import { playBeep, triggerHaptic } from '@/lib/sound';
import { toast } from 'sonner';
import {
  ArrowDownRight,
  ArrowUpLeft,
  Search,
  Trash2,
  Plus,
  Minus,
  CheckCircle2,
  AlertTriangle,
  Package,
  Layers,
  Camera,
  ChevronDown,
  ChevronUp,
  MapPin,
  Edit2,
  Check,
  X,
  Boxes,
  Zap,
} from 'lucide-react';

type Mode = 'in' | 'out' | 'lookup';

interface ScannedEntry {
  inventoryItemId: string;
  variantId: string | null;
  productId: string;
  productName: string;
  productNameAr?: string | null;
  variantName: string;
  sku: string;
  currentStock: number;
  reorderPoint: number;
  scannedQty: number;
  binLocation?: string | null;
}

interface WarehouseScannerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function WarehouseScannerModal({
  open,
  onOpenChange,
  onSuccess,
}: WarehouseScannerModalProps) {
  const [mode, setMode] = useState<Mode>('in');
  const [scannedItems, setScannedItems] = useState<Map<string, ScannedEntry>>(new Map());
  const [lastScannedItem, setLastScannedItem] = useState<ScannedEntry | null>(null);
  const [manualCode, setManualCode] = useState('');
  const [isCameraCollapsed, setIsCameraCollapsed] = useState(false);
  const [multiplier, setMultiplier] = useState<number>(1);
  const [editingBinLocationVariantId, setEditingBinLocationVariantId] = useState<string | null>(null);
  const [tempBinLocation, setTempBinLocation] = useState<string>('');

  const utils = trpc.useUtils();

  const updateBinLocationMutation = trpc.inventory.updateBinLocation.useMutation({
    onSuccess: (_, vars) => {
      toast.success(`تم تحديث موقع الرف: ${vars.binLocation}`);
      setScannedItems((prev) => {
        const next = new Map(prev);
        for (const [key, entry] of next.entries()) {
          if (entry.variantId === vars.variantId) {
            next.set(key, { ...entry, binLocation: vars.binLocation });
          }
        }
        return next;
      });
      if (lastScannedItem && lastScannedItem.variantId === vars.variantId) {
        setLastScannedItem({ ...lastScannedItem, binLocation: vars.binLocation });
      }
      setEditingBinLocationVariantId(null);
    },
    onError: (err) => {
      toast.error(err.message || 'تعذر تحديث موقع الرف');
    },
  });

  const batchAdjustMutation = trpc.inventory.batchAdjust.useMutation({
    onSuccess: (res) => {
      playBeep('success');
      toast.success(
        mode === 'in'
          ? `تم استلام وإضافة ${res.data.count} أصناف للمخزن بنجاح!`
          : `تم صرف وتحديث ${res.data.count} أصناف من المخزن بنجاح!`
      );
      setScannedItems(new Map());
      setLastScannedItem(null);
      utils.inventory.list.invalidate();
      if (onSuccess) onSuccess();
      onOpenChange(false);
    },
    onError: (err) => {
      playBeep('error');
      toast.error(err.message || 'حدث خطأ أثناء تحديث المخزون');
    },
  });

  // Lookup code from backend
  const handleProcessCode = useCallback(
    async (code: string) => {
      const cleanCode = code.trim();
      if (!cleanCode) return;

      try {
        const res = await utils.inventory.lookupByBarcode.fetch({ code: cleanCode });

        if (!res.found || !res.item || !res.item.inventoryItemId) {
          playBeep('error');
          triggerHaptic('error');
          toast.error(`الرمز "${cleanCode}" غير مسجل كصنف في المخزن!`, {
            description: 'تأكد من وجود المنتج وإضافته في قسم المنتجات والمخزون أولاً.',
          });
          return;
        }

        const item = res.item;
        if (!item.inventoryItemId) {
          playBeep('error');
          triggerHaptic('error');
          toast.error(`المنتج "${item.productNameAr || item.productName}" ليس له سجل مخزون.`);
          return;
        }

        const entryId = item.inventoryItemId;
        const qtyToAdd = multiplier;

        setScannedItems((prev) => {
          const next = new Map(prev);
          const existing = next.get(entryId);
          const newQty = (existing?.scannedQty ?? 0) + qtyToAdd;

          if (mode === 'out' && newQty > item.quantity) {
            playBeep('warning');
            triggerHaptic('warning');
          } else {
            playBeep('success');
            triggerHaptic('success');
          }

          const updated: ScannedEntry = {
            inventoryItemId: entryId,
            variantId: item.variantId,
            productId: item.productId,
            productName: item.productName,
            productNameAr: item.productNameAr,
            variantName: item.variantName,
            sku: item.sku,
            currentStock: item.quantity,
            reorderPoint: item.reorderPoint,
            scannedQty: newQty,
            binLocation: item.binLocation ?? null,
          };

          next.set(entryId, updated);
          setLastScannedItem(updated);
          return next;
        });

        toast.success(
          `تم مسح: ${item.productNameAr || item.productName} (${item.sku})${qtyToAdd > 1 ? ` [x${qtyToAdd}]` : ''}`,
          { duration: 1500 }
        );
      } catch {
        playBeep('error');
        triggerHaptic('error');
        toast.error(`حدث خطأ أثناء البحث عن الرمز "${cleanCode}"`);
      }
    },
    [utils, multiplier, mode]
  );

  // Hardware barcode scanner wedge listener
  useBarcodeScanner({
    onScan: (code) => {
      handleProcessCode(code);
    },
    enabled: open,
  });

  const updateQuantity = (id: string, delta: number) => {
    setScannedItems((prev) => {
      const next = new Map(prev);
      const item = next.get(id);
      if (!item) return prev;
      const newQty = item.scannedQty + delta;
      if (newQty <= 0) {
        next.delete(id);
      } else {
        next.set(id, { ...item, scannedQty: newQty });
      }
      return next;
    });
  };

  const removeItem = (id: string) => {
    setScannedItems((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  };

  const handleConfirmSubmit = () => {
    if (scannedItems.size === 0) return;

    const itemsToSubmit = Array.from(scannedItems.values()).map((item) => ({
      itemId: item.inventoryItemId,
      quantity: item.scannedQty,
    }));

    batchAdjustMutation.mutate({
      type: mode === 'in' ? 'in' : 'out',
      items: itemsToSubmit,
      note: `ماسح المخزن: ${mode === 'in' ? 'استلام بضاعة' : 'صرف بضاعة'}`,
    });
  };

  const totalItemsCount = Array.from(scannedItems.values()).reduce(
    (sum, item) => sum + item.scannedQty,
    0
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl w-full h-[90vh] sm:h-[85vh] p-0 flex flex-col bg-[var(--surface)] border-[var(--rim1)] text-[var(--t1)] overflow-hidden">
        {/* Header */}
        <DialogHeader className="p-4 border-b border-[var(--rim1)] flex flex-row items-center justify-between">
          <DialogTitle className="text-lg font-bold flex items-center gap-2">
            <Package className="w-5 h-5 text-[var(--gold)]" />
            ماسح المخزن الذكي (كاميرا و QR)
          </DialogTitle>

          {/* Mode Tabs */}
          <div className="flex bg-[var(--surface2)] p-1 rounded-lg border border-[var(--rim1)] text-xs">
            <button
              type="button"
              onClick={() => setMode('in')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition font-semibold ${
                mode === 'in'
                  ? 'bg-[var(--emerald)] text-black shadow-sm'
                  : 'text-[var(--t2)] hover:text-[var(--t1)]'
              }`}
            >
              <ArrowDownRight className="w-3.5 h-3.5" />
              استلام وإضافة
            </button>
            <button
              type="button"
              onClick={() => setMode('out')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition font-semibold ${
                mode === 'out'
                  ? 'bg-[var(--crimson)] text-white shadow-sm'
                  : 'text-[var(--t2)] hover:text-[var(--t1)]'
              }`}
            >
              <ArrowUpLeft className="w-3.5 h-3.5" />
              صرف وسحب
            </button>
            <button
              type="button"
              onClick={() => setMode('lookup')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition font-semibold ${
                mode === 'lookup'
                  ? 'bg-[var(--gold)] text-black shadow-sm'
                  : 'text-[var(--t2)] hover:text-[var(--t1)]'
              }`}
            >
              <Search className="w-3.5 h-3.5" />
              استعلام فقط
            </button>
          </div>
        </DialogHeader>

        {/* Content Area */}
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
          {/* Camera Section */}
          <div
            className={`transition-all duration-300 flex flex-col border-b md:border-b-0 md:border-l border-[var(--rim1)] bg-black ${
              isCameraCollapsed ? 'h-14 md:w-16' : 'h-64 sm:h-72 md:h-full md:w-1/2'
            }`}
          >
            <div className="p-2 bg-zinc-900 flex items-center justify-between text-xs text-zinc-300">
              <span className="flex items-center gap-1.5">
                <Camera className="w-4 h-4 text-[var(--gold)]" />
                الكاميرا المباشرة
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsCameraCollapsed(!isCameraCollapsed)}
                className="h-6 px-2 text-[10px] text-zinc-400"
              >
                {isCameraCollapsed ? (
                  <>
                    <ChevronDown className="w-3 h-3 ml-1" /> إظهار
                  </>
                ) : (
                  <>
                    <ChevronUp className="w-3 h-3 ml-1" /> تصغير
                  </>
                )}
              </Button>
            </div>

            {!isCameraCollapsed && (
              <div className="flex-1 relative">
                <CameraScanner
                  active={open}
                  onScan={handleProcessCode}
                  overlayText={
                    mode === 'in'
                      ? 'وجّه الكاميرا لاستلام المنتج (+1)'
                      : mode === 'out'
                      ? 'وجّه الكاميرا لصرف المنتج (-1)'
                      : 'وجّه الكاميرا لفحص المنتج'
                  }
                  className="w-full h-full"
                />
              </div>
            )}
          </div>

          {/* List & Details Section */}
          <div className="flex-1 flex flex-col overflow-hidden bg-[var(--surface)]">
            {/* Toolbar: Hardware Status & Quick Box Multiplier */}
            <div className="p-2.5 px-3 border-b border-[var(--rim1)] bg-[var(--surface2)]/40 flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-[var(--t2)] font-medium flex items-center gap-1">
                  <Boxes className="w-3.5 h-3.5 text-[var(--gold)]" />
                  مضاعف الكمية:
                </span>
                {[1, 6, 12, 24].map((qty) => (
                  <button
                    key={qty}
                    type="button"
                    onClick={() => setMultiplier(qty)}
                    className={`px-2 py-0.5 rounded text-xs font-bold transition ${
                      multiplier === qty
                        ? 'bg-[var(--gold)] text-black shadow-xs'
                        : 'bg-[var(--surface)] text-[var(--t2)] hover:text-[var(--t1)] border border-[var(--rim1)]'
                    }`}
                  >
                    x{qty}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1.5 text-[11px] text-emerald-400 bg-emerald-950/30 px-2 py-0.5 rounded-full border border-emerald-800/40">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <Zap className="w-3 h-3 text-emerald-400" />
                <span>قارئ الليزر / USB جاهز</span>
              </div>
            </div>

            {/* Manual SKU input bar */}
            <div className="p-3 border-b border-[var(--rim1)] bg-[var(--surface2)]/50 flex gap-2">
              <Input
                placeholder="أو اكتب SKU يدوياً واضغط Enter..."
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && manualCode) {
                    handleProcessCode(manualCode);
                    setManualCode('');
                  }
                }}
                className="h-8 text-xs bg-[var(--surface)] border-[var(--rim1)]"
              />
              <Button
                size="sm"
                onClick={() => {
                  if (manualCode) {
                    handleProcessCode(manualCode);
                    setManualCode('');
                  }
                }}
                className="h-8 px-3 text-xs"
                variant="outline"
              >
                إضافة
              </Button>
            </div>

            {/* Scanned Items List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {scannedItems.size === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-6 text-[var(--t2)]">
                  <Layers className="w-12 h-12 stroke-[1.5] mb-3 text-[var(--gold)]/50 animate-pulse" />
                  <p className="font-semibold text-sm text-[var(--t1)]">لم يتم مسح أي منتج بعد</p>
                  <p className="text-xs text-[var(--t2)] max-w-xs mt-1">
                    قم بتمرير علب المنتجات أو ملصقات الباركود أمام الكاميرا لتسجيلها ومتابعة
                    الكميات لحظياً.
                  </p>
                </div>
              ) : (
                Array.from(scannedItems.values()).map((entry) => {
                  const isStockShortage =
                    mode === 'out' && entry.scannedQty > entry.currentStock;

                  return (
                    <div
                      key={entry.inventoryItemId}
                      className={`p-3 rounded-xl border transition flex items-center justify-between gap-3 ${
                        isStockShortage
                          ? 'border-[var(--crimson)] bg-[var(--crimson)]/10'
                          : 'border-[var(--rim1)] bg-[var(--surface2)]'
                      }`}
                    >
                      <div className="flex-1 overflow-hidden space-y-0.5">
                        <div className="flex items-center gap-2">
                          <h4 className="font-bold text-sm text-[var(--t1)] truncate">
                            {entry.productNameAr || entry.productName}
                          </h4>
                          {entry.variantName && entry.variantName !== 'الأساسي' && (
                            <span className="text-[10px] px-1.5 py-0.5 bg-[var(--rim1)] rounded text-[var(--t2)] font-semibold">
                              {entry.variantName}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-[var(--t2)] flex-wrap">
                          <span className="font-mono dir-ltr">{entry.sku}</span>
                          <span>•</span>
                          <span>
                            الرصيد بالمخزن:{' '}
                            <strong className="text-[var(--t1)]">{entry.currentStock}</strong>
                          </span>
                          <span>•</span>
                          {editingBinLocationVariantId === entry.variantId ? (
                            <span className="inline-flex items-center gap-1">
                              <Input
                                value={tempBinLocation}
                                onChange={(e) => setTempBinLocation(e.target.value)}
                                placeholder="الرف مثلاً A-04"
                                className="h-6 text-[11px] w-24 px-1.5 py-0 bg-[var(--surface)] border-[var(--gold)]"
                                autoFocus
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' && entry.variantId) {
                                    updateBinLocationMutation.mutate({
                                      variantId: entry.variantId,
                                      binLocation: tempBinLocation,
                                    });
                                  } else if (e.key === 'Escape') {
                                    setEditingBinLocationVariantId(null);
                                  }
                                }}
                              />
                              <button
                                type="button"
                                disabled={updateBinLocationMutation.isPending}
                                onClick={() => {
                                  if (entry.variantId) {
                                    updateBinLocationMutation.mutate({
                                      variantId: entry.variantId,
                                      binLocation: tempBinLocation,
                                    });
                                  }
                                }}
                                className="p-0.5 text-emerald-400 hover:text-emerald-300 transition"
                                title="حفظ موقع الرف"
                              >
                                <Check className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingBinLocationVariantId(null)}
                                className="p-0.5 text-[var(--t2)] hover:text-[var(--t1)] transition"
                                title="إلغاء"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                if (entry.variantId) {
                                  setEditingBinLocationVariantId(entry.variantId);
                                  setTempBinLocation(entry.binLocation || '');
                                }
                              }}
                              className="inline-flex items-center gap-1 text-[11px] text-[var(--gold)] hover:text-[var(--gold)]/80 bg-[var(--gold)]/10 hover:bg-[var(--gold)]/20 px-1.5 py-0.5 rounded transition border border-[var(--gold)]/20"
                              title="تحديد أو تعديل موقع الرف في المخزن"
                            >
                              <MapPin className="w-3 h-3 text-[var(--gold)]" />
                              <span>{entry.binLocation || 'تحديد الرف'}</span>
                              <Edit2 className="w-2.5 h-2.5 opacity-60 ml-0.5" />
                            </button>
                          )}
                        </div>
                        {isStockShortage && (
                          <div className="text-[11px] font-bold text-[var(--crimson)] flex items-center gap-1 mt-1">
                            <AlertTriangle className="w-3 h-3" />
                            تنبيه: الكمية الممسوحة تتجاوز الرصيد الحالي بالمخزن!
                          </div>
                        )}
                      </div>

                      {/* Quantity Actions */}
                      {mode !== 'lookup' && (
                        <div className="flex items-center gap-1.5 bg-[var(--surface)] p-1 rounded-lg border border-[var(--rim1)]">
                          <button
                            type="button"
                            onClick={() => updateQuantity(entry.inventoryItemId, -1)}
                            className="w-7 h-7 flex items-center justify-center rounded hover:bg-[var(--rim1)] text-[var(--t2)]"
                          >
                            <Minus className="w-3.5 h-3.5" />
                          </button>
                          <span className="w-8 text-center font-bold text-sm text-[var(--gold)]">
                            {entry.scannedQty}
                          </span>
                          <button
                            type="button"
                            onClick={() => updateQuantity(entry.inventoryItemId, 1)}
                            className="w-7 h-7 flex items-center justify-center rounded hover:bg-[var(--rim1)] text-[var(--t2)]"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={() => removeItem(entry.inventoryItemId)}
                        className="p-1.5 text-[var(--t2)] hover:text-[var(--crimson)] transition rounded"
                        title="حذف الصنف من القائمة"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            {/* Bottom Actions Bar */}
            {mode !== 'lookup' && (
              <div className="p-4 border-t border-[var(--rim1)] bg-[var(--surface2)] flex items-center justify-between gap-4">
                <div className="text-xs">
                  <span className="text-[var(--t2)]">إجمالي الأصناف: </span>
                  <strong className="text-[var(--t1)] text-sm">{scannedItems.size}</strong>
                  <span className="text-[var(--t2)] mr-3">إجمالي القطع: </span>
                  <strong className="text-[var(--gold)] text-sm">{totalItemsCount}</strong>
                </div>

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setScannedItems(new Map())}
                    disabled={scannedItems.size === 0 || batchAdjustMutation.isPending}
                    className="text-xs border-[var(--rim1)]"
                  >
                    مسح الكل
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleConfirmSubmit}
                    disabled={scannedItems.size === 0 || batchAdjustMutation.isPending}
                    style={{
                      background: mode === 'in' ? 'var(--emerald)' : 'var(--crimson)',
                      color: mode === 'in' ? 'var(--void)' : '#fff',
                    }}
                    className="font-bold flex items-center gap-1.5 text-xs px-4"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    {batchAdjustMutation.isPending
                      ? 'جاري التحديث...'
                      : mode === 'in'
                      ? `تأكيد إضافة ${totalItemsCount} قطع للمخزن`
                      : `تأكيد صرف ${totalItemsCount} قطع`}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
