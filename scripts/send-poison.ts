import { connectRabbit } from '../src/shared/rabbitmq';
import { QUEUES } from '../src/shared/config';

async function main() {
    const { connection, channel } = await connectRabbit();
    channel.sendToQueue(QUEUES.main, Buffer.from('{"this":"is not a valid event"}'), {
        persistent: true,
    });
    await channel.waitForConfirms();
    console.log('poison message published');
    await connection.close();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});