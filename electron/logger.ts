import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

const logDir = path.join(app.getPath('userData'), 'logs');

if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
}

const logFile = path.join(logDir, 'main.log');
const MAX_SIZE = 5 * 1024 * 1024; // 5MB

let logStream = fs.createWriteStream(logFile, { flags: 'a' });

function rotateLogIfNeeded() {
    try {
        if (fs.existsSync(logFile)) {
            const stats = fs.statSync(logFile);
            if (stats.size > MAX_SIZE) {
                logStream.end();
                const oldLog = logFile + '.old';
                if (fs.existsSync(oldLog)) fs.unlinkSync(oldLog);
                fs.renameSync(logFile, oldLog);
                logStream = fs.createWriteStream(logFile, { flags: 'a' });
            }
        }
    } catch (err) {
        console.error('Failed to rotate logs:', err);
    }
}

function getTimestamp() {
    return new Date().toISOString();
}

function formatMsg(level: string, ...args: any[]) {
    const msg = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');
    return `[${getTimestamp()}] [${level}] ${msg}\n`;
}

const logger = {
    info: (...args: any[]) => {
        rotateLogIfNeeded();
        const formatted = formatMsg('INFO', ...args);
        console.log(...args);
        logStream.write(formatted);
    },
    warn: (...args: any[]) => {
        rotateLogIfNeeded();
        const formatted = formatMsg('WARN', ...args);
        console.warn(...args);
        logStream.write(formatted);
    },
    error: (...args: any[]) => {
        rotateLogIfNeeded();
        const formatted = formatMsg('ERROR', ...args);
        console.error(...args);
        logStream.write(formatted);
    },
    debug: (...args: any[]) => {
        rotateLogIfNeeded();
        const formatted = formatMsg('DEBUG', ...args);
        // Only log to console in dev? Or always? Let's mirror others for now.
        console.log(...args);
        logStream.write(formatted);
    },
    getLogPath: () => logFile
};

export default logger;
