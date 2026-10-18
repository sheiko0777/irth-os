import { canAccess, effectiveAccess } from '@irth/db';

const access = effectiveAccess({ systemKey: 'member' });
console.log(canAccess(access, 'dashboard', 'view'));

const adminAccess = effectiveAccess({ systemKey: 'admin' });
console.log(canAccess(adminAccess, 'dashboard', 'view'));
