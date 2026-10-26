import { randomUUID } from 'node:crypto';
import { pool } from '../src/shared/db';
import { config } from '../src/shared/config';
const STATUSES = ['PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED_ATTEMPT'];
const PACKAGES = 5;
const EVENTS_PER_PACKAGE = 20;

const runId = Date.now();
const prefix = `PKG-CONC-${runId}-`;
const base = Date.now() - 3_600_000;

type Ev = {
    eventId: string;
    packageId: string;
    eventType: 'STATUS_CHANGED';
    occurredAt: string;
    payload: { status: string; location: string };
};


const unique: Ev[] = [];
for (let p = 0; p < PACKAGES; p++) {
    for (let i = 0; i < EVENTS_PER_PACKAGE; i++) {
        unique.push({
            eventId: randomUUID(),
            packageId: `${prefix}${p}`,
            eventType: 'STATUS_CHANGED',
            occurredAt: new Date(base + i * 1000).toISOString(),
            payload: {
                status: STATUSES[Math.floor(Math.random() * STATUSES.length)],
                location: `Hub-${i}`,
            },
        });
    }
}


const duplicates = unique.filter(() => Math.random() < 0.3);
const toSend = [...unique, ...duplicates];
for (let i = toSend.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [toSend[i], toSend[j]] = [toSend[j], toSend[i]];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
    console.log(`Sending ${toSend.length} events (${unique.length} unique + ${duplicates.length} duplicates), shuffled.`);

    let failed = 0;
    for (let i = 0; i < toSend.length; i += 20) {
        const batch = toSend.slice(i, i + 20);
        const results = await Promise.all(
            batch.map((ev) =>
                fetch(`${config.apiUrl}/events`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(ev),
                }),
            ),
        );
        failed += results.filter((r) => r.status !== 202).length;
    }
    console.log(`All sent. Non-202 responses: ${failed}`);

    let count = 0;
    for (let t = 0; t < 120 && count < unique.length; t++) {
        const r = await pool.query(
            'select count(*)::int as n from package_events where package_id like $1',
            [`${prefix}%`],
        );
        count = r.rows[0].n;
        if (count < unique.length) await sleep(500);
    }
    await sleep(2000);
    const final = await pool.query(
        'select count(*)::int as n from package_events where package_id like $1',
        [`${prefix}%`],
    );
    count = final.rows[0].n;


    let stateOk = true;
    for (let p = 0; p < PACKAGES; p++) {
        const pid = `${prefix}${p}`;
        const newest = unique
            .filter((e) => e.packageId === pid)
            .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))[0];
        const row = (await pool.query('select current_status, last_event_at from packages where package_id = $1', [pid])).rows[0];
        const ok =
            row?.current_status === newest.payload.status &&
            new Date(row.last_event_at).getTime() === Date.parse(newest.occurredAt);
        if (!ok) stateOk = false;
        console.log(`${pid}: status ${row?.current_status}, expected ${newest.payload.status} -> ${ok ? 'ok' : 'WRONG'}`);
    }

    const countOk = count === unique.length;
    console.log(`\nhistory rows: ${count} (expected ${unique.length}) -> ${countOk ? 'ok' : 'WRONG'}`);
    const pass = countOk && stateOk && failed === 0;
    console.log(pass ? '\nPASS' : '\nFAIL');
    await pool.end();
    process.exit(pass ? 0 : 1);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});