
const fs = require('fs');
const path = require('path');

const BACKUP_FILE = 'j:/Projects/smart-photo-organizer/electron/main.ts.bak';
const IPC_DIR = 'j:/Projects/smart-photo-organizer/electron/ipc';

function extractHandlers(filePath) {
    if (!fs.existsSync(filePath)) return new Set();
    const content = fs.readFileSync(filePath, 'utf8');
    const handlers = new Set();
    const regex = /ipcMain\.(handle|on)\s*\(\s*['"]([^'"]+)['"]/g;
    let match;
    while ((match = regex.exec(content)) !== null) {
        handlers.add(match[2]);
    }
    return handlers;
}

const oldHandlers = extractHandlers(BACKUP_FILE);

let newHandlers = new Set();
const files = fs.readdirSync(IPC_DIR);
for (const file of files) {
    if (file.endsWith('.ts')) {
        const fileHandlers = extractHandlers(path.join(IPC_DIR, file));
        fileHandlers.forEach(h => newHandlers.add(h));
    }
}

const MAIN_FILE = 'j:/Projects/smart-photo-organizer/electron/main.ts';
if (fs.existsSync(MAIN_FILE)) {
    const mainHandlers = extractHandlers(MAIN_FILE);
    mainHandlers.forEach(h => newHandlers.add(h));
}

console.log('--- ANALYSIS RESULT ---');
console.log(`Old Handlers (Total: ${oldHandlers.size})`);
console.log(`New Handlers (Total: ${newHandlers.size})`);

const missing = [];
oldHandlers.forEach(h => {
    if (!newHandlers.has(h)) missing.push(h);
});

const added = [];
newHandlers.forEach(h => {
    if (!oldHandlers.has(h)) added.push(h);
});

if (missing.length > 0) {
    console.log('\n[MISSING IN NEW CODE]:');
    missing.forEach(h => console.log(` - ${h}`));
} else {
    console.log('\n[ALL OLD HANDLERS PRESENT]');
}

if (added.length > 0) {
    console.log('\n[ADDED IN NEW CODE]:');
    added.forEach(h => console.log(` - ${h}`));
}
