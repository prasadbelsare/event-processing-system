import 'dotenv/config';

export const config = {
    rabbitmqUrl: process.env.RABBITMQ_URL ?? 'amqp://guest:guest@127.0.0.1:5672',
    databaseUrl: process.env.DATABASE_URL ?? '',
    port: Number(process.env.PORT ?? 3000),
    apiUrl: process.env.API_URL ?? 'http://127.0.0.1:3000',
};

export const QUEUES = {
    main: 'events.main',
    dlq: 'events.dlq',
} as const;

export const EXCHANGES = {
    dead: 'events.dead',
} as const;

// Each failed attempt moves the message to the next tier.
export const RETRY_TIERS = [
    { queue: 'events.retry.5s', delayMs: 5_000 },
    { queue: 'events.retry.15s', delayMs: 15_000 },
    { queue: 'events.retry.30s', delayMs: 30_000 },
] as const;

// First try + one retry per tier = 4 attempts in total.
export const MAX_ATTEMPTS = RETRY_TIERS.length + 1;