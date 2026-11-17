import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';

const userSchema = new mongoose.Schema(
  {
    id: { type: String, default: () => randomUUID(), unique: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true }
  },
  { timestamps: true }
);

const tournamentSchema = new mongoose.Schema(
  {
    id: { type: String, default: () => randomUUID(), unique: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: 'FIDE-style randomized CSPRNG pairing tournament.' },
    venue: { type: String, default: 'Ghaziabad, Delhi NCR' },
    date: { type: String, required: true },
    timeControl: { type: String, default: '15+10 Rapid' },
    totalRounds: { type: Number, default: 5 },
    status: { type: String, enum: ['Upcoming', 'Live', 'Completed'], default: 'Live' },
    bannerUrl: { type: String, default: '' },
    directorId: { type: String, required: true, index: true },
    directorName: { type: String, required: true }
  },
  { timestamps: true }
);

const playerSchema = new mongoose.Schema({
  tournamentId: { type: String, required: true, index: true },
  id: { type: String, default: () => randomUUID(), unique: true },
  fideId: { type: String, default: null, trim: true },
  name: { type: String, required: true, trim: true },
  rating: { type: Number, default: 0 },
  gender: { type: String, default: 'Male' },
  age: { type: Number, default: 0 },
  isWithdrawn: { type: Boolean, default: false },
  hadBye: { type: Boolean, default: false }
});

// Allows unlimited unrated players (fideId: null) while preventing duplicate FIDE IDs per tournament
playerSchema.index(
  { tournamentId: 1, fideId: 1 },
  {
    unique: true,
    partialFilterExpression: { fideId: { $type: 'string',$gt: '' } }
  }
);

const roundSchema = new mongoose.Schema({
  tournamentId: { type: String, required: true, index: true },
  roundNumber: { type: Number, required: true },
  boards: { type: Array, default: [] },
  bye: { type: mongoose.Schema.Types.Mixed, default: null },
  isPublished: { type: Boolean, default: false }
});
roundSchema.index({ tournamentId: 1, roundNumber: 1 }, { unique: true });

const matchSchema = new mongoose.Schema({
  tournamentId: { type: String, required: true, index: true },
  round: { type: Number, required: true },
  whiteId: { type: String, required: true },
  blackId: { type: String, required: true },
  result: { type: String, required: true }
});

const auditLogSchema = new mongoose.Schema(
  {
    tournamentId: { type: String, required: true, index: true },
    timestamp: { type: String, required: true },
    type: { type: String, required: true },
    message: { type: String, required: true }
  },
  { timestamps: true }
);

export const User = mongoose.model('User', userSchema);
export const Tournament = mongoose.model('Tournament', tournamentSchema);
export const Player = mongoose.model('Player', playerSchema);
export const Round = mongoose.model('Round', roundSchema);
export const Match = mongoose.model('Match', matchSchema);
export const AuditLog = mongoose.model('AuditLog', auditLogSchema);