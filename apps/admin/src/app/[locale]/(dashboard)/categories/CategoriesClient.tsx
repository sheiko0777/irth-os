'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PermissionGate } from '@/components/PermissionGate';

export interface Category {
    id: string;
    name: string;
    slug: string;
    parentId: string | null;
    createdAt: Date | string | null;
}

interface CategoriesClientProps {
    categories: Category[];
}

export function CategoriesClient({ categories }: CategoriesClientProps) {
    const utils = trpc.useUtils();
    
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [name, setName] = useState('');
    const [slug, setSlug] = useState('');
    const [parentId, setParentId] = useState<string>('');

    const createMutation = trpc.categories.create.useMutation({
        onSuccess: () => {
            utils.categories.list.invalidate();
            setIsModalOpen(false);
            setName('');
            setSlug('');
            setParentId('');
        }
    });

    const deleteMutation = trpc.categories.delete.useMutation({
        onSuccess: () => {
            utils.categories.list.invalidate();
        }
    });

    const handleNameChange = (e: { target: { value: string } }) => {
        const val = e.target.value;
        setName(val);
        setSlug(val.toLowerCase().replace(/\s+/g, '-'));
    };

    const handleDelete = (id: string) => {
        if (confirm('هل أنت متأكد من حذف هذه الفئة؟')) {
            deleteMutation.mutate({ id });
        }
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        createMutation.mutate({
            name,
            slug,
            parentId: parentId || undefined
        });
    };

    const getParentName = (parentId: string | null) => {
        if (!parentId) return '-';
        const parent = categories.find(c => c.id === parentId);
        return parent ? parent.name : '-';
    };

    return (
        <div className="font-cairo" dir="rtl">
            <div className="flex justify-between items-center mb-6">
                <PermissionGate resource="categories" action="write">
                    <Button onClick={() => setIsModalOpen(true)}>إضافة فئة</Button>
                </PermissionGate>
            </div>

            <div className="rounded-md border bg-[var(--surface)] border-[var(--rim1)]">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="text-right">الاسم</TableHead>
                            <TableHead className="text-right">الرابط (Slug)</TableHead>
                            <TableHead className="text-right">الفئة الأب</TableHead>
                            <TableHead className="text-right">الإجراءات</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {categories.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={4} className="text-center text-[var(--t2)] py-8">
                                    لا توجد فئات
                                </TableCell>
                            </TableRow>
                        ) : (
                            categories.map(category => (
                                <TableRow key={category.id}>
                                    <TableCell className="font-medium text-[var(--t1)]">{category.name}</TableCell>
                                    <TableCell className="text-[var(--t2)]">{category.slug}</TableCell>
                                    <TableCell className="text-[var(--t2)]">{getParentName(category.parentId)}</TableCell>
                                    <TableCell>
                                        <PermissionGate resource="categories" action="delete">
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => handleDelete(category.id)}
                                                className="text-[var(--crimson)] hover:text-[var(--crimson)] hover:bg-red-50"
                                                disabled={deleteMutation.isPending}
                                            >
                                                حذف
                                            </Button>
                                        </PermissionGate>
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </div>

            {isModalOpen && (
                <div 
                    className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center"
                    onClick={(e) => {
                        if (e.target === e.currentTarget) setIsModalOpen(false);
                    }}
                >
                    <div className="bg-[var(--surface)] p-6 rounded-lg shadow-lg w-full max-w-md" dir="rtl">
                        <h2 className="text-xl font-bold mb-4 text-[var(--t1)]">إضافة فئة جديدة</h2>
                        
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div>
                                <Label htmlFor="name" className="text-[var(--t1)]">الاسم</Label>
                                <Input
                                    id="name"
                                    value={name}
                                    onChange={handleNameChange}
                                    required
                                    className="mt-1"
                                />
                            </div>

                            <div>
                                <Label htmlFor="slug" className="text-[var(--t1)]">الرابط (Slug)</Label>
                                <Input
                                    id="slug"
                                    value={slug}
                                    onChange={(e) => setSlug(e.target.value)}
                                    required
                                    className="mt-1"
                                />
                            </div>

                            <div>
                                <Label htmlFor="parentId" className="text-[var(--t1)]">الفئة الأب (اختياري)</Label>
                                <select
                                    id="parentId"
                                    value={parentId}
                                    onChange={(e) => setParentId(e.target.value)}
                                    className="w-full mt-1 p-2 border rounded-md border-[var(--rim1)] bg-[var(--surface)] text-[var(--t1)]"
                                >
                                    <option value="">لا يوجد</option>
                                    {categories.map(c => (
                                        <option key={c.id} value={c.id}>{c.name}</option>
                                    ))}
                                </select>
                            </div>

                            <div className="flex justify-end gap-2 mt-6">
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => setIsModalOpen(false)}
                                >
                                    إلغاء
                                </Button>
                                <Button 
                                    type="submit"
                                    disabled={createMutation.isPending}
                                >
                                    {createMutation.isPending ? 'جاري الإضافة...' : 'إضافة'}
                                </Button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
