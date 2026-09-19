'use client';

import { useState, useMemo } from 'react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CameraScanner } from '@/components/scanner/CameraScanner';
import { useBarcodeScanner } from '@/hooks/useBarcodeScanner';
import { playBeep, triggerHaptic } from '@/lib/sound';
import { toast } from 'sonner';
import {
  ClipboardList,
  Camera,
  CheckCircle2,
  AlertTriangle,
  Search,
  Check,
  X,
  RotateCcw,
  Sparkles,
  Zap,
  Boxes,
} from 'lucide-react';
import { formatDate as formatDateShared } from '@irth/domain';

export type StocktakingSession = {
  id: string;
  orgId: string;
  status: 'draft' | 'in_progress' | 'completed' | 'cancelled';
  startedAt: Date | null;
  completedAt: Date | null;
  notes: string | null;
  createdAt: Date;
  itemCount: number;
  varianceCount: number;
};

export type StocktakingSummary = {
  totalSessions: number;
  activeSessions: number;
  lastCompletedAt: Date | null;
};

function formatDate(d: Date | null): string {
  if (!d) return '—';
  return formatDateShared(d, { dateTimeOptions: { year: 'numeric', month: 'short', day: 'numeric' } });
}

interface Props {
  sessions: StocktakingSession[];
  summary: StocktakingSummary;
}

export function StocktakingClient({ sessions: initialSessions, summary }: Props) {
  const utils = trpc.useUtils();
  const [detailSession, setDetailSession] = useState<StocktakingSession | null>(null);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [lastScannedBanner, setLastScannedBanner] = useState<{
    name: string;
    sku: string;
    actual: number;
    expected: number;
    variance: number;
  } | null>(null);
  const [filterType, setFilterType] = useState<'all' | 'counted' | 'uncounted' | 'variance'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [manualSku, setManualSku] = useState('');
  const [multiplier, setMultiplier] = useState<number>(1);

  const createMutation = trpc.stocktaking.sessions.create.useMutation({
    onSuccess: (res) => {
      toast.success('تم إنشاء جلسة الجرد بنجاح وتهيئة الأصناف من المخزن.');
      utils.stocktaking.sessions.list.invalidate();
      if (res.data) {
        setDetailSession(res.data as unknown as StocktakingSession);
      }
    },
    onError: (err) => {
      toast.error(err.message || 'تعذر إنشاء جلسة الجرد');
    },
  });

  const completeMutation = trpc.stocktaking.sessions.complete.useMutation({
    onSuccess: () => {
      toast.success('تم إتمام وتسوية الجرد وتحديث أرصدة المخزون بنجاح!');
      utils.stocktaking.sessions.list.invalidate();
      setDetailSession(null);
    },
    onError: (err) => {
      toast.error(err.message || 'تعذر إتمام الجرد');
    },
  });

  const getItemsQuery = trpc.stocktaking.sessions.getItems.useQuery(
    { sessionId: detailSession?.id ?? '' },
    { enabled: !!detailSession }
  );

  const recordScanMutation = trpc.stocktaking.recordScan.useMutation({
    onSuccess: (res) => {
      if (res.data) {
        const item = res.data;
        setLastScannedBanner({
          name: item.productName,
          sku: item.sku,
          actual: item.actualQuantity ?? 0,
          expected: item.expectedQuantity ?? 0,
          variance: item.variance ?? 0,
        });

        if (item.variance !== 0) {
          playBeep('warning');
          triggerHaptic('warning');
        } else {
          playBeep('success');
          triggerHaptic('success');
        }

        toast.success(
          `تم تسجيل: ${item.productName} (${item.sku}) | الفعلي: ${item.actualQuantity}${multiplier > 1 ? ` [x${multiplier}]` : ''}`,
          { duration: 1500 }
        );
      }
      if (detailSession) {
        utils.stocktaking.sessions.getItems.invalidate({ sessionId: detailSession.id });
        utils.stocktaking.sessions.list.invalidate();
      }
    },
    onError: (err) => {
      playBeep('error');
      triggerHaptic('error');
      toast.error(err.message || 'تعذر تسجيل الصنف');
    },
  });

  const handleScanCode = (code: string) => {
    if (!detailSession) return;
    recordScanMutation.mutate({
      sessionId: detailSession.id,
      code,
      quantityDelta: multiplier,
    });
  };

  // Hardware barcode scanner wedge listener for stocktaking
  useBarcodeScanner({
    onScan: (code) => {
      handleScanCode(code);
    },
    enabled: !!detailSession && detailSession.status === 'in_progress',
  });

  const rawItems = useMemo(
    () => getItemsQuery.data?.data ?? [],
    [getItemsQuery.data?.data]
  );

  const filteredItems = useMemo(() => {
    return rawItems.filter((item) => {
      const matchesSearch =
        !searchQuery ||
        item.productName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.sku.toLowerCase().includes(searchQuery.toLowerCase());

      if (!matchesSearch) return false;

      if (filterType === 'counted') return item.actualQuantity !== null;
      if (filterType === 'uncounted') return item.actualQuantity === null;
      if (filterType === 'variance')
        return item.variance !== null && item.variance !== 0;

      return true;
    });
  }, [rawItems, searchQuery, filterType]);

  const countedCount = rawItems.filter((i) => i.actualQuantity !== null).length;
  const varianceCount = rawItems.filter(
    (i) => i.variance !== null && i.variance !== 0
  ).length;

  return (
    <div className="space-y-6">
      {/* KPI Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-xl border border-[var(--rim1)] bg-[var(--surface)] p-4 shadow-sm">
          <p className="text-sm text-[var(--t2)]">إجمالي جلسات الجرد</p>
          <p className="text-3xl font-bold text-[var(--t1)] mt-1">{summary.totalSessions}</p>
        </div>
        <div className="rounded-xl border border-[var(--rim1)] bg-[var(--surface)] p-4 shadow-sm">
          <p className="text-sm text-[var(--t2)]">جلسات نشطة</p>
          <p className="text-3xl font-bold mt-1 text-[var(--gold)]">{summary.activeSessions}</p>
        </div>
        <div className="rounded-xl border border-[var(--rim1)] bg-[var(--surface)] p-4 shadow-sm">
          <p className="text-sm text-[var(--t2)]">آخر جرد مكتمل</p>
          <p className="text-lg font-semibold mt-1 text-[var(--emerald)]">
            {formatDate(summary.lastCompletedAt)}
          </p>
        </div>
      </div>

      {/* Header & Create button */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-[var(--t1)]">جرد المخزون</h1>
          <p className="text-xs text-[var(--t2)] mt-0.5">
            مطابقة الأرصدة الفعلية للمخزن باستخدام مسح الباركود بالكاميرا وتسوية الفروقات.
          </p>
        </div>
        <Button
          onClick={() => createMutation.mutate({})}
          disabled={createMutation.isPending}
          style={{ background: 'var(--gold)', color: 'var(--void)' }}
          className="font-bold flex items-center gap-1.5"
        >
          <Sparkles className="w-4 h-4" />
          {createMutation.isPending ? 'جاري التهيئة...' : '+ بدء جرد جديد'}
        </Button>
      </div>

      {/* Sessions Table */}
      <div className="rounded-xl border border-[var(--rim1)] bg-[var(--surface)] overflow-hidden shadow-sm">
        <Table>
          <TableHeader className="bg-[var(--surface2)]">
            <TableRow>
              <TableHead className="text-start">الحالة</TableHead>
              <TableHead className="text-start">تاريخ البدء</TableHead>
              <TableHead className="text-start">عدد الأصناف</TableHead>
              <TableHead className="text-start">الفروقات</TableHead>
              <TableHead className="text-end">الإجراءات</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {initialSessions.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="p-0">
                  <EmptyState
                    icon={ClipboardList}
                    title="لا توجد جلسات جرد"
                    hint="جلسة الجرد بتقارن الكمية الدفترية بالفعلية وتطبّق الفروق على المخزون."
                  />
                </TableCell>
              </TableRow>
            ) : (
              initialSessions.map((session) => (
                <TableRow key={session.id} className="border-b border-[var(--rim1)]">
                  <TableCell>
                    <StatusBadge status={session.status} domain="stocktaking" />
                  </TableCell>
                  <TableCell className="text-[var(--t2)] text-sm">
                    {formatDate(session.startedAt)}
                  </TableCell>
                  <TableCell className="text-[var(--t1)] font-semibold">
                    {session.itemCount}
                  </TableCell>
                  <TableCell>
                    {session.varianceCount > 0 ? (
                      <span className="font-bold text-[var(--crimson)]">
                        {session.varianceCount} فروقات
                      </span>
                    ) : (
                      <span className="text-[var(--emerald)] font-semibold">لا توجد</span>
                    )}
                  </TableCell>
                  <TableCell className="text-end">
                    <div className="flex justify-end gap-2 items-center">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setDetailSession(session)}
                        className="text-xs"
                      >
                        {session.status === 'in_progress' ? 'متابعة الجرد' : 'عرض التفاصيل'}
                      </Button>
                      {session.status === 'in_progress' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => completeMutation.mutate({ id: session.id })}
                          disabled={completeMutation.isPending}
                          className="text-xs text-[var(--emerald)] hover:text-[var(--emerald)] hover:bg-[var(--emerald)]/10 font-bold"
                        >
                          إتمام الجرد
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Session Details / Execution Modal */}
      {detailSession && (
        <Dialog open={!!detailSession} onOpenChange={(open) => !open && setDetailSession(null)}>
          <DialogContent className="max-w-4xl w-full h-[90vh] flex flex-col p-0 bg-[var(--surface)] border-[var(--rim1)] text-[var(--t1)] overflow-hidden">
            {/* Modal Header */}
            <DialogHeader className="p-4 border-b border-[var(--rim1)] bg-[var(--surface2)]/70 flex flex-row items-center justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <DialogTitle className="text-lg font-bold">
                    جلسة الجرد ({formatDate(detailSession.startedAt)})
                  </DialogTitle>
                  <StatusBadge status={detailSession.status} domain="stocktaking" />
                </div>
                <div className="flex items-center gap-4 text-xs text-[var(--t2)]">
                  <span>الأصناف: {rawItems.length}</span>
                  <span>تم الجرد: {countedCount}</span>
                  <span className="text-[var(--crimson)]">فروقات: {varianceCount}</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {detailSession.status === 'in_progress' && (
                  <>
                    <Button
                      onClick={() => setIsScannerOpen(true)}
                      style={{ background: 'var(--gold)', color: 'var(--void)' }}
                      className="font-bold text-xs flex items-center gap-1.5 shadow-md"
                    >
                      <Camera className="w-4 h-4" />
                      مسح بالكاميرا (مستمر)
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => completeMutation.mutate({ id: detailSession.id })}
                      disabled={completeMutation.isPending}
                      className="text-xs text-[var(--emerald)] border-[var(--emerald)] hover:bg-[var(--emerald)]/10 font-bold"
                    >
                      <CheckCircle2 className="w-4 h-4 ml-1" />
                      إتمام وتسوية
                    </Button>
                  </>
                )}
              </div>
            </DialogHeader>

            {/* Filter and Search Toolbar */}
            <div className="p-3 border-b border-[var(--rim1)] bg-[var(--surface)] flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 flex-1 max-w-sm">
                <Input
                  placeholder="بحث باسم المنتج أو الـ SKU..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-8 text-xs bg-[var(--surface2)] border-[var(--rim1)]"
                />
              </div>

              {detailSession.status === 'in_progress' && (
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Multiplier */}
                  <div className="flex items-center gap-1 bg-[var(--surface2)] p-1 rounded-lg border border-[var(--rim1)]">
                    <span className="text-[11px] text-[var(--t2)] font-medium px-1 flex items-center gap-1">
                      <Boxes className="w-3.5 h-3.5 text-[var(--gold)]" />
                      الكمية:
                    </span>
                    {[1, 6, 12, 24].map((qty) => (
                      <button
                        key={qty}
                        type="button"
                        onClick={() => setMultiplier(qty)}
                        className={`px-1.5 py-0.5 rounded text-xs font-bold transition ${
                          multiplier === qty
                            ? 'bg-[var(--gold)] text-black shadow-xs'
                            : 'text-[var(--t2)] hover:text-[var(--t1)]'
                        }`}
                      >
                        x{qty}
                      </button>
                    ))}
                  </div>

                  {/* Hardware ready badge */}
                  <div className="flex items-center gap-1.5 text-[11px] text-emerald-400 bg-emerald-950/30 px-2 py-1 rounded-full border border-emerald-800/40">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <Zap className="w-3 h-3 text-emerald-400" />
                    <span>قارئ الليزر جاهز</span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <Input
                      placeholder="أو اكتب SKU لمسحه..."
                      value={manualSku}
                      onChange={(e) => setManualSku(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && manualSku) {
                          handleScanCode(manualSku);
                          setManualSku('');
                        }
                      }}
                      className="h-8 w-40 text-xs bg-[var(--surface2)] border-[var(--rim1)]"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        if (manualSku) {
                          handleScanCode(manualSku);
                          setManualSku('');
                        }
                      }}
                      className="h-8 text-xs px-2.5"
                    >
                      تسجيل (+{multiplier})
                    </Button>
                  </div>
                </div>
              )}

              {/* Status Filter Tabs */}
              <div className="flex bg-[var(--surface2)] p-1 rounded-lg border border-[var(--rim1)] text-xs">
                <button
                  type="button"
                  onClick={() => setFilterType('all')}
                  className={`px-2.5 py-1 rounded transition ${
                    filterType === 'all'
                      ? 'bg-[var(--gold)] text-black font-bold shadow-sm'
                      : 'text-[var(--t2)]'
                  }`}
                >
                  الكل ({rawItems.length})
                </button>
                <button
                  type="button"
                  onClick={() => setFilterType('counted')}
                  className={`px-2.5 py-1 rounded transition ${
                    filterType === 'counted'
                      ? 'bg-[var(--emerald)] text-black font-bold shadow-sm'
                      : 'text-[var(--t2)]'
                  }`}
                >
                  تم جردها ({countedCount})
                </button>
                <button
                  type="button"
                  onClick={() => setFilterType('uncounted')}
                  className={`px-2.5 py-1 rounded transition ${
                    filterType === 'uncounted'
                      ? 'bg-zinc-700 text-white font-bold shadow-sm'
                      : 'text-[var(--t2)]'
                  }`}
                >
                  لم تُجرد ({rawItems.length - countedCount})
                </button>
                <button
                  type="button"
                  onClick={() => setFilterType('variance')}
                  className={`px-2.5 py-1 rounded transition ${
                    filterType === 'variance'
                      ? 'bg-[var(--crimson)] text-white font-bold shadow-sm'
                      : 'text-[var(--t2)]'
                  }`}
                >
                  فروقات ({varianceCount})
                </button>
              </div>
            </div>

            {/* Last Scanned Banner */}
            {lastScannedBanner && (
              <div className="px-4 py-2 bg-[var(--emerald)]/15 border-b border-[var(--emerald)]/30 flex items-center justify-between text-xs animate-in fade-in duration-200">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-[var(--emerald)]" />
                  <span>
                    آخر صنف ممسوح: <strong>{lastScannedBanner.name}</strong> ({lastScannedBanner.sku})
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span>
                    الفعلي: <strong>{lastScannedBanner.actual}</strong>
                  </span>
                  <span>
                    المتوقع: <strong>{lastScannedBanner.expected}</strong>
                  </span>
                  <span
                    className={`font-bold px-1.5 py-0.5 rounded ${
                      lastScannedBanner.variance === 0
                        ? 'bg-[var(--emerald)]/20 text-[var(--emerald)]'
                        : 'bg-[var(--crimson)]/20 text-[var(--crimson)]'
                    }`}
                  >
                    الفرق: {lastScannedBanner.variance > 0 ? `+${lastScannedBanner.variance}` : lastScannedBanner.variance}
                  </span>
                </div>
              </div>
            )}

            {/* Items Table */}
            <div className="flex-1 overflow-y-auto">
              {getItemsQuery.isLoading ? (
                <div className="p-8 text-center text-sm text-[var(--t2)]">جاري تحميل الأصناف...</div>
              ) : filteredItems.length === 0 ? (
                <div className="p-8 text-center text-sm text-[var(--t2)]">
                  لا توجد أصناف مطابقة للبحث أو الفلتر المختار.
                </div>
              ) : (
                <Table>
                  <TableHeader className="bg-[var(--surface2)]/40 sticky top-0 z-10">
                    <TableRow>
                      <TableHead className="text-start">اسم المنتج</TableHead>
                      <TableHead className="text-start">SKU</TableHead>
                      <TableHead className="text-start">الكمية المتوقعة</TableHead>
                      <TableHead className="text-start">الكمية الفعلية (المحسوبة)</TableHead>
                      <TableHead className="text-start">الفرق</TableHead>
                      {detailSession.status === 'in_progress' && (
                        <TableHead className="text-end">تعديل سريع</TableHead>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredItems.map((item) => {
                      const isCounted = item.actualQuantity !== null;
                      const variance = item.variance ?? 0;

                      return (
                        <TableRow
                          key={item.id}
                          className={`border-b border-[var(--rim1)] ${
                            isCounted ? 'bg-[var(--surface)]' : 'bg-[var(--surface2)]/20 opacity-80'
                          }`}
                        >
                          <TableCell className="font-semibold text-sm text-[var(--t1)]">
                            {item.productName}
                          </TableCell>
                          <TableCell className="font-mono text-xs text-[var(--t2)] dir-ltr text-start">
                            {item.sku}
                          </TableCell>
                          <TableCell className="text-sm font-semibold">
                            {item.expectedQuantity}
                          </TableCell>
                          <TableCell className="text-sm">
                            {isCounted ? (
                              <span className="font-bold text-[var(--t1)]">{item.actualQuantity}</span>
                            ) : (
                              <span className="text-xs text-[var(--t2)] italic">لم تُجرد بعد</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {!isCounted ? (
                              <span className="text-[var(--t2)] text-xs">—</span>
                            ) : variance === 0 ? (
                              <span className="text-[11px] font-bold text-[var(--emerald)] bg-[var(--emerald)]/10 px-2 py-0.5 rounded-full">
                                متطابق (0)
                              </span>
                            ) : (
                              <span className="text-[11px] font-bold text-[var(--crimson)] bg-[var(--crimson)]/10 px-2 py-0.5 rounded-full">
                                {variance > 0 ? `+${variance} زيادة` : `${variance} عجز`}
                              </span>
                            )}
                          </TableCell>
                          {detailSession.status === 'in_progress' && (
                            <TableCell className="text-end">
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() =>
                                    recordScanMutation.mutate({
                                      sessionId: detailSession.id,
                                      code: item.sku,
                                      quantityDelta: 1,
                                    })
                                  }
                                  className="h-7 px-2 text-xs font-bold"
                                  title="إضافة 1 للكمية المحسوبة"
                                >
                                  +1
                                </Button>
                              </div>
                            </TableCell>
                          )}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Standalone Stocktaking Camera Scanner Overlay */}
      {isScannerOpen && detailSession && (
        <div className="fixed inset-0 z-[60] bg-black flex flex-col">
          {/* Top banner with close button and multiplier */}
          <div className="p-3 bg-zinc-900/90 backdrop-blur-md flex items-center justify-between text-white z-20 border-b border-zinc-800 flex-wrap gap-2">
            <div className="flex items-center gap-2 text-sm font-bold">
              <Camera className="w-5 h-5 text-[var(--gold)]" />
              <span>ماسح الجرد السريع - {detailSession.notes || 'جلسة نشطة'}</span>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 bg-zinc-800/90 px-2 py-0.5 rounded-lg border border-zinc-700 text-xs">
                <span className="text-zinc-400 text-[11px]">الكمية:</span>
                {[1, 6, 12, 24].map((qty) => (
                  <button
                    key={qty}
                    type="button"
                    onClick={() => setMultiplier(qty)}
                    className={`px-1.5 py-0.5 rounded text-xs font-bold transition ${
                      multiplier === qty
                        ? 'bg-[var(--gold)] text-black shadow-xs'
                        : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    x{qty}
                  </button>
                ))}
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsScannerOpen(false)}
                className="text-xs bg-zinc-800 text-white hover:bg-zinc-700 border-none"
              >
                <X className="w-4 h-4 ml-1" />
                إغلاق الكاميرا
              </Button>
            </div>
          </div>

          {/* Camera View */}
          <div className="flex-1 relative overflow-hidden">
            <CameraScanner
              active={isScannerOpen}
              onScan={handleScanCode}
              overlayText={`وجّه الكاميرا نحو رمز QR لتسجيل الصنف (+${multiplier})`}
              className="w-full h-full"
            />
          </div>

          {/* Bottom Live Feedback Bar */}
          <div className="p-4 bg-zinc-900/95 border-t border-zinc-800 text-center z-20 space-y-1">
            {lastScannedBanner ? (
              <div className="animate-in fade-in duration-200">
                <p className="text-xs text-zinc-400">آخر صنف تم مسحه:</p>
                <p className="font-bold text-base text-[var(--gold)]">
                  {lastScannedBanner.name} ({lastScannedBanner.sku})
                </p>
                <div className="flex items-center justify-center gap-4 text-xs text-zinc-300 mt-1">
                  <span>المحسوب الفعلي: <strong>{lastScannedBanner.actual}</strong></span>
                  <span>المتوقع: <strong>{lastScannedBanner.expected}</strong></span>
                  <span
                    className={
                      lastScannedBanner.variance === 0
                        ? 'text-[var(--emerald)] font-bold'
                        : 'text-[var(--crimson)] font-bold'
                    }
                  >
                    الفرق: {lastScannedBanner.variance > 0 ? `+${lastScannedBanner.variance}` : lastScannedBanner.variance}
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-xs text-zinc-400">
                مرر المنتجات تباعاً أمام الكاميرا، وسيتم احتساب كل صنف وإصدار صوت تأكيد فورياً.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}