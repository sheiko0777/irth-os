'use client';

import { useState, type FormEvent } from "react";
import { FormDialog } from "@/components/ui/FormDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  PRINCIPAL_KIND_LABELS, RESOURCE_LABELS, actionLabel, catalog,
} from "@/lib/permissionCatalog";

export type PrincipalKind = keyof typeof PRINCIPAL_KIND_LABELS;
export type PermissionList = Record<string, string[]>;

export interface RoleDraft {
  name: string;
  principalKind: PrincipalKind;
  permissions: PermissionList;
}

interface RoleEditorProps {
  open: boolean;
  title: string;
  initial: RoleDraft;
  /** System roles are shown read-only: their list is the code matrix. */
  readOnly?: boolean;
  pending?: boolean;
  error?: string | null;
  onClose: () => void;
  onSave: (draft: RoleDraft) => void;
}

const key = (resource: string, action: string) => `${resource}.${action}`;

function toSet(list: PermissionList): Set<string> {
  return new Set(Object.entries(list).flatMap(([r, actions]) => actions.map((a) => key(r, a))));
}

function toList(set: Set<string>): PermissionList {
  const out: PermissionList = {};
  for (const k of set) {
    const [resource, action] = k.split(".");
    (out[resource] ??= []).push(action);
  }
  return out;
}

/** Name, kind and the screen × action matrix of one role. */
export function RoleEditor({ open, title, initial, readOnly, pending, error, onClose, onSave }: RoleEditorProps) {
  const [name, setName] = useState(initial.name);
  const [principalKind, setPrincipalKind] = useState<PrincipalKind>(initial.principalKind);
  const [perms, setPerms] = useState(() => toSet(initial.permissions));

  const toggle = (k: string) => setPerms((prev) => {
    const next = new Set(prev);
    if (next.has(k)) next.delete(k); else next.add(k);
    return next;
  });

  const toggleRow = (resource: string, actions: string[]) => setPerms((prev) => {
    const next = new Set(prev);
    const all = actions.every((a) => next.has(key(resource, a)));
    for (const a of actions) {
      if (all) next.delete(key(resource, a)); else next.add(key(resource, a));
    }
    return next;
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSave({ name: name.trim(), principalKind, permissions: toList(perms) });
  };

  return (
    <FormDialog open={open} title={title} onClose={onClose} width="760px">
      <form onSubmit={submit} className="space-y-4" aria-busy={pending}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="role-name">اسم الدور</Label>
            <Input
              id="role-name"
              value={name}
              maxLength={60}
              required
              disabled={readOnly}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="role-kind">نوع الحساب</Label>
            <select
              id="role-kind"
              className="h-11 w-full rounded-md border border-[var(--input-border)] bg-[var(--surface)] px-3 text-sm"
              value={principalKind}
              disabled={readOnly}
              onChange={(e) => setPrincipalKind(e.target.value as PrincipalKind)}
            >
              {(Object.keys(PRINCIPAL_KIND_LABELS) as PrincipalKind[]).map((k) => (
                <option key={k} value={k}>{PRINCIPAL_KIND_LABELS[k]}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="overflow-x-auto rounded-md border border-[var(--rim1)]">
          <table className="w-full text-sm">
            <caption className="sr-only">صلاحيات الدور لكل شاشة</caption>
            <thead className="bg-[var(--raised)] text-[var(--t2)]">
              <tr>
                <th scope="col" className="px-3 py-2 text-start font-medium">الشاشة</th>
                <th scope="col" className="px-3 py-2 text-start font-medium">العمليات</th>
              </tr>
            </thead>
            <tbody>
              {catalog().map(({ resource, actions }) => {
                const all = actions.every((a) => perms.has(key(resource, a)));
                return (
                  <tr key={resource} className="border-t border-[var(--rim1)]">
                    <th scope="row" className="px-3 py-2 text-start font-medium">
                      <label className="inline-flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={all}
                          disabled={readOnly}
                          onChange={() => toggleRow(resource, actions)}
                          aria-label={`كل صلاحيات ${RESOURCE_LABELS[resource]}`}
                        />
                        {RESOURCE_LABELS[resource]}
                      </label>
                    </th>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-x-4 gap-y-1">
                        {actions.map((action) => (
                          <label key={action} className="inline-flex items-center gap-1.5">
                            <input
                              type="checkbox"
                              checked={perms.has(key(resource, action))}
                              disabled={readOnly}
                              onChange={() => toggle(key(resource, action))}
                              aria-label={`${RESOURCE_LABELS[resource]}: ${actionLabel(resource, action)}`}
                            />
                            {actionLabel(resource, action)}
                          </label>
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {error && <p role="alert" className="text-sm text-[var(--critical)]">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {readOnly ? "إغلاق" : "إلغاء"}
          </Button>
          {!readOnly && (
            <Button type="submit" disabled={pending || name.trim() === ""}>
              {pending ? "جارٍ الحفظ…" : "حفظ الدور"}
            </Button>
          )}
        </div>
      </form>
    </FormDialog>
  );
}
