import amqp from 'amqplib';
import type { ConfirmChannel } from 'amqplib';
import { config, QUEUES } from './config';
import type { PackageEvent } from './events';

export async function connectRabbit() {
    const connection = await amqp.connect(config.rabbitmqUrl);
    const channel = await connection.createConfirmChannel();
    await channel.assertQueue(QUEUES.main, { durable: true });
    return { connection, channel };
}

export function publishEvent(
    channel: ConfirmChannel,
    event: PackageEvent,
): Promise<void> {
    return new Promise((resolve, reject) => {
        channel.sendToQueue(
            QUEUES.main,
            Buffer.from(JSON.stringify(event)),
            {
                persistent: true,
                contentType: 'application/json',
                messageId: event.eventId,
            },
            (err) => (err ? reject(err) : resolve()),
        );
    });
}