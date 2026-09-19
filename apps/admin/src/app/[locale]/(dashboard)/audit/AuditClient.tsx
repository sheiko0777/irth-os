'use client';

import { useState, useMemo } from 'react';
import { trpc, type RouterOutputs } from '@/lib/trpc';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Pagination } from '@/components/ui/Pagination';
import { formatDate } from '@irth/domain';
import { toast } from 'sonner';
import {
  ShieldCheck,
  Lock,
  Activity,
  Users,
  Clock,
  Search,
  Download,
  Eye,
  Laptop,
  Smartphone,
  Tablet,
  Globe,
  Copy,
  Check,
  RefreshCw,
  Layers,
  Database,
  Calendar,
  AlertCircle,
  FileSpreadsheet,
} from 'lucide-react';

type AuditListResponse = RouterOutputs['audit']['list'];
type AuditItem = AuditListResponse['items'][number];
type AuditStats = RouterOutputs['audit']['stats'];

interface Props {
  initialData: AuditListResponse;
  initialStats: AuditStats;
}

const TABLE_OPTIONS = [
  { value: 'all', label: 'جميع الوحدات والكيانات' },
  { value: 'products', label: 'المنتجات' },
  { value: 'product_variants', label: 'متغيرات المنتجات' },
  { value: 'inventory_items', label: 'أصناف المخزون' },
  { value: 'orders', label: 'الطلبات' },
  { value: 'stocktaking_sessions', label: 'جلسات الجرد' },
  { value: 'purchase_orders', label: 'المشتريات' },
  { value: 'order_returns', label: 'المرتجعات' },
  { value: 'org_members', label: 'الأعضاء والصلاحيات' },
  { value: 'coupons', label: 'الكوبونات' },
  { value: 'org_settings', label: 'إعدادات المنشأة' },
];

export function AuditClient({ initialData, initialStats }: Props) {
  const [page, setPage] = useState(initialData.pagination.page);
  const [pageSize] = useState(initialData.pagination.pageSize);
  const [search, setSearch] = useState('');
  const [selectedTable, setSelectedTable] = useState('all');
  const [selectedDatePreset, setSelectedDatePreset] = useState<'all' | 'today' | '7d' | '30d'>('all');
  const [activeInspectorItem, setActiveInspectorItem] = useState<AuditItem | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Compute ISO date filters based on preset
  const { dateFrom } = useMemo(() => {
    if (selectedDatePreset === 'today') {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      return { dateFrom: d.toISOString() };
    }
    if (selectedDatePreset === '7d') {
      const d = new Date();
      d.setDate(d.getDate() - 7);
      d.setHours(0, 0, 0, 0);
      return { dateFrom: d.toISOString() };
    }
    if (selectedDatePreset === '30d') {
      const d = new Date();
      d.setDate(d.getDate() - 30);
      d.setHours(0, 0, 0, 0);
      return { dateFrom: d.toISOString() };
    }
    return { dateFrom: undefined };
  }, [selectedDatePreset]);

  // tRPC Query
  const {
    data: auditResponse,
    isFetching,
    refetch,
  } = trpc.audit.list.useQuery(
    {
      page,
      pageSize,
      tableName: selectedTable,
      search: search.trim() || undefined,
      dateFrom,
    },
    {
      initialData,
      placeholderData: (prev) => prev,
    }
  );

  const { data: stats } = trpc.audit.stats.useQuery(undefined, {
    initialData: initialStats,
  });

  const items = auditResponse?.items ?? [];
  const total = auditResponse?.pagination?.total ?? 0;

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    toast.success('تم نسخ المعرف إلى الحافظة');
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Export to CSV
  const handleExportCsv = () => {
    if (items.length === 0) {
      toast.error('لا توجد سجلات لتصديرها');
      return;
    }

    const headers = ['المعرف', 'التوقيت', 'المستخدم', 'البريد', 'الدور', 'نوع العملية', 'الكيان', 'معرف السجل', 'الجهاز', 'عنوان IP'];
    const rows = items.map((item) => [
      item.id,
      formatDate(item.createdAt, { withTime: true }),
      `"${item.actor.name}"`,
      `"${item.actor.email || ''}"`,
      `"${item.actor.role}"`,
      `"${item.actionLabelAr} (${item.action})"`,
      `"${item.tableLabelAr} (${item.tableName})"`,
      `"${item.recordId || ''}"`,
      `"${item.client.deviceLabelAr}"`,
      `"${item.client.ipAddress || ''}"`,
    ]);

    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `audit-logs-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success('تم تصدير ملف السجلات بنجاح');
  };

  return (
    <div className="space-y-6">
      {/* Header & Immutable Assurance Notice */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl sm:text-3xl font-bold text-[var(--t1)]">سجلات الرقابة والنشاط</h1>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-950/40 text-emerald-400 border border-emerald-800/40">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              سجل دائم غير قابل للتعديل (Immutable Log)
            </span>
          </div>
          <p className="text-sm text-[var(--t2)] mt-1">
            توثيق كامل لكافة الحركات والتعديلات التي تمت على النظام بالتوقيت، الحساب، الجهاز، والتفاصيل.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-1.5 border-[var(--rim1)] text-xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} />
            تحديث
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCsv}
            className="flex items-center gap-1.5 border-[var(--rim1)] text-xs bg-[var(--surface)] text-[var(--gold)] hover:bg-[var(--gold)]/10"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            تصدير CSV
          </Button>
        </div>
      </div>

      {/* Security Info Card */}
      <div className="p-3.5 rounded-xl border border-blue-900/30 bg-blue-950/20 text-blue-300 text-xs flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <Lock className="w-4 h-4 text-blue-400 shrink-0" />
          <span>
            <strong>معيار الحوكمة والنزاهة:</strong> هذا السجل يعمل بنظام الإضافة فقط (Append-Only) ولا يمكن مسحه أو تعديل أي حركة فيه برمجياً أو يدوياً لضمان الشفافية ومطابقة المعايير المحاسبية.
          </span>
        </div>
        <span className="text-[11px] text-blue-400/80 font-mono">WORM / AUDIT-SECURE</span>
      </div>

      {/* KPI Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl border border-[var(--rim1)] bg-[var(--surface)] shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--t2)] font-medium">إجمالي الحركات الموثقة</span>
            <Database className="w-4 h-4 text-[var(--gold)]" />
          </div>
          <p className="text-2xl font-bold text-[var(--t1)] mt-2">{stats.totalEvents.toLocaleString()}</p>
        </div>

        <div className="p-4 rounded-xl border border-[var(--rim1)] bg-[var(--surface)] shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--t2)] font-medium">عمليات اليوم</span>
            <Activity className="w-4 h-4 text-emerald-400" />
          </div>
          <p className="text-2xl font-bold text-emerald-400 mt-2">{stats.todayEvents.toLocaleString()}</p>
        </div>

        <div className="p-4 rounded-xl border border-[var(--rim1)] bg-[var(--surface)] shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--t2)] font-medium">المشغلون النشطون</span>
            <Users className="w-4 h-4 text-blue-400" />
          </div>
          <p className="text-2xl font-bold text-[var(--t1)] mt-2">{stats.activeOperatorsCount}</p>
        </div>

        <div className="p-4 rounded-xl border border-[var(--rim1)] bg-[var(--surface)] shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--t2)] font-medium">آخر حركة مسجلة</span>
            <Clock className="w-4 h-4 text-purple-400" />
          </div>
          <p className="text-xs font-bold text-[var(--t1)] mt-2 truncate">
            {stats.latestEvent ? formatDate(stats.latestEvent.createdAt, { withTime: true }) : '—'}
          </p>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="p-4 rounded-xl border border-[var(--rim1)] bg-[var(--surface)] space-y-3">
        <div className="flex flex-col sm:flex-row items-center gap-3">
          {/* Free Text Search */}
          <div className="relative flex-1 w-full">
            <Search className="w-4 h-4 text-[var(--t3)] absolute start-3 top-1/2 -translate-y-1/2" />
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="البحث باسم المستخدم، كود العملية، المعرف..."
              className="ps-9 h-9 text-xs bg-[var(--surface2)] border-[var(--rim1)] w-full"
            />
          </div>

          {/* Table / Entity Filter */}
          <div className="w-full sm:w-56">
            <select
              value={selectedTable}
              onChange={(e) => {
                setSelectedTable(e.target.value);
                setPage(1);
              }}
              className="h-9 w-full rounded-md border border-[var(--rim1)] bg-[var(--surface2)] px-3 text-xs text-[var(--t1)] focus:outline-none focus:ring-1 focus:ring-[var(--gold)]"
            >
              {TABLE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Date Presets */}
          <div className="flex bg-[var(--surface2)] p-1 rounded-lg border border-[var(--rim1)] text-xs w-full sm:w-auto justify-center">
            {[
              { id: 'all', label: 'كل الفترات' },
              { id: 'today', label: 'اليوم' },
              { id: '7d', label: 'آخر 7 أيام' },
              { id: '30d', label: 'آخر 30 يوماً' },
            ].map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setSelectedDatePreset(p.id as any);
                  setPage(1);
                }}
                className={`px-2.5 py-1 rounded transition text-xs font-semibold ${
                  selectedDatePreset === p.id
                    ? 'bg-[var(--gold)] text-black shadow-xs'
                    : 'text-[var(--t2)] hover:text-[var(--t1)]'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main Table */}
      <div className="rounded-xl border border-[var(--rim1)] bg-[var(--surface)] overflow-hidden shadow-sm">
        <Table>
          <TableHeader className="bg-[var(--surface2)]/60">
            <TableRow className="border-b border-[var(--rim1)] hover:bg-transparent">
              <TableHead className="w-48 text-start font-bold text-xs text-[var(--t2)]">التوقيت</TableHead>
              <TableHead className="text-start font-bold text-xs text-[var(--t2)]">المستخدم / الحساب</TableHead>
              <TableHead className="text-start font-bold text-xs text-[var(--t2)]">الحركة والعملية</TableHead>
              <TableHead className="text-start font-bold text-xs text-[var(--t2)]">الكيان والمعرف</TableHead>
              <TableHead className="text-start font-bold text-xs text-[var(--t2)]">الجهاز والمتصفح</TableHead>
              <TableHead className="w-24 text-end font-bold text-xs text-[var(--t2)]">التفاصيل</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-48 text-center text-sm text-[var(--t2)]">
                  {isFetching ? 'جاري تحميل السجلات...' : 'لا توجد سجلات مطابقة للبحث أو الفلتر المختار.'}
                </TableCell>
              </TableRow>
            ) : (
              items.map((item) => {
                const deviceIcon =
                  item.client.deviceType === 'mobile' ? (
                    <Smartphone className="w-3.5 h-3.5 text-zinc-400" />
                  ) : item.client.deviceType === 'tablet' ? (
                    <Tablet className="w-3.5 h-3.5 text-zinc-400" />
                  ) : item.client.deviceType === 'desktop' ? (
                    <Laptop className="w-3.5 h-3.5 text-zinc-400" />
                  ) : (
                    <Globe className="w-3.5 h-3.5 text-zinc-400" />
                  );

                return (
                  <TableRow
                    key={item.id}
                    className="border-b border-[var(--rim1)]/60 hover:bg-[var(--surface2)]/40 transition cursor-pointer"
                    onClick={() => setActiveInspectorItem(item)}
                  >
                    {/* Timestamp */}
                    <TableCell className="font-mono text-xs text-[var(--t1)]">
                      <div className="flex flex-col">
                        <span className="font-semibold">{formatDate(item.createdAt, { withTime: true })}</span>
                      </div>
                    </TableCell>

                    {/* Actor */}
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-[var(--rim1)] flex items-center justify-center text-xs font-bold text-[var(--t1)] overflow-hidden">
                          {item.actor.image ? (
                            <img src={item.actor.image} alt={item.actor.name} className="w-full h-full object-cover" />
                          ) : (
                            item.actor.name.slice(0, 1)
                          )}
                        </div>
                        <div className="overflow-hidden">
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-xs text-[var(--t1)] truncate">{item.actor.name}</span>
                            <span
                              className={`text-[10px] px-1.5 py-0.2 rounded font-semibold ${
                                item.actor.role === 'owner'
                                  ? 'bg-[var(--gold)]/20 text-[var(--gold)]'
                                  : item.actor.role === 'admin'
                                  ? 'bg-blue-500/20 text-blue-400'
                                  : 'bg-zinc-800 text-zinc-400'
                              }`}
                            >
                              {item.actor.role === 'owner' ? 'مالك' : item.actor.role === 'admin' ? 'مشرف' : 'عضو'}
                            </span>
                          </div>
                          {item.actor.email && (
                            <span className="text-[11px] text-[var(--t2)] block truncate dir-ltr text-start">
                              {item.actor.email}
                            </span>
                          )}
                        </div>
                      </div>
                    </TableCell>

                    {/* Action */}
                    <TableCell>
                      <div className="space-y-0.5">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold border ${item.actionBadgeClass}`}>
                          {item.actionLabelAr}
                        </span>
                        <div className="font-mono text-[10px] text-[var(--t3)]">{item.action}</div>
                      </div>
                    </TableCell>

                    {/* Entity & Record ID */}
                    <TableCell>
                      <div className="text-xs">
                        <span className="font-bold text-[var(--t1)]">{item.tableLabelAr}</span>
                        {item.recordId && (
                          <div className="flex items-center gap-1 text-[11px] text-[var(--t2)] font-mono mt-0.5">
                            <span className="truncate max-w-[120px]">{item.recordId}</span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleCopy(item.recordId!, item.id);
                              }}
                              className="text-[var(--t3)] hover:text-[var(--gold)] p-0.5"
                              title="نسخ المعرف"
                            >
                              {copiedId === item.id ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                            </button>
                          </div>
                        )}
                      </div>
                    </TableCell>

                    {/* Device & Client */}
                    <TableCell>
                      <div className="flex items-center gap-1.5 text-xs text-[var(--t2)]">
                        {deviceIcon}
                        <div className="overflow-hidden">
                          <span className="block truncate text-[11px]">{item.client.deviceLabelAr}</span>
                          {item.client.ipAddress && (
                            <span className="font-mono text-[10px] text-[var(--t3)] block">{item.client.ipAddress}</span>
                          )}
                        </div>
                      </div>
                    </TableCell>

                    {/* Action Button */}
                    <TableCell className="text-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveInspectorItem(item);
                        }}
                        className="h-7 px-2 text-xs text-[var(--gold)] hover:bg-[var(--gold)]/10"
                        title="فحص تفاصيل الحركة والتغييرات"
                      >
                        <Eye className="w-3.5 h-3.5 ml-1" />
                        التفاصيل
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={setPage}
      />

      {/* Diff & Details Inspector Dialog */}
      <Dialog open={!!activeInspectorItem} onOpenChange={(open) => !open && setActiveInspectorItem(null)}>
        <DialogContent className="sm:max-w-2xl bg-[var(--surface)] text-[var(--t1)] border-[var(--rim1)] max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between gap-2 border-b border-[var(--rim1)] pb-3 text-lg">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-[var(--gold)]" />
                <span>فحص تفاصيل الحركة وتغييرات السجل</span>
              </div>
              {activeInspectorItem && (
                <span className={`text-xs px-2 py-0.5 rounded font-bold border ${activeInspectorItem.actionBadgeClass}`}>
                  {activeInspectorItem.actionLabelAr}
                </span>
              )}
            </DialogTitle>
          </DialogHeader>

          {activeInspectorItem && (
            <div className="flex-1 overflow-y-auto space-y-4 py-2 text-xs">
              {/* Meta Grid */}
              <div className="grid grid-cols-2 gap-3 bg-[var(--surface2)] p-3 rounded-xl border border-[var(--rim1)]">
                <div>
                  <span className="text-[var(--t3)] block">الوقت والتاريخ:</span>
                  <strong className="text-[var(--t1)] font-mono">{formatDate(activeInspectorItem.createdAt, { withTime: true })}</strong>
                </div>
                <div>
                  <span className="text-[var(--t3)] block">المستخدم المنفذ:</span>
                  <strong className="text-[var(--t1)]">{activeInspectorItem.actor.name} ({activeInspectorItem.actor.role})</strong>
                </div>
                <div>
                  <span className="text-[var(--t3)] block">الكيان / الجدول:</span>
                  <strong className="text-[var(--t1)]">{activeInspectorItem.tableLabelAr} ({activeInspectorItem.tableName})</strong>
                </div>
                <div>
                  <span className="text-[var(--t3)] block">معرف السجل:</span>
                  <strong className="text-[var(--t1)] font-mono">{activeInspectorItem.recordId || '—'}</strong>
                </div>
                <div className="col-span-2">
                  <span className="text-[var(--t3)] block">الجهاز وعنوان IP:</span>
                  <span className="text-[var(--t1)] font-mono">{activeInspectorItem.client.deviceLabelAr} | IP: {activeInspectorItem.client.ipAddress || 'غير مسجل'}</span>
                </div>
              </div>

              {/* Changes Inspector */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-sm text-[var(--t1)] flex items-center gap-1.5">
                    <Layers className="w-4 h-4 text-[var(--gold)]" />
                    البيانات والتغييرات التي طرأت:
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      navigator.clipboard.writeText(JSON.stringify(activeInspectorItem.changes, null, 2));
                      toast.success('تم نسخ الـ JSON إلى الحافظة');
                    }}
                    className="h-6 text-[11px] px-2"
                  >
                    <Copy className="w-3 h-3 ml-1" />
                    نسخ JSON
                  </Button>
                </div>

                <div className="p-3 bg-black/80 rounded-xl border border-zinc-800 font-mono text-emerald-400 text-xs overflow-x-auto max-h-64 dir-ltr text-start">
                  <pre>{JSON.stringify(activeInspectorItem.changes, null, 2)}</pre>
                </div>
              </div>

              {/* Immutable Security Certificate */}
              <div className="p-3 rounded-lg bg-emerald-950/20 border border-emerald-800/30 text-emerald-300 text-[11px] flex items-center gap-2">
                <Lock className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>
                  السجل موثق بالرقم التعريفي <strong className="font-mono text-emerald-200">{activeInspectorItem.id}</strong> ومثبت في قاعدة البيانات ولا يمكن تعديله أو حذفه.
                </span>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
