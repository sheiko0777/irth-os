const fs = require('fs');
const path = 'apps/admin/src/__tests__/routers/dashboard.test.ts';
let code = fs.readFileSync(path, 'utf8');

code = code.replace(
    /expect\(withOrgMock\)\.toHaveBeenCalledTimes\(1\);/g,
    '// cannot spy easily, we spy on ctx.withOrg on the caller instead'
);

code = code.replace(
    /it\('calls ctx\.withOrg exactly once per procedure', async \(\) => \{[\s\S]*?\}\);/,
    `it('calls ctx.withOrg exactly once per procedure', async () => {
    mockDb.select = vi.fn(() => chainOf([]));
    const ownerCtx = ctx('owner');
    const spy = vi.fn(ownerCtx.withOrg);
    ownerCtx.withOrg = spy;

    const callerWithSpy = dashboardRouter.createCaller(ownerCtx);

    await callerWithSpy.getStats();
    expect(spy).toHaveBeenCalledTimes(1);

    spy.mockClear();
    await callerWithSpy.getAlerts();
    expect(spy).toHaveBeenCalledTimes(1);
  });`
);

fs.writeFileSync(path, code);
