// Pretends to be a flaky downstream service (e.g. "send a notification").
// Temporary test tool: Phase 4 will replace it with proper failure toggles.
export function simulateDownstream(packageId: string, attempt: number): void {
    if (packageId === 'PKG-FLAKY' && attempt < 3) {
        throw new Error('Simulated downstream timeout');
    }
    if (packageId === 'PKG-BROKEN') {
        throw new Error('Simulated downstream outage');
    }
}