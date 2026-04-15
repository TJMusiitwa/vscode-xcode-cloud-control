import * as cp from 'child_process';
import * as os from 'os';
import { promisify } from 'util';

const exec = promisify(cp.exec);

export async function isXCResultToolAvailable(): Promise<boolean> {
    if (os.platform() !== 'darwin') {
        return false;
    }

    try {
        await exec('xcrun xcresulttool version');
        return true;
    } catch {
        return false;
    }
}
