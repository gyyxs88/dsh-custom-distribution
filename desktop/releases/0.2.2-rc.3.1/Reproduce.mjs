import { reproduceFixedSupplements } from '../../reproduce-fixed-supplements.mjs';

console.log(JSON.stringify(reproduceFixedSupplements('0.2.2-rc.3.1', ...process.argv.slice(2)), null, 2));
