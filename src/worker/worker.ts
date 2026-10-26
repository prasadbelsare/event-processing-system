import amqp from 'amqplib';
import type { ConsumeMessage } from 'amqplib';
import { config, QUEUES, RETRY_TIERS, MAX_ATTEMPTS } from '../shared/config';
import { PackageEventSchema } from '../shared/events';
import { assertTopology } from '../shared/topology';
import { processEvent } from './processEvent';
import { isPermanent } from './errors';
import { simulateDownstream } from './simulate';

function getAttempt(msg: ConsumeMessage): number {
    const value = msg.properties.headers?.['x-attempt'];
    return typeof value === 'number' ? value : 1;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
    console.log('[WORKER] Starting up and connecting to RabbitMQ...');
    const connection = await amqp.connect(config.rabbitmqUrl);
    // A confirm channel lets us be sure a message reached the retry queue before we ack the original.
    const channel = await connection.createConfirmChannel();
    await assertTopology(channel);
    await channel.prefetch(10);

    console.log(`[WORKER] Ready and waiting for messages on ${QUEUES.main}.`);

    await channel.consume(QUEUES.main, async (msg) => {
        if (!msg) return;

        const attempt = getAttempt(msg);
        let label = 'unknown';
        const redelivered = msg.fields.redelivered
            ? ' [REDELIVERED: a previous worker never acked it]'
            : '';
        console.log(`[WORKER] Picked up a message (attempt ${attempt} of ${MAX_ATTEMPTS}).${redelivered}`);

        try {
            const raw = JSON.parse(msg.content.toString());
            const parsed = PackageEventSchema.parse(raw);
            label = parsed.eventId.slice(0, 8);
            console.log(`[WORKER] Event ${label} is valid (${parsed.eventType} for ${parsed.packageId}).`);

            simulateDownstream(parsed.packageId, attempt);
            if (config.processDelayMs > 0) await sleep(config.processDelayMs);
            await processEvent(parsed);

            channel.ack(msg);
            console.log(`[WORKER] Event ${label} saved, telling RabbitMQ it is done (ack).`);
        } catch (err) {
            const reason = err instanceof Error ? err.message.split('\n')[0] : String(err);

            if (isPermanent(err)) {
                console.log(`[WORKER] Event ${label} is permanently bad (${reason}), so no retries: sending it straight to the DLQ.`);
                channel.nack(msg, false, false);
                return;
            }

            if (attempt >= MAX_ATTEMPTS) {
                console.log(`[WORKER] Event ${label} failed ${attempt} times (${reason}), giving up: sending it to the DLQ.`);
                channel.nack(msg, false, false);
                return;
            }

            const tier = RETRY_TIERS[attempt - 1];
            console.log(`[WORKER] Event ${label} failed temporarily (${reason}), will retry in ${tier.delayMs / 1000}s via ${tier.queue}.`);

            channel.sendToQueue(tier.queue, msg.content, {
                persistent: true,
                contentType: 'application/json',
                messageId: msg.properties.messageId,
                headers: { 'x-attempt': attempt + 1 },
            });
            await channel.waitForConfirms();
            channel.ack(msg); // the copy in the retry queue is now the one that counts
        }
    });
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});