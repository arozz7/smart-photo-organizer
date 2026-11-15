import { describe, it, expect } from 'vitest';
import { describeConfirmation, describeOutcome } from '../../../../src/utils/sendToMessages';
import type { SendOutcome } from '../../../../src/types/sendTo';

const sent = (counts: Partial<{ requested: number; missing: number; sent: number; tooLong: number }>, batches = 1): SendOutcome => ({
    status: 'sent',
    counts: { requested: 0, missing: 0, sent: 0, ...counts },
    batches,
});

describe('describeOutcome', () => {
    it('reports how many photos were handed over', () => {
        const message = describeOutcome(sent({ requested: 12, sent: 12 }), 'ClearFrame');

        expect(message.title).toBe('Sent to ClearFrame');
        expect(message.description).toBe('Handed 12 photos to ClearFrame.');
        expect(message.variant).toBe('primary');
    });

    it('uses the singular for one photo', () => {
        expect(describeOutcome(sent({ requested: 1, sent: 1 }), 'ClearFrame').description).toBe('Handed 1 photo to ClearFrame.');
    });

    it('says how many photos were skipped because their file is missing', () => {
        const { description } = describeOutcome(sent({ requested: 5, missing: 2, sent: 3 }), 'ClearFrame');

        expect(description).toBe('Handed 3 photos to ClearFrame. 2 skipped because their file is missing.');
    });

    it('mentions photos with a path too long to send', () => {
        const { description } = describeOutcome(sent({ requested: 3, sent: 2, tooLong: 1 }), 'ClearFrame');

        expect(description).toContain('1 skipped because the path is too long');
    });

    it('warns that the order is not kept when several launches were needed', () => {
        const { description } = describeOutcome(sent({ requested: 300, sent: 300 }, 3), 'ClearFrame');

        expect(description).toContain('3 launches');
        expect(description).toContain('order');
    });

    it('explains how to fix a missing ClearFrame location', () => {
        const message = describeOutcome({ status: 'failed', reason: 'not_configured', counts: { requested: 2, missing: 0, sent: 0 } }, 'ClearFrame');

        expect(message.variant).toBe('danger');
        expect(message.description).toContain('Settings');
    });

    it('reports a failed launch, including what had already been handed over', () => {
        const none = describeOutcome({ status: 'failed', reason: 'launch_failed', counts: { requested: 4, missing: 0, sent: 0 } }, 'ClearFrame');
        const partly = describeOutcome({ status: 'failed', reason: 'launch_failed', counts: { requested: 9, missing: 0, sent: 4 } }, 'ClearFrame');

        expect(none.description).toBe('ClearFrame could not be started.');
        expect(partly.description).toContain('4 photos');
    });

    it('explains when every photo is missing', () => {
        const message = describeOutcome({ status: 'failed', reason: 'nothing_to_send', counts: { requested: 3, missing: 3, sent: 0 } }, 'ClearFrame');

        expect(message.description).toBe('None of the 3 photos can be sent because their files are missing.');
    });

    it('explains a vanished Smart Album', () => {
        const message = describeOutcome({ status: 'failed', reason: 'unknown_source', counts: { requested: 0, missing: 0, sent: 0 } }, 'ClearFrame');

        expect(message.description).toContain('no longer exists');
    });

    it('has a plain message for any other failure', () => {
        const message = describeOutcome({ status: 'failed', reason: 'invalid_request', counts: { requested: 0, missing: 0, sent: 0 } }, 'ClearFrame');

        expect(message.variant).toBe('danger');
        expect(message.description.length).toBeGreaterThan(0);
    });
});

describe('describeConfirmation', () => {
    const needs = (sendable: number, missing = 0): Extract<SendOutcome, { status: 'needs_confirmation' }> => ({
        status: 'needs_confirmation',
        counts: { requested: sendable + missing, missing, sent: 0 },
        sendable,
        threshold: 50,
    });

    it('asks before sending a large number of photos and names the threshold setting', () => {
        const message = describeConfirmation(needs(120), 'ClearFrame');

        expect(message.title).toBe('Send to ClearFrame');
        expect(message.description).toContain('Send 120 photos to ClearFrame?');
        expect(message.description).toContain('more than 50');
        expect(message.confirmLabel).toBe('Send 120');
    });

    it('mentions photos that will be skipped', () => {
        expect(describeConfirmation(needs(120, 4), 'ClearFrame').description).toContain('4 will be skipped because their file is missing');
    });
});
