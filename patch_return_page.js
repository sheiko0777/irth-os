const fs = require('fs');
let code = fs.readFileSync('apps/admin/src/app/[locale]/(dashboard)/returns/[id]/page.tsx', 'utf8');

// 1. Add imports
const imports = `import { PermissionGate } from "@/components/PermissionGate";
import { RestockButton } from "./RestockButton";
import { getTranslations } from "next-intl/server";`;
code = code.replace('import { StatusBadge } from \'@/components/ui/StatusBadge\';', `import { StatusBadge } from '@/components/ui/StatusBadge';\n${imports}`);

// 2. Add t
code = code.replace('const { locale, id } = await params;', 'const { locale, id } = await params;\n  const t = await getTranslations("returns");');

// 3. Add RestockButton to items list
const tdOld = `<td className="px-4 py-3">
                          {item.restock ? (
                            <span className="text-[var(--emerald)]">✓ نعم (Yes)</span>
                          ) : (
                            <span className="text-[var(--t2)]">✗ لا (No)</span>
                          )}
                        </td>`;

const tdNew = `<td className="px-4 py-3">
                          {item.restock ? (
                            <span className="text-[var(--emerald)]">{t("restocked")}</span>
                          ) : (
                            <div className="flex items-center gap-2">
                                <PermissionGate resource="returns" action="write">
                                    <RestockButton returnId={returnObj.id} itemId={item.id} />
                                </PermissionGate>
                                {(item.condition === 'damaged' || item.condition === 'unknown') && (
                                    <span className="text-xs text-[var(--warning)]">{t("conditionHint")}</span>
                                )}
                            </div>
                          )}
                        </td>`;

code = code.replace(tdOld, tdNew);

fs.writeFileSync('apps/admin/src/app/[locale]/(dashboard)/returns/[id]/page.tsx', code);
