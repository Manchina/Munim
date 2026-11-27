import argon2 from 'argon2';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { schema, type Database } from '@munim/db';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { loginInput, acceptInviteInput } from '@munim/contracts';
import { fail, hash, one, token } from '../../lib/core';
const { sessions, users, memberships, stores, invites } = schema;
declare module 'fastify' {
  interface FastifyRequest {
    userId: string;
  }
}
export async function registerAuth(app: FastifyInstance, db: Database, production: boolean) {
  const dummyHash = await argon2.hash(token());
  app.decorateRequest('userId', '');
  app.addHook('preHandler', async (req) => {
    const route = req.routeOptions.url ?? '';
    const publicRoute =
      route.startsWith('/health/') ||
      route.startsWith('/api/v1/receipts/') ||
      ['/api/v1/auth/login', '/api/v1/auth/accept-invite'].includes(route);
    const sessionToken = req.cookies.munim_session;
    if (sessionToken) {
      const [session] = await db
        .select({ userId: sessions.userId })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .where(
          and(
            eq(sessions.tokenHash, hash(sessionToken)),
            isNull(sessions.revokedAt),
            gt(sessions.expiresAt, new Date()),
            eq(users.active, true),
          ),
        );
      req.userId = session?.userId ?? '';
    }
    if (!publicRoute && !req.userId) fail(401, 'UNAUTHENTICATED', 'Please sign in.');
  });
  const setSession = async (userId: string, reply: FastifyReply) => {
    const raw = token();
    await db
      .insert(sessions)
      .values({ userId, tokenHash: hash(raw), expiresAt: new Date(Date.now() + 7 * 86400000) });
    reply.setCookie('munim_session', raw, {
      path: '/',
      httpOnly: true,
      secure: production,
      sameSite: 'strict',
      maxAge: 604800,
    });
  };
  app.post(
    '/api/v1/auth/login',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const input = loginInput.parse(req.body);
      const [user] = await db
        .select({ id: users.id, passwordHash: users.passwordHash, active: users.active })
        .from(users)
        .where(eq(users.email, input.email));
      const valid = await argon2.verify(user?.passwordHash ?? dummyHash, input.password);
      if (!user || !valid || !user.active)
        fail(401, 'LOGIN_FAILED', 'Email or password is incorrect.');
      await setSession(user!.id, reply);
      return { ok: true };
    },
  );
  app.post('/api/v1/auth/logout', async (req, reply) => {
    if (req.cookies.munim_session)
      await db
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(eq(sessions.tokenHash, hash(req.cookies.munim_session)));
    reply.clearCookie('munim_session', { path: '/' });
    return { ok: true };
  });
  app.get('/api/v1/auth/me', async (req) => {
    const user = await one(
      db.select({ id: users.id, email: users.email }).from(users).where(eq(users.id, req.userId)),
    );
    const userStores = await db
      .select({ storeId: stores.id, name: stores.name, role: memberships.role })
      .from(memberships)
      .innerJoin(stores, eq(stores.id, memberships.storeId))
      .where(eq(memberships.userId, req.userId))
      .orderBy(stores.name);
    return { ...user, stores: userStores };
  });
  app.post(
    '/api/v1/auth/accept-invite',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const input = acceptInviteInput.parse(req.body);
      const userId = await db.transaction(async (tx) => {
        const invite = await one(
          tx
            .select()
            .from(invites)
            .where(
              and(
                eq(invites.tokenHash, hash(input.token)),
                isNull(invites.acceptedAt),
                gt(invites.expiresAt, new Date()),
              ),
            )
            .for('update'),
        );
        // Serialize invitations for the same email across stores.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${invite.email}, 0))`);
        let [user] = await tx
          .select({ id: users.id, active: users.active })
          .from(users)
          .where(eq(users.email, invite.email));
        if (user) {
          if (!user.active || req.userId !== user.id)
            fail(403, 'SIGN_IN_REQUIRED', 'Sign in with the invited email before accepting.');
        } else {
          if (!input.password)
            fail(422, 'PASSWORD_REQUIRED', 'Set a password to accept your invitation.');
          user = await one(
            tx
              .insert(users)
              .values({ email: invite.email, passwordHash: await argon2.hash(input.password!) })
              .returning({ id: users.id, active: users.active }),
          );
        }
        await tx
          .insert(memberships)
          .values({ storeId: invite.storeId, userId: user!.id, role: invite.role })
          .onConflictDoNothing({ target: [memberships.storeId, memberships.userId] });
        await tx.update(invites).set({ acceptedAt: new Date() }).where(eq(invites.id, invite.id));
        return user!.id;
      });
      await setSession(userId, reply);
      return { ok: true };
    },
  );
}
export async function authorize(req: FastifyRequest, db: Database, owner = false) {
  const { storeId } = req.params as { storeId: string };
  const [membership] = await db
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.storeId, storeId), eq(memberships.userId, req.userId)));
  if (!membership) fail(404, 'NOT_FOUND', 'Store was not found.');
  if (owner && membership!.role !== 'owner')
    fail(403, 'OWNER_REQUIRED', 'Only the store owner can make this change.');
  return { storeId, userId: req.userId, role: membership!.role };
}
