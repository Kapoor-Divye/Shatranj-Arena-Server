import jwt from 'jsonwebtoken';
import { Tournament } from '../models/Schemas.js';

const JWT_SECRET = process.env.JWT_SECRET || 'shatranj_csprng_super_secret_2026';

export function signToken(user) {
  return jwt.sign(
    { id: user.id, name: user.name, email: user.email },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

export function optionalAuth(req, res, next) {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    try {
      req.user = jwt.verify(header.slice(7), JWT_SECRET);
    } catch {
      req.user = null;
    }
  } else {
    req.user = null;
  }
  next();
}

export function requireAuth(req, res, next) {
  optionalAuth(req, res, () => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required. Please log in.' });
    }
    next();
  });
}

export async function requireDirector(req, res, next) {
  try {
    const tournament = await Tournament.findOne({ id: req.params.tournamentId }).lean();
    if (!tournament) {
      return res.status(404).json({ error: 'Tournament not found.' });
    }
    if (!req.user || tournament.directorId !== req.user.id) {
      return res.status(403).json({
        error: 'Access Denied: Only the Tournament Director can modify this event.'
      });
    }
    req.tournament = tournament;
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}