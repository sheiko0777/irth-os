const fs = require('fs');

const path = 'apps/admin/src/server/routers/dashboard.ts';
let code = fs.readFileSync(path, 'utf8');

// Replace Promise.all with single ctx.withOrg
code = code.replace(
    /\] = await Promise\.all\(\[/,
    `] = await ctx.withOrg(async (tx) => { return [`
);

// We need to replace all `ctx.withOrg((tx) =>` with `await` and use the outer `tx` or similar. Wait, it's easier to use replace_with_git_merge_diff.
