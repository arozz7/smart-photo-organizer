const crypto = require('crypto');

const pathStr = "R:\\Pictures\\2015\\July 2015\\Juanita's B-Day\\_DSC7104.ARW";

function hash(s) {
    return crypto.createHash('md5').update(s).digest('hex');
}

console.log('--- Path Hashes ---');
console.log(`Original (Backslashes): ${pathStr}`);
console.log(`Hash: ${hash(pathStr)}`);

const forward = pathStr.replace(/\\/g, '/');
console.log(`Forward Slashes: ${forward}`);
console.log(`Hash: ${hash(forward)}`);

const lower = pathStr.toLowerCase();
console.log(`Lowercase (Backslashes): ${lower}`);
console.log(`Hash: ${hash(lower)}`);
