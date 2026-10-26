import { randomUUID } from 'node:crypto';
import { config } from '../src/shared/config';
const status = process.argv[2] ?? 'IN_TRANSIT';
const packageId = process.argv[3] ?? 'PKG-1001';

const event = {
    eventId: randomUUID(),
    packageId,
    eventType: 'STATUS_CHANGED',
    occurredAt: new Date().toISOString(),
    payload: { status, location: 'Denver Hub' },
};

async function main() {
    const res = await fetch(`${config.apiUrl}/events`, {
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