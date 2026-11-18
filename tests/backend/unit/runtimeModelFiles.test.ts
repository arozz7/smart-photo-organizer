import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { modelFilesToSkip } = require('../../../scripts/lib/runtime-model-files.cjs');

describe('modelFilesToSkip', () => {
    it('skips the duplicate model.safetensors when sam3_model.safetensors is present', () => {
        const files = ['sam3.pt', 'sam3_model.safetensors', 'model.safetensors', 'config.json'];

        expect(modelFilesToSkip(files)).toEqual(['model.safetensors']);
    });

    it('keeps model.safetensors when it is the only copy of the CPU weights', () => {
        // Without sam3_model.safetensors the CPU provider has nothing to copy it from.
        expect(modelFilesToSkip(['model.safetensors', 'config.json'])).toEqual([]);
    });

    it('skips nothing when there is no duplicate', () => {
        expect(modelFilesToSkip(['sam3.pt', 'sam3_model.safetensors', 'adaface_ir50_webface4m.onnx'])).toEqual([]);
    });

    it('never skips the files the CPU provider needs next to the weights', () => {
        const files = ['sam3_model.safetensors', 'model.safetensors', 'config.json', 'tokenizer.json', 'vocab.json', 'merges.txt'];

        const skipped = modelFilesToSkip(files);

        for (const needed of ['sam3_model.safetensors', 'config.json', 'tokenizer.json', 'vocab.json', 'merges.txt']) {
            expect(skipped).not.toContain(needed);
        }
    });

    it('handles an empty folder', () => {
        expect(modelFilesToSkip([])).toEqual([]);
    });
});
