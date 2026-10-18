import config from './apps/admin/next.config.ts';
console.log(typeof config);
if (typeof config === 'function') {
  console.log(await config('phase-export', {}));
} else {
  console.log(config);
}
