import amqp from 'amqplib';
import type { ConfirmChannel } from 'amqplib';
import { config, QUEUES } from './config';
import type { PackageEvent } from './events';
import { assertTopology } from './topology';

export async function connectRabbit() {
    const connection = await amqp.connect(config.rabbitmqUrl);
    const channel = await connection.createConfirmChannel();
    await assertTopology(channel);
    return { connection, channel };
}

export function publishEvent(
    channel: ConfirmChannel,
    event: PackageEvent,
): Promise<void> {
    const shortId = event.eventId.slice(0, 8);

    return new Promise((resolve, reject) => {
        channel.sendToQueue(
            QUEUES.main,
            Buffer.from(JSON.stringify(event)),
            {
                persistent: true,
                contentType: 'application/json',
                messageId: event.eventId,
            },
            (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            },
        );
    });
}