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
    '--hidden-import scipy.special._cdflib', // Common scipy issue
    '--hidden-import pickletools',  // Required by pure-python torch
    '--hidden-import distutils',    // Often required
    '--hidden-import xml.etree.ElementTree', // Often required
    '--hidden-import modulefinder', // Required by torchvision (runtime)
    '--hidden-import cProfile',     // Required by torch (dynamo)
    '--hidden-import pstats',       // often used with cProfile
    '--collect-all mpmath',         // Required by sympy (used by torch)
    '--collect-all imageio',
    '--collect-all rawpy',
    '--collect-all PIL',            // Ensure full Pillow is included
    // EXCLUDE HEAVY MODULES for extreme slim installer
    '--exclude-module torch',
    '--exclude-module torchvision',
    '--exclude-module nvidia',
    '--exclude-module tensorrt',
    '--exclude-module tensorrt_libs',
    '--exclude-module bitsandbytes',
    `"${path.join(pythonRoot, 'main.py')}"`
].join(' ');

console.log(`Executing: ${buildCmd}`);

try {
    execSync(buildCmd, { stdio: 'inherit', cwd: pythonRoot });

    // 3. Post-build Cleanup: Remove large model weights and heavy libraries if they were accidentally collected
    const distDir = path.join(__dirname, '../python-dist/smart-photo-ai');
    const internalDir = path.join(distDir, '_internal');
    const weightsInDist = path.join(distDir, 'weights');

    if (fs.existsSync(weightsInDist)) {
        console.log('Removing weights from dist to keep installer slim...');
        fs.rmSync(weightsInDist, { recursive: true, force: true });
    }

    // Force remove heavy libraries from _internal if PyInstaller caught them
    ['torch', 'torchvision', 'nvidia', 'tensorrt', 'tensorrt_libs', 'bitsandbytes'].forEach(lib => {
        const libPath = path.join(internalDir, lib);
        if (fs.existsSync(libPath)) {
            console.log(`Force removing ${lib} from _internal...`);
            fs.rmSync(libPath, { recursive: true, force: true });
        }
    });

    console.log('Python bundling complete! Output in /python-dist/smart-photo-ai');
} catch (e) {
    console.error('PyInstaller failed');
    process.exit(1);
}
