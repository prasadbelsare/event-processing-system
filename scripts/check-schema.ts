import { randomUUID } from 'node:crypto';
import { PackageEventSchema } from '../src/shared/events';

const good = {
    eventId: randomUUID(),
    packageId: 'PKG-1001',
    eventType: 'STATUS_CHANGED',
    occurredAt: new Date().toISOString(),
    payload: { status: 'IN_TRANSIT', location: 'Denver Hub' },
};

const bad = { ...good, payload: { status: 'TELEPORTED' } };

console.log('good:', PackageEventSchema.safeParse(good).success);
const result = PackageEventSchema.safeParse(bad);
console.log('bad:', result.success);
if (!result.success) console.log(result.error.issues);