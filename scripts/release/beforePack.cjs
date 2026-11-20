'use strict';
/** electron-builder beforePack hook: refuses to package an app whose frozen Python engine is missing or older than the sources. */
const path = require('node:path');
const { findStaleEngine } = require('./engineFreshness.cjs');

exports.default = async function beforePack() {
    const root = path.join(__dirname, '..', '..');
    const problem = findStaleEngine(path.join(root, 'python-dist'), path.join(root, 'src', 'python'));
    if (problem) throw new Error(problem);
};
