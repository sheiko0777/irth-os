'use client';

import { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { formatMoney, fromMinor } from '@irth/domain';
import { generateQrSvg, generateQrDataUrl } from '@/lib/qr';
import { trpc } from '@/lib/trpc';
import { Printer, Download, QrCode, Tag, MapPin } from 'lucide-react';

export interface ProductQrItem {
  id: string;
  name: string;
  nameAr?: string | null;
  sku: string;
  priceMinor?: bigint | number | null;
  brand?: string | null;
  binLocation?: string | null;
}

export interface ProductVariantQrItem {
  id: string;
  name: string;
  sku: string;
  priceMinor?: bigint | number | null;
  binLocation?: string | null;
}

interface ProductQrDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: ProductQrItem | null;
  variants?: ProductVariantQrItem[];
}

export function ProductQrDialog({
  open,
  onOpenChange,
  product,
  variants = [],
}: ProductQrDialogProps) {
  const [selectedSku, setSelectedSku] = useState<string>('');
  const [labelSize, setLabelSize] = useState<'50x30' | '40x25' | 'a4'>('50x30');

  // Active item determined by selection
  const activeItem = useMemo(() => {
    if (!product) return null;
    if (selectedSku && selectedSku !== product.sku) {
      const v = variants.find((item) => item.sku === selectedSku);
      if (v) {
        return {
          name: `${product.name} - ${v.name}`,
          nameAr: product.nameAr ? `${product.nameAr} - ${v.name}` : undefined,
          sku: v.sku,
          priceMinor: v.priceMinor ?? product.priceMinor,
          brand: product.brand || 'IRTH',
          binLocation: v.binLocation ?? null,
        };
      }
    }
    return {
      name: product.name,
      nameAr: product.nameAr,
      sku: product.sku,
      priceMinor: product.priceMinor,
      brand: product.brand || 'IRTH',
      binLocation: product.binLocation ?? null,
    };
  }, [product, selectedSku, variants]);

  const currentSku = activeItem?.sku ?? '';

  const { data: lookupData } = trpc.inventory.lookupByBarcode.useQuery(
    { code: currentSku },
    { enabled: !!open && !!currentSku }
  );

  const binLocation = activeItem?.binLocation ?? lookupData?.item?.binLocation ?? null;

  const qrSvg = useMemo(() => {
    if (!currentSku) return '';
    return generateQrSvg(currentSku, 4, 2);
  }, [currentSku]);

  if (!product || !activeItem) return null;

  const currentPriceFormatted =
    activeItem.priceMinor != null
      ? `${fromMinor(BigInt(activeItem.priceMinor)).toString()} ج.م`
      : '';

  const handleDownload = () => {
    const dataUrl = generateQrDataUrl(currentSku);
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `qr-${currentSku}.svg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handlePrint = () => {
    const printWindow = window.open('', '_blank', 'width=600,height=600');
    if (!printWindow) return;

    const sizeCss =
      labelSize === '50x30'
        ? '@page { size: 50mm 30mm; margin: 0; } body { width: 50mm; height: 30mm; }'
        : labelSize === '40x25'
        ? '@page { size: 40mm 25mm; margin: 0; } body { width: 40mm; height: 25mm; }'
        : '@page { size: auto; margin: 10mm; } body { width: 60mm; margin: auto; }';

    printWindow.document.write(`
      <!DOCTYPE html>
      <html dir="rtl" lang="ar">
        <head>
          <meta charset="utf-8" />
          <title>ملصق باركود - ${currentSku}</title>
          <style>
            ${sizeCss}
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body {
              font-family: system-ui, -apple-system, sans-serif;
              display: flex;
              align-items: center;
              justify-content: center;
              background: #fff;
              color: #000;
              padding: 2mm;
            }
            .label-card {
              width: 100%;
              height: 100%;
              display: flex;
              flex-direction: row;
              align-items: center;
              justify-content: space-between;
              border: 1px dashed #ccc;
              padding: 2mm;
              gap: 2mm;
            }
            .info-col {
              flex: 1;
              display: flex;
              flex-direction: column;
              justify-content: space-between;
              height: 100%;
              overflow: hidden;
            }
            .brand {
              font-size: 8pt;
              font-weight: 800;
              letter-spacing: 0.5px;
              color: #333;
            }
            .name {
              font-size: 8.5pt;
              font-weight: 700;
              line-height: 1.1;
              margin: 1mm 0;
              display: -webkit-box;
              -webkit-line-clamp: 2;
              -webkit-box-orient: vertical;
              overflow: hidden;
            }
            .sku {
              font-family: monospace;
              font-size: 7.5pt;
              font-weight: 600;
              letter-spacing: 0.5px;
              direction: ltr;
              text-align: right;
            }
            .bin-location {
              font-family: system-ui, -apple-system, sans-serif;
              font-size: 7pt;
              font-weight: 700;
              color: #111;
              background: #f1f1f1;
              padding: 0.5mm 1.5mm;
              border-radius: 1mm;
              display: inline-block;
              margin-top: 0.5mm;
            }
            .price {
              font-size: 9pt;
              font-weight: 800;
              color: #000;
            }
            .qr-col {
              width: 24mm;
              height: 24mm;
              display: flex;
              align-items: center;
              justify-content: center;
              flex-shrink: 0;
            }
            .qr-col svg {
              width: 100%;
              height: 100%;
            }
            @media print {
              .label-card { border: none; }
            }
          </style>
        </head>
        <body>
          <div class="label-card">
            <div class="info-col">
              <div>
                <div class="brand">${activeItem.brand || 'IRTH'}</div>
                <div class="name">${activeItem.nameAr || activeItem.name}</div>
              </div>
              <div>
                <div class="sku">${currentSku}</div>
                ${binLocation ? `<div class="bin-location">الرف: ${binLocation}</div>` : ''}
                ${currentPriceFormatted ? `<div class="price">${currentPriceFormatted}</div>` : ''}
              </div>
            </div>
            <div class="qr-col">
              ${qrSvg}
            </div>
          </div>
          <script>
            window.onload = function() {
              window.print();
              setTimeout(function() { window.close(); }, 500);
            };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-[var(--surface)] text-[var(--t1)] border-[var(--rim1)]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <QrCode className="w-5 h-5 text-[var(--gold)]" />
            رمز QR وملصق الباركود للمنتج
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-3">
          {/* Variant selection if available */}
          {variants.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs text-[var(--t2)]">اختر الصنف / المتغير</Label>
              <Select
                value={selectedSku || product.sku}
                onValueChange={(val) => setSelectedSku(val)}
              >
                <SelectTrigger className="w-full bg-[var(--surface2)] border-[var(--rim1)] text-start">
                  <SelectValue placeholder="المنتج الأساسي" />
                </SelectTrigger>
                <SelectContent className="bg-[var(--surface)] border-[var(--rim1)]">
                  <SelectItem value={product.sku}>
                    المنتج الأساسي ({product.sku})
                  </SelectItem>
                  {variants.map((v) => (
                    <SelectItem key={v.id} value={v.sku}>
                      {v.name} ({v.sku})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Size selection */}
          <div className="space-y-1.5">
            <Label className="text-xs text-[var(--t2)]">مقاس الاستيكر / الطباعة</Label>
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <button
                type="button"
                onClick={() => setLabelSize('50x30')}
                className={`p-2 rounded-lg border transition ${
                  labelSize === '50x30'
                    ? 'border-[var(--gold)] bg-[var(--gold)]/10 text-[var(--gold)] font-bold'
                    : 'border-[var(--rim1)] text-[var(--t2)] hover:border-[var(--t2)]'
                }`}
              >
                50 × 30 مم
                <span className="block text-[10px] opacity-70">قياسي مخازن</span>
              </button>
              <button
                type="button"
                onClick={() => setLabelSize('40x25')}
                className={`p-2 rounded-lg border transition ${
                  labelSize === '40x25'
                    ? 'border-[var(--gold)] bg-[var(--gold)]/10 text-[var(--gold)] font-bold'
                    : 'border-[var(--rim1)] text-[var(--t2)] hover:border-[var(--t2)]'
                }`}
              >
                40 × 25 مم
                <span className="block text-[10px] opacity-70">صغير للملابس</span>
              </button>
              <button
                type="button"
                onClick={() => setLabelSize('a4')}
                className={`p-2 rounded-lg border transition ${
                  labelSize === 'a4'
                    ? 'border-[var(--gold)] bg-[var(--gold)]/10 text-[var(--gold)] font-bold'
                    : 'border-[var(--rim1)] text-[var(--t2)] hover:border-[var(--t2)]'
                }`}
              >
                ورق A4
                <span className="block text-[10px] opacity-70">طابعة عادية</span>
              </button>
            </div>
          </div>

          {/* Label Preview Card */}
          <div className="p-4 rounded-xl border border-[var(--rim1)] bg-white text-black shadow-inner">
            <div className="flex items-center justify-between gap-3">
              <div className="flex-1 space-y-1 overflow-hidden">
                <div className="flex items-center gap-1.5">
                  <Tag className="w-3.5 h-3.5 text-zinc-600" />
                  <span className="text-[11px] font-black uppercase tracking-wider text-zinc-700">
                    {activeItem.brand || 'IRTH'}
                  </span>
                </div>
                <h4 className="font-bold text-sm text-zinc-900 leading-snug line-clamp-2">
                  {activeItem.nameAr || activeItem.name}
                </h4>
                <div className="font-mono text-xs font-semibold text-zinc-600 dir-ltr text-start">
                  SKU: {currentSku}
                </div>
                {binLocation && (
                  <div className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded w-fit">
                    <MapPin className="w-3 h-3 text-amber-600" />
                    <span>الرف: {binLocation}</span>
                  </div>
                )}
                {currentPriceFormatted && (
                  <div className="text-base font-extrabold text-black pt-1">
                    {currentPriceFormatted}
                  </div>
                )}
              </div>

              {/* QR Render */}
              <div
                className="w-24 h-24 p-1 bg-white border border-zinc-200 rounded flex-shrink-0 flex items-center justify-center"
                dangerouslySetInnerHTML={{ __html: qrSvg }}
              />
            </div>
          </div>
        </div>

        <DialogFooter className="flex flex-row items-center justify-between sm:justify-between gap-2 border-t border-[var(--rim1)] pt-3">
          <Button
            variant="outline"
            size="sm"
            onClick={handleDownload}
            className="flex items-center gap-1.5 border-[var(--rim1)] text-[var(--t2)] hover:text-[var(--t1)]"
          >
            <Download className="w-4 h-4" />
            تنزيل الصورة
          </Button>

          <Button
            size="sm"
            onClick={handlePrint}
            style={{ background: 'var(--gold)', color: 'var(--void)' }}
            className="flex items-center gap-1.5 font-bold"
          >
            <Printer className="w-4 h-4" />
            طباعة الملصق الآن
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
