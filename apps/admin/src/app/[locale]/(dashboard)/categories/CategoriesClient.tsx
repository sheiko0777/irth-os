'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { EmptyState } from '@/components/ui/EmptyState';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PermissionGate } from '@/components/PermissionGate';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { FormDialog } from '@/components/ui/FormDialog';
import { toast } from 'sonner';

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
    const t = useTranslations('categories');
    const utils = trpc.useUtils();
    
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [name, setName] = useState('');
    const [slug, setSlug] = useState('');
    const [parentId, setParentId] = useState<string>('');

    const createMutation = trpc.categories.create.useMutation({
        onSuccess: () => {
            toast.success(t('toasts.added'));
            utils.categories.list.invalidate();
            setIsModalOpen(false);
            setName('');
            setSlug('');
            setParentId('');
        },
        onError: (err: unknown) => {
            toast.error(err instanceof Error ? err.message : t('errors.addCategory'));
        }
    });

    const deleteMutation = trpc.categories.delete.useMutation({
        onSuccess: () => {
            toast.success(t('toasts.deleted'));
            utils.categories.list.invalidate();
        },
        onError: (err: unknown) => {
            toast.error(err instanceof Error ? err.message : t('errors.deleteCategory'));
        }
    });

    const handleNameChange = (e: { target: { value: string } }) => {
        const val = e.target.value;
        setName(val);
        setSlug(val.toLowerCase().replace(/\s+/g, '-'));
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
        if (!parentId) return t('table.noParent');
        const parent = categories.find(c => c.id === parentId);
        return parent ? parent.name : t('table.noParent');
    };

    return (
        <div>
            <div className="flex justify-between items-center mb-6">
                <PermissionGate resource="categories" action="write">
                    <Button onClick={() => setIsModalOpen(true)}>{t('actions.add')}</Button>
                </PermissionGate>
            </div>

            <div className="rounded-md border bg-[var(--surface)] border-[var(--rim1)]">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="text-start">{t('table.name')}</TableHead>
                            <TableHead className="text-start">{t('table.slug')}</TableHead>
                            <TableHead className="text-start">{t('table.parent')}</TableHead>
                            <TableHead className="text-start">{t('table.actions')}</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {categories.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={4} className="p-0"><EmptyState title={t('empty.title')} hint={t('empty.hint')} /></TableCell>
                            </TableRow>
                        ) : (
                            categories.map(category => (
                                <TableRow key={category.id}>
                                    <TableCell className="font-medium text-[var(--t1)]">{category.name}</TableCell>
                                    <TableCell className="text-[var(--t2)]">{category.slug}</TableCell>
                                    <TableCell className="text-[var(--t2)]">{getParentName(category.parentId)}</TableCell>
                                    <TableCell>
                                        <PermissionGate resource="categories" action="delete">
                                            <ConfirmDialog
                                                title={t('confirm.deleteTitle')}
                                                description={t('confirm.deleteDescription', { name: category.name })}
                                                confirmLabel={t('actions.delete')}
                                                pending={deleteMutation.isPending}
                                                onConfirm={() => deleteMutation.mutate({ id: category.id })}
                                            >
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="text-[var(--crimson)] hover:text-[var(--crimson)]"
                                                    disabled={deleteMutation.isPending}
                                                >
                                                    {t('actions.delete')}
                                                </Button>
                                            </ConfirmDialog>
                                        </PermissionGate>
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </div>

            <FormDialog open={isModalOpen} onClose={() => setIsModalOpen(false)} title={t('form.title')} width="448px">
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <Label htmlFor="name" className="text-[var(--t1)]">{t('form.name')}</Label>
                        <Input
                            id="name"
                            value={name}
                            onChange={handleNameChange}
                            required
                            className="mt-1"
                        />
                    </div>

                    <div>
                        <Label htmlFor="slug" className="text-[var(--t1)]">{t('form.slug')}</Label>
                        <Input
                            id="slug"
                            value={slug}
                            onChange={(e) => setSlug(e.target.value)}
                            required
                            className="mt-1"
                        />
                    </div>

                    <div>
                        <Label htmlFor="parentId" className="text-[var(--t1)]">{t('form.parentOptional')}</Label>
                        <select
                            id="parentId"
                            value={parentId}
                            onChange={(e) => setParentId(e.target.value)}
                            className="w-full mt-1 p-2 border rounded-md border-[var(--rim1)] bg-[var(--surface)] text-[var(--t1)]"
                        >
                            <option value="">{t('form.noParent')}</option>
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
                            {t('actions.cancel')}
                        </Button>
                        <Button 
                            type="submit"
                            disabled={createMutation.isPending}
                        >
                            {createMutation.isPending ? t('form.adding') : t('actions.add')}
                        </Button>
                    </div>
                </form>
            </FormDialog>
        </div>
    );
}
