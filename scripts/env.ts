import { existsSync } from 'node:fs';
// Node 22 loads environment files without printing or copying their contents.
if (existsSync('.env.local')) process.loadEnvFile('.env.local');
else if (existsSync('.env')) process.loadEnvFile('.env');
