import express from 'express';
import { Tournament, Player, Round, Match, AuditLog } from '../models/Schemas.js';
import { generateStochasticPairings } from '../services/pairingEngine.js';
import { optionalAuth, requireAuth, requireDirector } from '../middlewares/auth.js';

const router = express.Router();

// 1. List all tournaments for the Landing Dashboard
router.get('/', async (req, res) => {
  try {
    const tournaments = await Tournament.find({}, '-_id -__v').sort({ createdAt: -1 }).lean();
    const enriched = await Promise.all(
      tournaments.map(async t => {
        const playerCount = await Player.countDocuments({ tournamentId: t.id, isWithdrawn: false });
        const roundsGenerated = await Round.countDocuments({ tournamentId: t.id });
        return { ...t, playerCount, roundsGenerated };
      })
    );
    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Create a new tournament (logged-in user becomes Tournament Director)
router.post('/', requireAuth, async (req, res) => {
  try {
    const title = (req.body.title || '').trim();
    if (!title) return res.status(400).json({ error: 'Tournament title is required.' });

    const created = await Tournament.create({
      title,
      description: (req.body.description || '').trim() || 'Official CSPRNG randomized chess event.',
      venue: (req.body.venue || '').trim() || 'Ghaziabad, Delhi NCR',
      date: req.body.date || new Date().toISOString().split('T')[0],
      timeControl: (req.body.timeControl || '').trim() || '15+10 Rapid',
      totalRounds: Number(req.body.totalRounds) || 5,
      status: req.body.status || 'Live',
      bannerUrl: (req.body.bannerUrl || '').trim(),
      directorId: req.user.id,
      directorName: req.user.name
    });

    const { _id, __v, ...tournament } = created.toObject();
    res.status(201).json({ ...tournament, playerCount: 0, roundsGenerated: 0 });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 3. Hydrate a single tournament's full state + director permission flag
router.get('/:tournamentId/state', optionalAuth, async (req, res) => {
  try {
    const { tournamentId } = req.params;
    const tournament = await Tournament.findOne({ id: tournamentId }, '-_id -__v').lean();
    if (!tournament) return res.status(404).json({ error: 'Tournament not found.' });

    const [players, rounds, matchHistory, auditLogs] = await Promise.all([
      Player.find({ tournamentId }, '-_id -__v').lean(),
      Round.find({ tournamentId }, '-_id -__v').lean(),
      Match.find({ tournamentId }, '-_id -__v').lean(),
      AuditLog.find({ tournamentId }, '-_id -__v -createdAt -updatedAt').sort({ createdAt: 1 }).lean()
    ]);

    const roundsData = {};
    rounds.forEach(r => {
      roundsData[r.roundNumber] = {
        boards: r.boards,
        bye: r.bye,
        isPublished: r.isPublished
      };
    });

    const isDirector = Boolean(req.user && req.user.id === tournament.directorId);

    res.json({ tournament, isDirector, players, roundsData, matchHistory, auditLogs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Add player (Director only)
router.post('/:tournamentId/players', requireAuth, requireDirector, async (req, res) => {
  try {
    const rawFideId = (req.body.fideId ?? '').toString().trim();
    const fideId = rawFideId === '' ? null : rawFideId;

    const created = await Player.create({
      tournamentId: req.params.tournamentId,
      fideId,
      name: (req.body.name || '').trim(),
      rating: Number(req.body.rating) || 0,
      gender: req.body.gender || 'Male',
      age: Number(req.body.age) || 0,
      isWithdrawn: Boolean(req.body.isWithdrawn),
      hadBye: Boolean(req.body.hadBye)
    });

    const { _id, __v, ...player } = created.toObject();
    res.status(201).json(player);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ error: 'A player with this FIDE ID is already registered in this tournament.' });
    }
    res.status(400).json({ error: err.message });
  }
});

// 5. Update player (Director only)
router.put('/:tournamentId/players/:id', requireAuth, requireDirector, async (req, res) => {
  try {
    const updatePayload = { ...req.body };
    delete updatePayload.id;
    delete updatePayload._id;
    delete updatePayload.tournamentId;

    if ('fideId' in updatePayload) {
      const trimmed = (updatePayload.fideId ?? '').toString().trim();
      updatePayload.fideId = trimmed === '' ? null : trimmed;
    }

    const updated = await Player.findOneAndUpdate(
      { tournamentId: req.params.tournamentId, id: req.params.id },
      updatePayload,
      { new: true, runValidators: true, projection: '-_id -__v' }
    ).lean();

    if (!updated) return res.status(404).json({ error: 'Player not found' });
    res.json(updated);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ error: 'A player with this FIDE ID already exists in this tournament.' });
    }
    res.status(400).json({ error: err.message });
  }
});

// 6. Toggle withdrawal (Director only)
router.patch('/:tournamentId/players/:id/withdraw', requireAuth, requireDirector, async (req, res) => {
  try {
    const player = await Player.findOne({ tournamentId: req.params.tournamentId, id: req.params.id });
    if (!player) return res.status(404).json({ error: 'Player not found' });

    player.isWithdrawn = !player.isWithdrawn;
    await player.save();

    const { _id, __v, ...cleanPlayer } = player.toObject();
    res.json(cleanPlayer);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 7. Generate CSPRNG pairings (Director only)
router.post('/:tournamentId/pairings/generate/:roundNum', requireAuth, requireDirector, async (req, res) => {
  const { tournamentId } = req.params;
  const roundNum = Number(req.params.roundNum);
  const generatedLogs = [];

  const logCallback = (type, message) => {
    generatedLogs.push({
      tournamentId,
      timestamp: new Date().toLocaleTimeString(),
      type,
      message
    });
  };

  try {
    const activePool = await Player.find({ tournamentId, isWithdrawn: false }, '-_id -__v').lean();
    if (activePool.length < 2) {
      throw new Error('At least 2 active players are required to generate pairings.');
    }

    const matchHistory = await Match.find({ tournamentId }, '-_id -__v').lean();
    const result = generateStochasticPairings(activePool, matchHistory, logCallback);

    const formattedBoards = result.pairings.map((p, idx) => ({
      board: idx + 1,
      white: p.white,
      black: p.black,
      result: null
    }));

    if (result.bye) {
      await Player.updateOne({ tournamentId, id: result.bye.id }, { $set: { hadBye: true } });
    }

    const roundDoc = await Round.findOneAndUpdate(
      { tournamentId, roundNumber: roundNum },
      { tournamentId, roundNumber: roundNum, boards: formattedBoards, bye: result.bye, isPublished: false },
      { upsert: true, new: true }
    ).lean();

    if (generatedLogs.length > 0) await AuditLog.insertMany(generatedLogs);
    const updatedPlayers = await Player.find({ tournamentId }, '-_id -__v').lean();

    res.json({
      roundData: {
        boards: roundDoc.boards,
        bye: roundDoc.bye,
        isPublished: roundDoc.isPublished
      },
      players: updatedPlayers,
      logs: generatedLogs
    });
  } catch (err) {
    if (generatedLogs.length > 0) await AuditLog.insertMany(generatedLogs);
    res.status(400).json({ error: err.message, logs: generatedLogs });
  }
});

// 8. Revert Round Pairings cleanly (Director only)
router.delete('/:tournamentId/pairings/:roundNum', requireAuth, requireDirector, async (req, res) => {
  try {
    const { tournamentId } = req.params;
    const roundNum = Number(req.params.roundNum);

    const existingRound = await Round.findOne({ tournamentId, roundNumber: roundNum }).lean();
    if (existingRound?.bye?.id) {
      await Player.updateOne({ tournamentId, id: existingRound.bye.id }, { $set: { hadBye: false } });
    }

    await Round.deleteOne({ tournamentId, roundNumber: roundNum });
    await Match.deleteMany({ tournamentId, round: roundNum });

    const logEntry = await AuditLog.create({
      tournamentId,
      timestamp: new Date().toLocaleTimeString(),
      type: 'REVERT',
      message: `Reverted pairings and results for Round ${roundNum}.`
    });

    const [rounds, players, matchHistory] = await Promise.all([
      Round.find({ tournamentId }, '-_id -__v').lean(),
      Player.find({ tournamentId }, '-_id -__v').lean(),
      Match.find({ tournamentId }, '-_id -__v').lean()
    ]);

    const roundsData = {};
    rounds.forEach(r => {
      roundsData[r.roundNumber] = {
        boards: r.boards,
        bye: r.bye,
        isPublished: r.isPublished
      };
    });

    res.json({
      roundsData,
      players,
      matchHistory,
      log: { timestamp: logEntry.timestamp, type: logEntry.type, message: logEntry.message }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 9. Sync rounds (Director only)
router.put('/:tournamentId/rounds/sync', requireAuth, requireDirector, async (req, res) => {
  try {
    const { tournamentId } = req.params;
    const { roundsData } = req.body;
    const ops = Object.entries(roundsData).map(([roundNum, data]) => ({
      updateOne: {
        filter: { tournamentId, roundNumber: Number(roundNum) },
        update: {
          tournamentId,
          roundNumber: Number(roundNum),
          boards: data.boards,
          bye: data.bye,
          isPublished: data.isPublished
        },
        upsert: true
      }
    }));
    if (ops.length > 0) await Round.bulkWrite(ops);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 10. Sync match history (Director only)
router.put('/:tournamentId/matches/sync', requireAuth, requireDirector, async (req, res) => {
  try {
    const { tournamentId } = req.params;
    const { matchHistory } = req.body;
    await Match.deleteMany({ tournamentId });
    if (matchHistory.length > 0) {
      await Match.insertMany(matchHistory.map(m => ({ ...m, tournamentId })));
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 11. Persist audit log (Director only)
router.post('/:tournamentId/logs', requireAuth, requireDirector, async (req, res) => {
  try {
    const saved = await AuditLog.create({ ...req.body, tournamentId: req.params.tournamentId });
    res.status(201).json(saved);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 12. Delete entire tournament & all associated data (Director only)
router.delete('/:tournamentId', requireAuth, requireDirector, async (req, res) => {
  try {
    const { tournamentId } = req.params;

    await Promise.all([
      Tournament.deleteOne({ id: tournamentId }),
      Player.deleteMany({ tournamentId }),
      Round.deleteMany({ tournamentId }),
      Match.deleteMany({ tournamentId }),
      AuditLog.deleteMany({ tournamentId })
    ]);

    res.json({ ok: true, deletedId: tournamentId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;