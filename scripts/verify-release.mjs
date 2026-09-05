import { verifyInstallers } from './release-contract.mjs';
await verifyInstallers('release', process.env.RELEASE_VERSION, process.env.RELEASE_PLATFORM || null);
console.log('All expected installer files exist and are nonempty.');
