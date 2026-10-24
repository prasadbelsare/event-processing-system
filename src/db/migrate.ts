import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

async function main() {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    const sql = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
    await client.query(sql);
    console.log('Schema applied');
    await client.end();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});