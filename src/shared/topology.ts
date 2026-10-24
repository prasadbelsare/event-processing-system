import type { Channel } from 'amqplib';
import { QUEUES, EXCHANGES, RETRY_TIERS } from './config';

export async function assertTopology(channel: Channel) {
    // Dead-letter exchange + the queue that collects rejected messages
    await channel.assertExchange(EXCHANGES.dead, 'direct', { durable: true });
    await channel.assertQueue(QUEUES.dlq, { durable: true });
    await channel.bindQueue(QUEUES.dlq, EXCHANGES.dead, QUEUES.dlq);

    // Main queue: rejected messages are rerouted to the DLX with routing key "events.dlq"
    await channel.assertQueue(QUEUES.main, {
        durable: true,
        deadLetterExchange: EXCHANGES.dead,
        deadLetterRoutingKey: QUEUES.dlq,
    });

    // Also bind main to the same exchange, so expired retry messages can come back to it
    await channel.bindQueue(QUEUES.main, EXCHANGES.dead, QUEUES.main);

    // Retry queues: no consumers. After the TTL, messages are dead-lettered back to events.main
    for (const tier of RETRY_TIERS) {
        await channel.assertQueue(tier.queue, {
            durable: true,
            messageTtl: tier.delayMs,
            deadLetterExchange: EXCHANGES.dead,
            deadLetterRoutingKey: QUEUES.main,
        });
    }
}