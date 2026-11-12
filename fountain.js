(function (root) {
  const distributionCache = new Map();

  function makeDistribution(sourceCount) {
    if (distributionCache.has(sourceCount)) return distributionCache.get(sourceCount);

    const weights = new Float64Array(sourceCount + 1);
    if (sourceCount === 1) {
      weights[1] = 1;
    } else {
      const delta = 0.05;
      const c = 0.1;
      const r = c * Math.log(sourceCount / delta) * Math.sqrt(sourceCount);
      const pivot = Math.max(1, Math.min(sourceCount, Math.floor(sourceCount / r)));

      weights[1] = 1 / sourceCount;
      for (let degree = 2; degree <= sourceCount; degree++) {
        weights[degree] = 1 / (degree * (degree - 1));
      }
      for (let degree = 1; degree < pivot; degree++) {
        weights[degree] += r / (degree * sourceCount);
      }
      weights[pivot] += r * Math.log(r / delta) / sourceCount;
    }

    let sum = 0;
    for (let degree = 1; degree <= sourceCount; degree++) sum += weights[degree];
    const cumulative = new Float64Array(sourceCount + 1);
    let running = 0;
    for (let degree = 1; degree <= sourceCount; degree++) {
      running += weights[degree] / sum;
      cumulative[degree] = running;
    }
    cumulative[sourceCount] = 1;
    distributionCache.set(sourceCount, cumulative);
    return cumulative;
  }

  function makeRandom(symbolId) {
    let state = Math.imul((symbolId + 1) >>> 0, 0x9e3779b1) >>> 0;
    if (state === 0) state = 0x6d2b79f5;
    return function () {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return (state >>> 0) / 4294967296;
    };
  }

  function indicesFor(symbolId, sourceCount) {
    if (!Number.isInteger(symbolId) || symbolId < 0 || !Number.isInteger(sourceCount) || sourceCount < 1) {
      throw new RangeError('Invalid fountain symbol or source count');
    }
    if (symbolId < sourceCount) return [symbolId];

    const random = makeRandom(symbolId);
    const cumulative = makeDistribution(sourceCount);
    const sample = random();
    let degree = 1;
    while (degree < sourceCount && sample > cumulative[degree]) degree++;

    const swaps = new Map();
    const selected = [];
    for (let position = 0; position < degree; position++) {
      const other = position + Math.floor(random() * (sourceCount - position));
      const value = swaps.has(other) ? swaps.get(other) : other;
      const current = swaps.has(position) ? swaps.get(position) : position;
      swaps.set(other, current);
      selected.push(value);
    }
    return selected;
  }

  function encode(symbolId, sourceBlocks, blockSize) {
    const indexes = indicesFor(symbolId, sourceBlocks.length);
    const data = new Uint8Array(blockSize);
    for (const index of indexes) {
      const block = sourceBlocks[index];
      for (let byte = 0; byte < blockSize; byte++) data[byte] ^= block[byte];
    }
    return data;
  }

  function createDecoder(sourceCount, blockSize) {
    const known = new Array(sourceCount);
    const adjacency = Array.from({ length: sourceCount }, () => new Set());
    const equations = new Map();
    const seenSymbols = new Set();
    let solvedCount = 0;

    function add(symbolId, symbolData) {
      if (seenSymbols.has(symbolId)) return { duplicate: true, solved: [], solvedCount };
      seenSymbols.add(symbolId);
      if (!(symbolData instanceof Uint8Array) || symbolData.length !== blockSize) {
        return { duplicate: false, solved: [], solvedCount };
      }

      const indexes = indicesFor(symbolId, sourceCount);
      const equation = { indexes: new Set(indexes), data: symbolData.slice() };
      for (const index of indexes) {
        if (known[index]) {
          equation.indexes.delete(index);
          for (let byte = 0; byte < blockSize; byte++) equation.data[byte] ^= known[index][byte];
        }
      }
      if (equation.indexes.size === 0) return { duplicate: false, solved: [], solvedCount };

      equations.set(symbolId, equation);
      for (const index of equation.indexes) adjacency[index].add(symbolId);
      const queue = [];
      if (equation.indexes.size === 1) queue.push(equation.indexes.values().next().value);
      const solved = [];

      while (queue.length) {
        const index = queue.pop();
        if (known[index]) continue;

        let sourceEquation;
        for (const equationId of adjacency[index]) {
          const candidate = equations.get(equationId);
          if (candidate && candidate.indexes.size === 1 && candidate.indexes.has(index)) {
            sourceEquation = candidate;
            equations.delete(equationId);
            break;
          }
        }
        if (!sourceEquation) continue;

        known[index] = sourceEquation.data;
        solvedCount++;
        solved.push(index);

        for (const equationId of adjacency[index]) {
          const candidate = equations.get(equationId);
          if (!candidate || !candidate.indexes.delete(index)) continue;
          if (candidate.indexes.size === 0) {
            equations.delete(equationId);
            continue;
          }
          for (let byte = 0; byte < blockSize; byte++) {
            candidate.data[byte] ^= known[index][byte];
          }
          if (candidate.indexes.size === 1) {
            queue.push(candidate.indexes.values().next().value);
          }
        }
      }

      return { duplicate: false, solved, solvedCount };
    }

    return {
      add,
      get complete() { return solvedCount === sourceCount; },
      get solvedCount() { return solvedCount; },
      get blocks() { return known; },
    };
  }

  root.FountainCodec = { indicesFor, encode, createDecoder };
})(globalThis);