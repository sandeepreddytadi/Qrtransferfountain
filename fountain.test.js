const assert = require('node:assert/strict');
const test = require('node:test');

require('./fountain.js');

const { encode, createDecoder } = globalThis.FountainCodec;

test('reconstructs 467 source blocks despite lost and repeated symbols', () => {
  const sourceCount = 467;
  const blockSize = 32;
  const sourceBlocks = Array.from({ length: sourceCount }, (_, index) =>
    Uint8Array.from({ length: blockSize }, (_, byte) => (index * 31 + byte * 17) & 255)
  );
  const decoder = createDecoder(sourceCount, blockSize);

  for (let symbolId = 0; symbolId < sourceCount * 5 && !decoder.complete; symbolId++) {
    if ((symbolId * 29 + 11) % 5 === 0) continue;
    const symbol = encode(symbolId, sourceBlocks, blockSize);
    const result = decoder.add(symbolId, symbol);
    assert.equal(result.duplicate, false);
    assert.equal(decoder.add(symbolId, symbol).duplicate, true);
  }

  assert.equal(decoder.complete, true);
  for (let index = 0; index < sourceCount; index++) {
    assert.deepEqual(decoder.blocks[index], sourceBlocks[index]);
  }
});

test('handles a one-block file', () => {
  const source = [Uint8Array.from([1, 2, 3, 4])];
  const decoder = createDecoder(1, source[0].length);

  decoder.add(0, encode(0, source, source[0].length));

  assert.equal(decoder.complete, true);
  assert.deepEqual(decoder.blocks[0], source[0]);
});

test('reconstructs a 2 MiB file with 1,800-byte symbols and missed QR frames', () => {
  const fileSize = 2 * 1024 * 1024;
  const blockSize = 1800;
  const sourceCount = Math.ceil(fileSize / blockSize);
  const sourceBlocks = Array.from({ length: sourceCount }, (_, index) => {
    const block = new Uint8Array(blockSize);
    for (let byte = 0; byte < blockSize; byte++) block[byte] = (index * 31 + byte * 17) & 255;
    return block;
  });
  const decoder = createDecoder(sourceCount, blockSize);

  for (let symbolId = 0; symbolId < sourceCount * 3 && !decoder.complete; symbolId++) {
    if (symbolId % 5 === 0) continue;
    decoder.add(symbolId, encode(symbolId, sourceBlocks, blockSize));
  }

  assert.equal(decoder.complete, true);
  for (let index = 0; index < sourceCount; index++) {
    assert.deepEqual(decoder.blocks[index], sourceBlocks[index]);
  }
});