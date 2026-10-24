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
            res.status(400).json({ error: 'invalid_event', issues: parsed.error.issues });
            return;
        }

        try {
            await publishEvent(channel, parsed.data);
            res.status(202).json({ accepted: true, eventId: parsed.data.eventId });
        } catch (err) {
            console.error('publish failed', err);
            res.status(503).json({ error: 'queue_unavailable' });
        }
    });

    app.listen(config.port, () => {
        console.log(`API listening on http://localhost:${config.port}`);
    });
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});