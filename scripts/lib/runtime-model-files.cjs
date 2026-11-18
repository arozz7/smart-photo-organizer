'use strict';
/**
 * Which files of the project's `models/` folder the AI runtime zip leaves out.
 *
 * `model.safetensors` is a byte-identical copy of `sam3_model.safetensors` (3.4 GB). The CPU SAM 3 provider
 * creates it by itself the first time it loads (facelib/sam3_provider_transformers.py: "from_pretrained expects
 * model.safetensors; copy if needed"), so shipping it only doubles that part of the download. It is skipped only
 * when `sam3_model.safetensors` is present to copy it from.
 */
const DUPLICATE_WEIGHTS = 'model.safetensors';
const WEIGHTS_SOURCE = 'sam3_model.safetensors';

/** @param {string[]} fileNames top-level file names in the models folder @returns {string[]} names to leave out */
function modelFilesToSkip(fileNames) {
    return fileNames.includes(DUPLICATE_WEIGHTS) && fileNames.includes(WEIGHTS_SOURCE) ? [DUPLICATE_WEIGHTS] : [];
}

module.exports = { modelFilesToSkip };
