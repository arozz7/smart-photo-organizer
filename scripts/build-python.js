import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pythonRoot = path.join(__dirname, '../src/python');
const venvPath = path.join(pythonRoot, '.venv');
const pyInstallerPath = path.join(venvPath, 'Scripts', 'pyinstaller.exe');
const pythonExe = path.join(venvPath, 'Scripts', 'python.exe');

console.log('Starting Python bundling...');

// 1. Ensure requirements are met
console.log('Verifying requirements...');
try {
    // We could run pip install here but we assume venv is ready for now
} catch (e) {
    console.error('pip install failed', e);
    process.exit(1);
}

// 2. Run PyInstaller
// --noconfirm: Overwrite output directory without asking
// --onedir: Create a directory containing the executable and all dependencies
// --clean: Clean PyInstaller cache and remove temporary files before building
// --add-data: Include data files
console.log('Running PyInstaller...');

const buildCmd = [
    `"${pyInstallerPath}"`,
    '--noconfirm',
    '--onedir',
    '--clean',
    '--name "smart-photo-ai"', // Name of the final executable
    `--paths "${pythonRoot}"`,
    `--workpath "${path.join(__dirname, '../build-temp/pywork')}"`,
    `--specpath "${path.join(__dirname, '../build-temp')}"`,
    `--distpath "${path.join(__dirname, '../python-dist')}"`,
    // Include specific modules that sometimes fail auto-detection
    '--hidden-import insightface',
    '--hidden-import transformers',
    '--hidden-import torch',
    '--hidden-import scipy.special._cdflib', // Common scipy issue
    `"${path.join(pythonRoot, 'main.py')}"`
].join(' ');

console.log(`Executing: ${buildCmd}`);

try {
    execSync(buildCmd, { stdio: 'inherit', cwd: pythonRoot });
    console.log('Python bundling complete! Output in /python-dist/smart-photo-ai');
} catch (e) {
    console.error('PyInstaller failed');
    process.exit(1);
}
