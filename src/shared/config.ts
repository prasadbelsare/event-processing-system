import 'dotenv/config';

export const config = {
    rabbitmqUrl: process.env.RABBITMQ_URL ?? 'amqp://guest:guest@127.0.0.1:5672',
    databaseUrl: process.env.DATABASE_URL ?? '',
    port: Number(process.env.PORT ?? 3000),
};

export const QUEUES = {
    main: 'events.main',
    dlq: 'events.dlq',
} as const;

export const EXCHANGES = {
    dead: 'events.dead',
} as const;