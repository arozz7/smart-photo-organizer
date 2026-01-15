import { test } from 'vitest';
import fs from 'fs';
test('debug abi', () => {
    const info = `VITEST NODE VERSION: ${process.version}\nVITEST ABI: ${process.versions.modules}\nVITEST EXEC PATH: ${process.execPath}\n`;
    fs.writeFileSync('vitest_env.txt', info);
});
