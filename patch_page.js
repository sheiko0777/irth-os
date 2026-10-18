const fs = require('fs');
let code = fs.readFileSync('apps/admin/src/app/[locale]/(dashboard)/orders/[id]/page.tsx', 'utf8');

// 1. Add imports
const imports = `import { PermissionGate } from "@/components/PermissionGate";
import { CreateReturnDialog } from "./CreateReturnDialog";`;
code = code.replace('import { BlockedImportPanel } from "./BlockedImportPanel";', `import { BlockedImportPanel } from "./BlockedImportPanel";\n${imports}`);

// 2. Add CreateReturnDialog for delivered orders
const returnDialogCode = `
            {order.status === "delivered" && (
                <PermissionGate resource="returns" action="write">
                    <div className="flex justify-end mb-4">
                        <CreateReturnDialog
                            orderId={order.id}
                            items={items.map(i => ({ id: i.id, sku: i.sku, quantity: i.quantity, returnedQuantity: 0 }))}
                            locale={locale}
                        />
                    </div>
                </PermissionGate>
            )}`;

code = code.replace('            <div className="grid gap-6 md:grid-cols-2">', `${returnDialogCode}\n\n            <div className="grid gap-6 md:grid-cols-2">`);

fs.writeFileSync('apps/admin/src/app/[locale]/(dashboard)/orders/[id]/page.tsx', code);
