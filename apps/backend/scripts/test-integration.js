if (!process.env.TEST_DATABASE_URL) {
  console.error('TEST_DATABASE_URL is required; use a disposable PostgreSQL database.');
  process.exit(1);
}
const { spawnSync } = require('child_process');
const result = spawnSync(process.execPath, [require.resolve('jest/bin/jest'), '--runInBand'], { stdio: 'inherit', env: process.env });
process.exit(result.status ?? 1);
