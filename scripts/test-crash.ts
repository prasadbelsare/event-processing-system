import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { pool } from '../src/shared/db';
import { config } from '../src/shared/config';

const TOTAL = 30;
const prefix = `PKG-CRASH-${Date.now()}-`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Starts a real worker process and resolves once it says it is ready.
function startWorker(name: string, delayMs: number): Promise<ChildProcess> {
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/worker/worker.ts'], {
        env: { ...process.env, PROCESS_DELAY_MS: String(delayMs) },
        stdio: ['ignore', 'pipe', 'inherit'],
    });
    return new Promise((resolve) => {
        child.stdout!.on('data', (data) => {
            const text = data.toString();
            for (const line of text.split('\n').filter(Boolean)) console.log(`  [${name}] ${line}`);
            if (text.includes('Ready and waiting')) resolve(child);
        });
    });
}

async function savedCount(): Promise<number> {
    const r = await pool.query(
        'select count(*)::int as n from package_events where package_id like $1',
        [`${prefix}%`],
    );
    return r.rows[0].n;
}

async function main() {
    console.log('1. Starting worker A (slow: 3s per event, so it is always busy)');
    const workerA = await startWorker('A', 3000);

    console.log(`2. Sending ${TOTAL} events`);
    for (let i = 0; i < TOTAL; i++) {
        await fetch(`${config.apiUrl}/events`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                eventId: randomUUID(),
                packageId: `${prefix}${i}`,
                eventType: 'STATUS_CHANGED',
                occurredAt: new Date().toISOString(),
                payload: { status: 'IN_TRANSIT', location: 'Test Hub' },
            }),
        });
    }

    await sleep(4000);
    console.log(`3. Saved so far: ${await savedCount()} of ${TOTAL}. KILLING worker A now (no cleanup, like a real crash).`);
    workerA.kill('SIGKILL');

    console.log('4. Starting worker B (fast). It should pick up what A left behind.');
    const workerB = await startWorker('B', 0);

    for (let t = 0; t < 60 && (await savedCount()) < TOTAL; t++) await sleep(500);
    await sleep(1000);

    const finalCount = await savedCount();
    console.log(`\n5. Saved in the end: ${finalCount} of ${TOTAL}`);
    const pass = finalCount === TOTAL;
    console.log(pass ? 'PASS: no events were lost' : 'FAIL: events were lost');

    workerB.kill('SIGKILL');
    await pool.end();
    process.exit(pass ? 0 : 1);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});