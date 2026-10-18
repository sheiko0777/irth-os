const fs = require('fs');

const path = 'apps/admin/src/server/routers/dashboard.ts';
let code = fs.readFileSync(path, 'utf8');

// Replace getStats
code = code.replace(
    /\/\/ Batch independent queries — O\(max latency\) instead of O\(n × latency\)[\s\S]*?\] = await Promise\.all\(\[([\s\S]*?)\]\);/,
    (match, inner) => {
        let newInner = inner.replace(/ctx\.withOrg\(\(tx\) => /g, 'await ');
        newInner = newInner.replace(/\)\),/g, '),');
        newInner = newInner.replace(/\)\)/g, ')');
        return `] = await ctx.withOrg(async (tx) => {
            return [\n${newInner}\n            ] as const;
        });`;
    }
);

// Replace getAlerts
code = code.replace(
    /const \[lateOrdersQuery, outOfStockQuery, pendingReturnsQuery\] = await Promise\.all\(\[([\s\S]*?)\]\);/,
    (match, inner) => {
        let newInner = inner.replace(/ctx\.withOrg\(\(tx\) => /g, 'await ');
        newInner = newInner.replace(/ctx\.db/g, 'await tx');
        newInner = newInner.replace(/\)\),/g, '),');
        newInner = newInner.replace(/\)\)/g, ')');
        return `const [lateOrdersQuery, outOfStockQuery, pendingReturnsQuery] = await ctx.withOrg(async (tx) => {
            return [\n${newInner}\n            ] as const;
        });`;
    }
);

fs.writeFileSync(path, code);
