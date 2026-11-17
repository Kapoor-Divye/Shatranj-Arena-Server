import { performance } from 'node:perf_hooks';
import { getSecureRandomInt, csprngShuffle } from './csprngEngine.js';

export function generateStochasticPairings(activePlayers, matchHistory, logCallback = () => {}) {
  const startTime = performance.now();
  logCallback('INIT', 'Harvesting OS-level entropy via Node.js WebCrypto CSPRNG...');

  const playedPairs = new Set();
  matchHistory.forEach(match => {
    playedPairs.add(`${match.whiteId}__${match.blackId}`);
    playedPairs.add(`${match.blackId}__${match.whiteId}`);
  });

  let pool = csprngShuffle(activePlayers);
  let assignedBye = null;

  if (pool.length % 2 !== 0) {
    const byeCandidates = pool.filter(player => !player.hadBye);
    if (byeCandidates.length === 0) {
      throw new Error('All active players have previously received a bye.');
    }
    const byeIndex = getSecureRandomInt(0, byeCandidates.length);
    assignedBye = byeCandidates[byeIndex];
    pool = pool.filter(player => player.id !== assignedBye.id);
    logCallback('BYE_ASSIGN', `Assigned bye to Player ID: ${assignedBye.id}`);
  }

  const pairings = [];

  function solveMatching(remaining) {
    if (remaining.length === 0) return true;

    const candidateA = remaining[0];
    let validOpponents = remaining.slice(1).filter(candidateB => {
      return !playedPairs.has(`${candidateA.id}__${candidateB.id}`);
    });

    validOpponents = csprngShuffle(validOpponents);

    for (const candidateB of validOpponents) {
      const isWhite = getSecureRandomInt(0, 2) === 0;
      const boardPair = {
        white: isWhite ? candidateA : candidateB,
        black: isWhite ? candidateB : candidateA
      };

      pairings.push(boardPair);
      const nextRemaining = remaining.slice(1).filter(p => p.id !== candidateB.id);

      if (solveMatching(nextRemaining)) return true;

      pairings.pop();
    }

    return false;
  }

  const success = solveMatching(pool);
  const latency = (performance.now() - startTime).toFixed(3);

  if (!success) {
    logCallback('ERROR', `Deadlock encountered. Zero-rematch pairing impossible (${latency}ms).`);
    throw new Error('No conflict-free pairing combination exists.');
  }

  logCallback('SUCCESS', `Pairing solved in ${latency}ms across ${pairings.length} boards.`);
  return { pairings, bye: assignedBye };
}