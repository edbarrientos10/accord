import './env';
const required = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'ACCORD_ORIGIN',
  'SUPABASE_PROJECT_REF',
  'VERCEL_ORG_ID',
  'VERCEL_PROJECT_ID',
];
let missing = false;
for (const key of required) {
  const present = Boolean(process.env[key]);
  console.log(`${key}: ${present ? 'configured' : 'missing'}`);
  missing ||= !present;
}
console.log(
  `ACCORD_DEMO: ${process.env.ACCORD_DEMO === 'true' ? 'enabled; real-workspace access disabled' : 'disabled'}`,
);
if (missing) process.exitCode = 1;
