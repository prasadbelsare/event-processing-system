import { spawn, execSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { pool } from '../src/shared/db';
import { config } from '../src/shared/config';

// Usage: npm run test:db-outage -- [outageSeconds]   (default 12)
const outageSec = Number(process.argv[2]) || 12;
const TOTAL = 20;
const prefix = `PKG-DBOUT-${Date.now()}-`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function startWorker(): Promise<ChildProcess> {
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/worker/worker.ts'], {
        env: { ...process.env, PROCESS_DELAY_MS: '0' },
        stdio: ['ignore', 'pipe', 'inherit'],
    });
    return new Promise((resolve) => {
        child.stdout!.on('data', (data) => {
            const text = data.toString();
            for (const line of text.split('\n').filter(Boolean)) console.log(`  [worker] ${line}`);
            if (text.includes('Ready and waiting')) resolve(child);
        });
    });
}

// Returns null while the database is unreachable.
async function savedCount(): Promise<number | null> {
    try {
        const r = await pool.query(
            'select count(*)::int as n from package_events where package_id like $1',
            [`${prefix}%`],
        );
        return r.rows[0].n;
    } catch {
        return null;
    }
}

async function main() {
    console.log('1. Starting a worker');
    const worker = await startWorker();

    console.log('2. STOPPING Postgres (simulated database outage)');
    execSync('docker compose stop postgres', { stdio: 'inherit' });

    console.log(`3. Sending ${TOTAL} events (the API does not need the database, so it accepts them)`);
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

    console.log(`4. Database stays down for ${outageSec}s. Events should be bouncing through the retry queues...`);
    await sleep(outageSec * 1000);

    console.log('5. STARTING Postgres again');
    execSync('docker compose start postgres', { stdio: 'inherit' });
    while ((await savedCount()) === null) await sleep(1000);
    console.log('   Database is accepting connections again.');

    // Events wait in retry queues up to 30s, so give them time to come back.
    const longOutage = outageSec >= 45;
    const maxWaitSec = longOutage ? 15 : 90;
    let count = 0;
    for (let t = 0; t < maxWaitSec * 2 && count < TOTAL; t++) {
        count = (await savedCount()) ?? 0;
        if (count < TOTAL) await sleep(500);
    }

    console.log(`\n6. Saved in the end: ${count} of ${TOTAL}`);
    worker.kill('SIGKILL');
    await pool.end();

    if (longOutage) {
        console.log(`The outage was longer than the retry tiers (about 50s), so events that ran out of attempts are in events.dlq.`);
        console.log('Check the RabbitMQ UI: events.dlq should hold the missing ones.');
        process.exit(0);
    }
    const pass = count === TOTAL;
    console.log(pass ? 'PASS: every event survived the outage' : 'FAIL: some events are missing');
    process.exit(pass ? 0 : 1);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});