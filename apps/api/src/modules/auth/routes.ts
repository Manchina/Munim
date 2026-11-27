import argon2 from 'argon2';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Database } from '@munim/db';
import { loginInput, acceptInviteInput, type Me } from '@munim/contracts';
import { fail, hash, one, rows, token } from '../../lib/core';
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
      const [session] = await rows<{ userId: string }>(
        db,
        'SELECT s.user_id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND u.active=true',
        [hash(sessionToken)],
      );
      req.userId = session?.userId ?? '';
    }
    if (!publicRoute && !req.userId) fail(401, 'UNAUTHENTICATED', 'Please sign in.');
  });
  const setSession = async (userId: string, reply: FastifyReply) => {
    const raw = token();
    await db.query(
      "INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '7 days')",
      [userId, hash(raw)],
    );
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
      const [user] = await rows<{ id: string; passwordHash: string; active: boolean }>(
        db,
        'SELECT id,password_hash,active FROM users WHERE email=$1',
        [input.email],
      );
      const valid = await argon2.verify(user?.passwordHash ?? dummyHash, input.password);
      if (!user || !valid || !user.active)
        fail(401, 'LOGIN_FAILED', 'Email or password is incorrect.');
      await setSession(user!.id, reply);
      return { ok: true };
    },
  );
  app.post('/api/v1/auth/logout', async (req, reply) => {
    if (req.cookies.munim_session)
      await db.query('UPDATE sessions SET revoked_at=now() WHERE token_hash=$1', [
        hash(req.cookies.munim_session),
      ]);
    reply.clearCookie('munim_session', { path: '/' });
    return { ok: true };
  });
  app.get('/api/v1/auth/me', async (req) => {
    const user = await one<Omit<Me, 'stores'>>(db, 'SELECT id,email FROM users WHERE id=$1', [
      req.userId,
    ]);
    const stores = await rows<Me['stores'][number]>(
      db,
      'SELECT s.id AS store_id,s.name,m.role FROM store_memberships m JOIN stores s ON s.id=m.store_id WHERE m.user_id=$1 ORDER BY s.name',
      [req.userId],
    );
    return { ...user, stores };
  });
  app.post(
    '/api/v1/auth/accept-invite',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const input = acceptInviteInput.parse(req.body);
      const userId = await db.transaction(async (tx) => {
        const invite = await one<{ id: string; email: string; storeId: string; role: string }>(
          tx,
          'SELECT * FROM account_invites WHERE token_hash=$1 AND accepted_at IS NULL AND expires_at>now() FOR UPDATE',
          [hash(input.token)],
        );
        // Serialize invitations for the same email across stores.
        await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [invite.email]);
        let [user] = await rows<{ id: string; active: boolean }>(
          tx,
          'SELECT id,active FROM users WHERE email=$1',
          [invite.email],
        );
        if (user) {
          if (!user.active || req.userId !== user.id)
            fail(403, 'SIGN_IN_REQUIRED', 'Sign in with the invited email before accepting.');
        } else {
          if (!input.password)
            fail(422, 'PASSWORD_REQUIRED', 'Set a password to accept your invitation.');
          user = await one<{ id: string; active: boolean }>(
            tx,
            'INSERT INTO users(email,password_hash) VALUES($1,$2) RETURNING id,active',
            [invite.email, await argon2.hash(input.password!)],
          );
        }
        await tx.query(
          'INSERT INTO store_memberships(store_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT(store_id,user_id) DO NOTHING',
          [invite.storeId, user!.id, invite.role],
        );
        await tx.query('UPDATE account_invites SET accepted_at=now() WHERE id=$1', [invite.id]);
        return user!.id;
      });
      await setSession(userId, reply);
      return { ok: true };
    },
  );
}
export async function authorize(req: FastifyRequest, db: Database, owner = false) {
  const { storeId } = req.params as { storeId: string };
  const [membership] = await rows<{ role: 'owner' | 'staff' }>(
    db,
    'SELECT role FROM store_memberships WHERE store_id=$1 AND user_id=$2',
    [storeId, req.userId],
  );
  if (!membership) fail(404, 'NOT_FOUND', 'Store was not found.');
  if (owner && membership!.role !== 'owner')
    fail(403, 'OWNER_REQUIRED', 'Only the store owner can make this change.');
  return { storeId, userId: req.userId, role: membership!.role };
}
