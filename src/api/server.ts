import express from 'express';
import { config } from '../shared/config';
import { connectRabbit, publishEvent } from '../shared/rabbitmq';
import { PackageEventSchema } from '../shared/events';

async function main() {
    const { channel } = await connectRabbit();

    const app = express();
    app.use(express.json());

    app.get('/health', (_req, res) => {
        res.json({ status: 'ok' });
    });

    app.post('/events', async (req, res) => {

        const parsed = PackageEventSchema.safeParse(req.body);
        if (!parsed.success) {
            ('In server.ts [API] Event is invalid, rejecting it with 400 and NOT queueing it.');
            res.status(400).json({ error: 'invalid_event', issues: parsed.error.issues });
            return;
        }

        const shortId = parsed.data.eventId.slice(0, 8);
        try {
            await publishEvent(channel, parsed.data);
            res.status(202).json({ accepted: true, eventId: parsed.data.eventId });
        } catch (err) {
            res.status(503).json({ error: 'queue_unavailable' });
        }
    });

    app.listen(config.port, () => {
        console.log(`Listening on http://localhost:${config.port}`);
    });
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});