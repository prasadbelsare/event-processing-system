import { randomUUID } from 'node:crypto';

const event = {
    eventId: randomUUID(),
    packageId: 'PKG-2002',
    eventType: 'STATUS_CHANGED',
    occurredAt: new Date().toISOString(),
    payload: { status: 'OUT_FOR_DELIVERY', location: 'Boulder Depot' },
};

async function send() {
    const res = await fetch('http://127.0.0.1:3000/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
    });
    console.log(res.status, event.eventId);
}

async function main() {
    await send();
    await send();
    await send();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});