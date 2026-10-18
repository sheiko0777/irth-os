const fs = require('fs');
let code = fs.readFileSync('apps/admin/src/app/[locale]/(dashboard)/orders/[id]/CreateReturnDialog.tsx', 'utf8');

code = code.replace('router.push(`/${locale}/returns/${data.id}`);', 'router.push(`/${locale}/returns/${data.data.id}`);');

fs.writeFileSync('apps/admin/src/app/[locale]/(dashboard)/orders/[id]/CreateReturnDialog.tsx', code);
