import { randomUUID } from 'node:crypto';
import { pool } from '../src/shared/db';
import { config } from '../src/shared/config';

const seed = Number(process.argv[2]) || Math.floor(Math.random() * 1_000_000);
const rounds = Number(process.argv[3]) || 20;

function mulberry32(a: number) {
    return () => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
const rand = mulberry32(seed);

function shuffle<T>(items: T[]): T[] {
    const a = [...items];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

// The real-world order things happened in (oldest first).
const STEPS = ['PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED'];
const base = Date.now() - 60_000;
const runId = Date.now();

type Round = { packageId: string; events: any[]; arrival: string[] };

// Build one package per round, each with its own random arrival order.
const allRounds: Round[] = [];
for (let r = 0; r < rounds; r++) {
    const packageId = `PKG-ORDER-${runId}-${r}`;
    const events = STEPS.map((status, i) => ({
        eventId: randomUUID(),
        packageId,
        eventType: 'STATUS_CHANGED',
        occurredAt: new Date(base + i * 10_000).toISOString(),
        payload: { status, location: `Hub for ${status}` },
    }));
    const arrivalOrder = shuffle(events);
    allRounds.push({
        packageId,
        events: arrivalOrder,
        arrival: arrivalOrder.map((e) => e.payload.status),
    });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
    console.log(`Seed: ${seed}  |  Rounds: ${rounds}  (rerun with the same seed to repeat this exact run)\n`);

    // Send every event of every round, in each round's scrambled order.
    for (const round of allRounds) {
        for (const ev of round.events) {
            const res = await fetch(`${config.apiUrl}/events`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(ev),
            });
            if (res.status !== 202) console.log(`Unexpected HTTP ${res.status} for ${round.packageId}`);
        }
    }
    console.log(`Sent ${rounds * STEPS.length} events. Waiting for the worker to store them...\n`);

    // Wait until all events are stored (up to 60 seconds).
    const prefix = `PKG-ORDER-${runId}-%`;
    const expected = rounds * STEPS.length;
    let count = 0;
    for (let t = 0; t < 120 && count < expected; t++) {
        const r = await pool.query(
            'select count(*)::int as n from package_events where package_id like $1',
            [prefix],
        );
        count = r.rows[0].n;
        if (count < expected) await sleep(500);
    }
    await sleep(1000);

    // Check every package.
    let failures = 0;
    for (const round of allRounds) {
        const rows = await pool.query(
            'select count(*)::int as n from package_events where package_id = $1',
            [round.packageId],
        );
        const pkg = await pool.query(
            'select current_status from packages where package_id = $1',
            [round.packageId],
        );
        const n = rows.rows[0].n;
        const status = pkg.rows[0]?.current_status;
        const ok = n === STEPS.length && status === 'DELIVERED';
        if (!ok) failures++;
        console.log(
            `${ok ? 'ok   ' : 'WRONG'} arrived: ${round.arrival.join(' > ')}  ->  rows ${n}, status ${status}`,
        );
    }

    console.log(`\n${rounds - failures}/${rounds} rounds correct`);
    console.log(failures === 0 ? 'PASS' : `FAIL (rerun with: npm run test:order -- ${seed} ${rounds})`);
    await pool.end();
    process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});