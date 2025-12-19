import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pythonRoot = path.join(__dirname, '../src/python');
const venvPath = path.join(pythonRoot, '.venv');
const sitePackages = path.join(venvPath, 'Lib', 'site-packages');
const releaseDir = path.join(__dirname, '../release/0.2.0');
const stagingDir = path.join(__dirname, '../build-temp/runtime-staging');
const zipPath = path.join(releaseDir, 'ai-runtime-win-x64.zip');

// Packages to include in the extreme-slim runtime (heavy ones)
const heavyPackages = [
    'torch',
    'torchvision',
    'torchaudio',
    'nvidia',
    'tensorrt',
    'tensorrt_libs',
    'tensorrt_bindings',
    'bitsandbytes',
    'basicsr',
    'realesrgan',
    'gfpgan',
    'transformers',
    'accelerate',
    'facexlib', // Dependency of gfpgan
    'addict',   // Dependency of basicsr
    'torchgen', // Required by torch 2.x
    'yaml',     // PyYAML (often needed by torchgen/torch)
    'jinja2',   // Required by torch
    'markupsafe', // Required by jinja2
    'sympy',    // Required by torch.utils._sympy
    'mpmath',   // Required by sympy
    'networkx', // Required by torch (sometimes)
    'filelock', // Required by torch
    'typing_extensions', // Required by torch
    'fsspec',   // Required by torch
];

console.log('--- AI Runtime Packager ---');

// 1. Setup staging area
if (fs.existsSync(stagingDir)) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
}
fs.mkdirSync(path.join(stagingDir, 'lib/site-packages'), { recursive: true });
fs.mkdirSync(path.join(stagingDir, 'bin'), { recursive: true });

// 2. Collect site-packages
console.log('Collecting heavy libraries...');
heavyPackages.forEach(pkg => {
    // Copy the main package folder
    const pkgPath = path.join(sitePackages, pkg);
    if (fs.existsSync(pkgPath)) {
        console.log(`Copying ${pkg}...`);
        fs.cpSync(pkgPath, path.join(stagingDir, 'lib/site-packages', pkg), { recursive: true });

        // Also copy .dist-info if it exists for metadata
        const distInfo = fs.readdirSync(sitePackages).find(f => f.startsWith(pkg.replace('-', '_')) && f.endsWith('.dist-info'));
        if (distInfo) {
            fs.cpSync(path.join(sitePackages, distInfo), path.join(stagingDir, 'lib/site-packages', distInfo), { recursive: true });
        }
    } else {
        console.warn(`Warning: Package ${pkg} not found in site-packages.`);
    }
});

// 3. Collect DLLs for bin folder
// Many NVIDIA/PyTorch DLLs are deep in site-packages. We'll search for them and copy to bin.
// Or we can just let Python find them in site-packages (os.add_dll_directory handles this if we point to the right place).
// However, standard layout often has a 'bin' folder.
console.log('Collecting DLLs for bin folder...');
const dllsToFind = [/.*\.dll$/i];
function findAndCopyDlls(dir, targetDir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            findAndCopyDlls(fullPath, targetDir);
        } else if (dllsToFind.some(regex => regex.test(file))) {
            // Only copy DLLs likely to be needed at runtime
            if (file.toLowerCase().includes('cuda') || file.toLowerCase().includes('torch') || file.toLowerCase().includes('nvinfer')) {
                fs.copyFileSync(fullPath, path.join(targetDir, file));
            }
        }
    }
}
// findAndCopyDlls(path.join(stagingDir, 'lib/site-packages'), path.join(stagingDir, 'bin'));

// 4. Create ZIP archive
console.log('Creating ZIP archive...');
if (!fs.existsSync(releaseDir)) {
    fs.mkdirSync(releaseDir, { recursive: true });
}

// Using PowerShell Compress-Archive for native Windows zipping
// Note: We zip the CONTENTS of stagingDir
try {
    const powershellCmd = `powershell -Command "Compress-Archive -Path '${stagingDir}/*' -DestinationPath '${zipPath}' -Force"`;
    console.log(`Executing: ${powershellCmd}`);
    execSync(powershellCmd, { stdio: 'inherit' });
    console.log(`Success! Runtime packaged at: ${zipPath}`);

    // 5. Split into chunks for GitHub (2GB limit)
    console.log('Splitting ZIP into 1.5GB chunks for GitHub...');
    const CHUNK_SIZE = 1.5 * 1024 * 1024 * 1024; // 1.5GB (well under 2GB limit)
    const stats = fs.statSync(zipPath);
    const fileSize = stats.size;

    if (fileSize > CHUNK_SIZE) {
        const buffer = Buffer.alloc(10 * 1024 * 1024); // 10MB reading buffer
        const fd = fs.openSync(zipPath, 'r');
        let bytesReadTotal = 0;
        let partIndex = 1;

        while (bytesReadTotal < fileSize) {
            const partName = `${zipPath}.${String(partIndex).padStart(3, '0')}`;
            const outFd = fs.openSync(partName, 'w');
            let bytesInPart = 0;

            console.log(`Creating part: ${path.basename(partName)}...`);

            while (bytesInPart < CHUNK_SIZE && bytesReadTotal < fileSize) {
                const toRead = Math.min(buffer.length, CHUNK_SIZE - bytesInPart, fileSize - bytesReadTotal);
                const read = fs.readSync(fd, buffer, 0, toRead, bytesReadTotal);
                fs.writeSync(outFd, buffer, 0, read);
                bytesReadTotal += read;
                bytesInPart += read;
            }
            fs.closeSync(outFd);
            partIndex++;
        }
        fs.closeSync(fd);
        console.log('Splitting complete!');
    } else {
        console.log('File is under 2GB, no splitting needed.');
    }
} catch (e) {
    console.error('Failed to create or split ZIP archive.', e);
}
