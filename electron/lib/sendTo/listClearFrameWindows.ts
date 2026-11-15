import { execFile } from 'node:child_process';
import { CLEARFRAME_EXECUTABLE_NAME, parseTasklistWindowTitles } from '../../core/services/sendTo/clearFrameInstall';

/** Window titles of running ClearFrame processes, read with the Windows `tasklist` tool (no shell). */
export function listClearFrameWindowTitles(): Promise<string[]> {
    return new Promise((resolve, reject) => {
        execFile(
            'tasklist',
            ['/v', '/fo', 'csv', '/fi', `IMAGENAME eq ${CLEARFRAME_EXECUTABLE_NAME}`],
            { windowsHide: true, timeout: 5000 },
            (error, stdout) => (error ? reject(error) : resolve(parseTasklistWindowTitles(stdout))),
        );
    });
}
