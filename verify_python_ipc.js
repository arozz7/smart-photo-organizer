import { spawn } from 'child_process';
import { join } from 'path';
import { createInterface } from 'readline';

const pythonPath = join(process.cwd(), 'src', 'python', '.venv', 'Scripts', 'python.exe');
const scriptPath = join(process.cwd(), 'src', 'python', 'main.py');

console.log(`[Test] Spawning: ${pythonPath} ${scriptPath}`);

const pythonProcess = spawn(pythonPath, [scriptPath], {
    stdio: ['pipe', 'pipe', 'pipe'] // stdin, stdout, stderr
});

const reader = createInterface({ input: pythonProcess.stdout });

reader.on('line', (line) => {
    console.log(`[Python Output] ${line}`);
    try {
        const msg = JSON.parse(line);
        if (msg.type === 'pong') {
            console.log('✅ Ping/Pong successful!');
        }
        if (msg.success && msg.indexed) {
            console.log('✅ Indexing successful!');
        }
        if (msg.results) {
            console.log('✅ Search successful! Results:', msg.results);
        }
    } catch (e) {
        console.error('Failed to parse JSON:', line);
    }
});

pythonProcess.stderr.on('data', (data) => {
    console.error(`[Python API Error]: ${data.toString()}`);
});

// Send Ping
setTimeout(() => {
    const cmd = JSON.stringify({ type: 'ping' }) + '\n';
    console.log(`[Test] Sending: ${cmd.trim()}`);
    pythonProcess.stdin.write(cmd);
}, 1000);

// Send Index Faces
setTimeout(() => {
    // Fake 512-d vector
    const vec = new Array(512).fill(0.1);
    const cmd = JSON.stringify({
        type: 'index_faces',
        payload: { faces: [{ id: 999, descriptor: vec }] }
    }) + '\n';
    console.log(`[Test] Sending Index Command...`);
    pythonProcess.stdin.write(cmd);
}, 2000);

// Send Search Faces
setTimeout(() => {
    const vec = new Array(512).fill(0.1);
    const cmd = JSON.stringify({
        type: 'search_faces',
        payload: { descriptor: vec, k: 1 }
    }) + '\n';
    console.log(`[Test] Sending Search Command...`);
    pythonProcess.stdin.write(cmd);
}, 3000);

// Timeout
setTimeout(() => {
    console.error('Test complete (Killing process)');
    pythonProcess.kill();
    process.exit(0);
}, 30000);
