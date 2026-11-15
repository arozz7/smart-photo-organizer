import type { SendOutcome } from '../types/sendTo';

export interface SendMessage {
    title: string;
    description: string;
    variant: 'primary' | 'danger';
}

export interface ConfirmationMessage {
    title: string;
    description: string;
    confirmLabel: string;
}

const photos = (count: number) => `${count} ${count === 1 ? 'photo' : 'photos'}`;

/** The text shown after a send has finished (or failed). */
export function describeOutcome(outcome: Exclude<SendOutcome, { status: 'needs_confirmation' }>, targetLabel: string): SendMessage {
    if (outcome.status === 'sent') {
        return { title: `Sent to ${targetLabel}`, description: sentDescription(outcome, targetLabel), variant: 'primary' };
    }
    return { title: `Could not send to ${targetLabel}`, description: failureDescription(outcome, targetLabel), variant: 'danger' };
}

/** The question asked before a large send. */
export function describeConfirmation(
    outcome: Extract<SendOutcome, { status: 'needs_confirmation' }>,
    targetLabel: string,
): ConfirmationMessage {
    const skipped = outcome.counts.missing > 0
        ? ` ${outcome.counts.missing} will be skipped because their file is missing.`
        : '';
    return {
        title: `Send to ${targetLabel}`,
        description: `Send ${photos(outcome.sendable)} to ${targetLabel}? You are asked because this is more than ${outcome.threshold} photos (change this in Settings).${skipped}`,
        confirmLabel: `Send ${outcome.sendable}`,
    };
}

function sentDescription(outcome: Extract<SendOutcome, { status: 'sent' }>, targetLabel: string): string {
    const { counts, batches } = outcome;
    const parts = [`Handed ${photos(counts.sent)} to ${targetLabel}.`];
    if (counts.missing > 0) parts.push(`${counts.missing} skipped because their file is missing.`);
    if (counts.tooLong) parts.push(`${counts.tooLong} skipped because the path is too long.`);
    if (batches > 1) parts.push(`Sent in ${batches} launches, so ${targetLabel} may not show them in the same order.`);
    return parts.join(' ');
}

function failureDescription(outcome: Extract<SendOutcome, { status: 'failed' }>, targetLabel: string): string {
    const { counts } = outcome;
    switch (outcome.reason) {
        case 'not_configured':
            return `${targetLabel} was not found. Set where it is installed in Settings, under Send to.`;
        case 'launch_failed':
            return counts.sent > 0
                ? `${targetLabel} stopped responding after ${photos(counts.sent)} were handed over.`
                : `${targetLabel} could not be started.`;
        case 'nothing_to_send':
            return `None of the ${photos(counts.requested)} can be sent because their files are missing.`;
        case 'unknown_source':
            return 'That Smart Album no longer exists.';
        default:
            return 'The request could not be completed.';
    }
}
