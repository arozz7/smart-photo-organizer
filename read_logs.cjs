const fs = require('fs');
const path = require('path');
const os = require('os');

const logPath = path.join(os.homedir(), 'AppData', 'Roaming', 'smart-photo-organizer', 'logs', 'main.log');

console.log('Reading logs from:', logPath);

try {
    if (fs.existsSync(logPath)) {
        const content = fs.readFileSync(logPath, 'utf8');
        const lines = content.split('\n');

        // Just dump the last 200 lines
        const lastLines = lines.slice(-200);
        console.log('--- LAST 200 LINES ---');
        console.log(lastLines.join('\n'));
        console.log('--- END LOGS ---');
    } else {
        console.log('Log file not found.');
    }
} catch (e) {
    console.error('Error reading log:', e);
}
