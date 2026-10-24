import { pool } from '../shared/db';
import type { PackageEvent } from '../shared/events';

// Work out the status and location this event implies for the package.
function deriveState(event: PackageEvent): { status: string; location: string | null } {
    switch (event.eventType) {
        case 'STATUS_CHANGED':
            return { status: event.payload.status, location: event.payload.location ?? null };
        case 'PACKAGE_SCANNED':
            return { status: 'IN_TRANSIT', location: event.payload.location };
        case 'DELIVERY_MOVED':
            return { status: 'IN_TRANSIT', location: event.payload.toHub };
    }
}

export async function processEvent(event: PackageEvent): Promise<void> {
    const shortId = event.eventId.slice(0, 8);
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Append to history. If this event_id already exists, it's a duplicate: do nothing.
        const inserted = await client.query(
            `INSERT INTO package_events (event_id, package_id, event_type, occurred_at, payload)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (event_id) DO NOTHING`,
            [event.eventId, event.packageId, event.eventType, event.occurredAt, event.payload],
        );

        // 2. Only touch current state if this event was new.
        if (inserted.rowCount === 1) {

            const { status, location } = deriveState(event);
            const updated = await client.query(
                `INSERT INTO packages (package_id, current_status, current_location, last_event_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (package_id) DO UPDATE
           SET current_status   = EXCLUDED.current_status,
               current_location = COALESCE(EXCLUDED.current_location, packages.current_location),
               last_event_at    = EXCLUDED.last_event_at,
               updated_at       = now()
         WHERE EXCLUDED.last_event_at > packages.last_event_at`,
                [event.packageId, status, location, event.occurredAt],
            );

        } else {
            console.log(`Event ${shortId} was already processed before (duplicate), so nothing was changed.`);
        }

        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}