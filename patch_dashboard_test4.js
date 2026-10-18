const fs = require('fs');
const path = 'apps/admin/src/__tests__/routers/dashboard.test.ts';
let code = fs.readFileSync(path, 'utf8');

code = code.replace(
    /const spy = vi\.fn\(ownerCtx\.withOrg\);/g,
    'const spy = vi.fn(ownerCtx.withOrg as any) as any;'
);

fs.writeFileSync(path, code);
