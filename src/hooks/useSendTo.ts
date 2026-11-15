import { useCallback, useEffect, useRef, useState } from 'react';
import { useAlert } from '../context/AlertContext';
import type { SendSource, SendTargetInfo } from '../types/sendTo';
import { sendToApi } from '../utils/sendToApi';
import { describeConfirmation, describeOutcome } from '../utils/sendToMessages';

/** Available "Send to..." targets and a `send` function that handles confirmation and the result message. */
export function useSendTo() {
    const { showAlert, showConfirm } = useAlert();
    const [targets, setTargets] = useState<SendTargetInfo[]>([]);
    const [sending, setSending] = useState(false);
    const sendingRef = useRef(false);

    useEffect(() => {
        sendToApi.getTargets().then(setTargets).catch(() => setTargets([]));
    }, []);

    const send = useCallback(async (target: SendTargetInfo, source: SendSource, confirmed = false): Promise<void> => {
        if (sendingRef.current) return;
        sendingRef.current = true;
        setSending(true);
        try {
            const outcome = await sendToApi.send(target.id, source, confirmed);
            if (outcome.status === 'needs_confirmation') {
                const { title, description, confirmLabel } = describeConfirmation(outcome, target.label);
                showConfirm({ title, description, confirmLabel, onConfirm: () => send(target, source, true) });
            } else {
                showAlert(describeOutcome(outcome, target.label));
            }
        } catch {
            showAlert({ title: `Could not send to ${target.label}`, description: 'The request could not be completed.', variant: 'danger' });
        } finally {
            sendingRef.current = false;
            setSending(false);
        }
    }, [showAlert, showConfirm]);

    return { targets, sending, send };
}
