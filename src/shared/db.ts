import { Pool } from 'pg';
import { config } from './config';

export const pool = new Pool({
    connectionString: config.databaseUrl,
    connectionTimeoutMillis: 3000, // fail fast instead of waiting forever
});

// Without this handler, a dropped idle connection would crash the whole process.
pool.on('error', (err) => {
    console.log(`[DB] Lost an idle database connection (${err.message}). The pool will open a new one when needed.`);
});