import { createDb } from '@irth/db';

export const db = createDb(process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/irth');
