const fs = require('fs');
const path = 'apps/admin/src/__tests__/routers/dashboard.test.ts';
let code = fs.readFileSync(path, 'utf8');

// Find a place to insert the test
const insertBefore = "  it('getStats: yields zeroed stats when db is empty', async () => {";

const testCode = `
  it('calls ctx.withOrg exactly once per procedure', async () => {
    mockDb.select = vi.fn(() => chainOf([]));

    vi.mocked(withOrgMock).mockClear();
    await caller.getStats();
    expect(withOrgMock).toHaveBeenCalledTimes(1);

    vi.mocked(withOrgMock).mockClear();
    await caller.getAlerts();
    expect(withOrgMock).toHaveBeenCalledTimes(1);
  });
`;

code = code.replace(insertBefore, testCode + '\n' + insertBefore);
fs.writeFileSync(path, code);
