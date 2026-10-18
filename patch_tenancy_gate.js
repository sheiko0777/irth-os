const fs = require('fs');

const path = 'apps/admin/src/__tests__/tenancyGate.test.ts';
let code = fs.readFileSync(path, 'utf8');

// Remove 'dashboard.ts:171', from UNSCOPED_READ_BASELINE
code = code.replace(
    /\s*'dashboard\.ts:171',/g,
    ''
);

fs.writeFileSync(path, code);
