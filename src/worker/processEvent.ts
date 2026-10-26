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
    const client = await pool.connect(); // throws if the database is unreachable
    let broken = false;
    try {
        await client.query('BEGIN');
        console.log(`[DB] Started a transaction for event ${shortId} (all steps succeed together or not at all).`);

        const inserted = await client.query(
            `INSERT INTO package_events (event_id, package_id, event_type, occurred_at, payload)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (event_id) DO NOTHING`,
            [event.eventId, event.packageId, event.eventType, event.occurredAt, event.payload],
        );

        if (inserted.rowCount === 1) {
            console.log(`[DB] Event ${shortId} is new, so it was added to the history table.`);

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

            if (updated.rowCount === 1) {
                console.log(`[DB] Package ${event.packageId} current status is now ${status}.`);
            } else {
                console.log(`[DB] Event ${shortId} is older than what we already have, so the current status was left unchanged.`);
            }
        } else {
            console.log(`[DB] Event ${shortId} was already processed before (duplicate), so nothing was changed.`);
        }

        await client.query('COMMIT');
        console.log(`[DB] Transaction for event ${shortId} committed.`);
    } catch (err) {
        try {
            await client.query('ROLLBACK');
            console.log(`[DB] Something failed, so the transaction for event ${shortId} was rolled back.`);
        } catch {
            broken = true; // the connection itself is dead, so rollback is impossible (and unnecessary)
            console.log(`[DB] The connection died mid-transaction for event ${shortId}; the database will discard it.`);
        }
        throw err; // the worker decides: retry or DLQ
    } finally {
        client.release(broken); // true = destroy this connection instead of reusing it
    }
}