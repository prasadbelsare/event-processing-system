import amqp from 'amqplib';
import { config, QUEUES } from '../shared/config';
import { PackageEventSchema } from '../shared/events';
import { processEvent } from './processEvent';
import { assertTopology } from '../shared/topology';

async function main() {
    const connection = await amqp.connect(config.rabbitmqUrl);
    const channel = await connection.createChannel();
    await assertTopology(channel);

    // Hold at most 10 unacknowledged messages at a time.
    await channel.prefetch(10);

    console.log(`Worker waiting for messages on ${QUEUES.main}`);

    await channel.consume(QUEUES.main, async (msg) => {
        if (!msg) return;

        try {
            const parsed = PackageEventSchema.parse(JSON.parse(msg.content.toString()));
            await processEvent(parsed);
            channel.ack(msg);
            console.log(`processed ${parsed.eventType} ${parsed.eventId}`);
        } catch (err) {
            console.error('failed to process message', err);
            // requeue = false: don't put it straight back. Phase 2 replaces this with retry + DLQ.
            channel.nack(msg, false, false);
        }
    });
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});