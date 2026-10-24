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

async function main() {
    const connection = await amqp.connect(config.rabbitmqUrl);
    // A confirm channel lets us be sure a message reached the retry queue before we ack the original.
    const channel = await connection.createConfirmChannel();
    await assertTopology(channel);
    await channel.prefetch(10);


    await channel.consume(QUEUES.main, async (msg) => {
        if (!msg) return;

        const attempt = getAttempt(msg);
        let label = 'unknown';

        try {
            const raw = JSON.parse(msg.content.toString());
            const parsed = PackageEventSchema.parse(raw);
            label = parsed.eventId.slice(0, 8);

            simulateDownstream(parsed.packageId, attempt);
            await processEvent(parsed);

            channel.ack(msg);
        } catch (err) {
            const reason = err instanceof Error ? err.message.split('\n')[0] : String(err);

            if (isPermanent(err)) {
                channel.nack(msg, false, false);
                return;
            }

            if (attempt >= MAX_ATTEMPTS) {
                channel.nack(msg, false, false);
                return;
            }

            const tier = RETRY_TIERS[attempt - 1];

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