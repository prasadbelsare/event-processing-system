import { randomUUID } from 'node:crypto';

const status = process.argv[2] ?? 'IN_TRANSIT';

const event = {
    eventId: randomUUID(),
    packageId: 'PKG-1001',
    eventType: 'STATUS_CHANGED',
    occurredAt: new Date().toISOString(),
    payload: { status, location: 'Denver Hub' },
};

async function main() {
    const res = await fetch('http://127.0.0.1:3000/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
    });
    console.log(res.status, await res.json());
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});