const fs = require('fs');
const path = 'apps/admin/src/__tests__/routers/dashboard.test.ts';
let code = fs.readFileSync(path, 'utf8');

code = code.replace(
    /vi\.mocked\(withOrgMock\)\.mockClear\(\);/g,
    '// we cannot use vi.mocked here easily, so let\'s use type casting\n    ;(withOrgMock as unknown as ReturnType<typeof vi.fn>).mockClear?.();\n    ;(withOrgMock as any).mockClear?.();'
);

fs.writeFileSync(path, code);
