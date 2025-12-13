import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEST_DIR = path.join(__dirname, '../public/models');
const SOURCE_DIR = path.join(__dirname, '../node_modules/@vladmandic/human/models');

const MODELS_TO_COPY = [
    'blazeface.json',
    'blazeface.bin',
    // 'faceres' is the default recognition model in Human
    'faceres.json',
    'faceres.bin'
];

if (!fs.existsSync(DEST_DIR)) {
    fs.mkdirSync(DEST_DIR, { recursive: true });
}

function copyModels() {
    console.log(`Copying models from ${SOURCE_DIR} to ${DEST_DIR}...`);

    for (const file of MODELS_TO_COPY) {
        const srcPath = path.join(SOURCE_DIR, file);
        const destPath = path.join(DEST_DIR, file);

        if (fs.existsSync(srcPath)) {
            console.log(`Copying ${file}...`);
            fs.copyFileSync(srcPath, destPath);
        } else {
            console.error(`Error: Source file not found: ${srcPath}`);
            console.error('Make sure @vladmandic/human is installed (npm install @vladmandic/human)');
        }
    }
    console.log('Model setup complete.');
}

copyModels();
