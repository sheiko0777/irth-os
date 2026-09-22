import { NextResponse } from 'next/server';
import { db } from '@irth/db';
import { sql } from 'drizzle-orm';

/**
 * Mirrors apps/api's `/health` (db reachability + `dbHost`). Exists because
 * this app and apps/api each hold their own `DATABASE_URL` (Vercel env vs
 * Cloudflare secret) with nothing keeping them in sync — a Neon project
 * migration that updates one and not the other fails silently: writes still
 * succeed, they just land in the wrong database. Comparing `dbHost` here
 * against apps/api's is the whole check.
 */
export async function GET() {
  const dbHost = (() => {
    const url = process.env.DATABASE_URL;
    if (!url) return null;
    try {
      return new URL(url).hostname;
    } catch {
      return null;
    }
  })();

  try {
    await db.execute(sql`select 1`);
    return NextResponse.json({ data: { status: 'ok', db: 'up', dbHost }, error: null, meta: null });
  } catch {
    return NextResponse.json(
      { data: { status: 'degraded', db: 'down', dbHost }, error: 'db_unreachable', meta: null },
      { status: 503 },
    );
  }
}
