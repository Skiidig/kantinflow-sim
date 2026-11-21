import jwt from 'jsonwebtoken';
import { ObjectId } from 'mongodb';
import { ApiError } from '../api-error.mjs';

export const ROLES = Object.freeze({
  ADMIN: 'admin',
  PETUGAS: 'petugas',
});

export function createAuthenticate({ db, jwtSecret }) {
  return async function authenticate(req, res, next) {
    const token = /^Bearer (\S+)$/iu.exec(req.get('Authorization') ?? '')?.[1];
    let claims;
    try {
      claims = jwt.verify(token, jwtSecret, { algorithms: ['HS256'] });
    } catch {
      throw new ApiError(401, 'UNAUTHENTICATED');
    }
    if (typeof claims.sub !== 'string' || !/^[a-f0-9]{24}$/iu.test(claims.sub)) {
      throw new ApiError(401, 'UNAUTHENTICATED');
    }

    const actorId = new ObjectId(claims.sub);
    const actor = await db.collection('users').findOne({ _id: actorId, isActive: true });
    if (!actor) throw new ApiError(401, 'UNAUTHENTICATED');

    req.actorId = actorId;
    req.actor = actor;
    next();
  };
}

export function authorize(...allowedRoles) {
  return function requireRole(req, res, next) {
    if (!req.actor) throw new ApiError(401, 'UNAUTHENTICATED');
    if (!allowedRoles.includes(req.actor.role)) {
      throw new ApiError(403, 'FORBIDDEN');
    }
    next();
  };
}
