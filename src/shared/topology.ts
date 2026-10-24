import type { Channel } from 'amqplib';
import { QUEUES, EXCHANGES } from './config';

export async function assertTopology(channel: Channel) {
    await channel.assertExchange(EXCHANGES.dead, 'direct', { durable: true });
    await channel.assertQueue(QUEUES.dlq, { durable: true });
    await channel.bindQueue(QUEUES.dlq, EXCHANGES.dead, QUEUES.dlq);

    await channel.assertQueue(QUEUES.main, {
        durable: true,
        deadLetterExchange: EXCHANGES.dead,
        deadLetterRoutingKey: QUEUES.dlq,
    });
}