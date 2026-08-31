import assert from 'node:assert/strict';
import test from 'node:test';

import { readVideoDurationMs } from './video-metadata.ts';

function concat(...parts) {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function ascii(value) {
  return Uint8Array.from(value, (character) => character.charCodeAt(0));
}

function uint32(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, false);
  return bytes;
}

function uint64(value) {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(value), false);
  return bytes;
}

function int32(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setInt32(0, value, false);
  return bytes;
}

function box(type, ...payload) {
  const body = concat(...payload);
  return concat(uint32(body.length + 8), ascii(type), body);
}

function fullBox(type, version, flags, ...payload) {
  return box(type, Uint8Array.of(version, (flags >>> 16) & 0xff, (flags >>> 8) & 0xff, flags & 0xff), ...payload);
}

function fileFrom(...boxes) {
  return new File([concat(...boxes)], 'video.mp4', { type: 'video/mp4' });
}

function ftyp() {
  return box('ftyp', ascii('isom'), uint32(0), ascii('isom'), ascii('mp42'));
}

function mvhd(duration, timescale = 1000) {
  return fullBox('mvhd', 0, 0, uint32(0), uint32(0), uint32(timescale), uint32(duration), new Uint8Array(80));
}

function mvhdVersion1(duration, timescale = 1000) {
  return fullBox('mvhd', 1, 0, uint64(0), uint64(0), uint32(timescale), uint64(duration), new Uint8Array(80));
}

function tkhd(trackId) {
  return fullBox('tkhd', 0, 0, uint32(0), uint32(0), uint32(trackId), uint32(0), uint32(0), new Uint8Array(60));
}

function mdhd(timescale, duration = 0) {
  return fullBox('mdhd', 0, 0, uint32(0), uint32(0), uint32(timescale), uint32(duration), uint32(0));
}

function trak(trackId, timescale, duration = 0) {
  return box('trak', tkhd(trackId), box('mdia', mdhd(timescale, duration)));
}

function mehd(duration) {
  return fullBox('mehd', 0, 0, uint32(duration));
}

function mehdVersion1(duration) {
  return fullBox('mehd', 1, 0, uint64(duration));
}

function trex(trackId, defaultSampleDuration) {
  return fullBox('trex', 0, 0, uint32(trackId), uint32(1), uint32(defaultSampleDuration), uint32(0), uint32(0));
}

function tfhd(trackId, defaultSampleDuration) {
  return fullBox('tfhd', 0, defaultSampleDuration === undefined ? 0 : 0x000008, uint32(trackId), ...(defaultSampleDuration === undefined ? [] : [uint32(defaultSampleDuration)]));
}

function emptyTfhd(trackId, defaultSampleDuration) {
  return fullBox('tfhd', 0, 0x010008, uint32(trackId), uint32(defaultSampleDuration));
}

function tfdt(baseDecodeTime) {
  return fullBox('tfdt', 0, 0, uint32(baseDecodeTime));
}

function tfdtVersion1(baseDecodeTime) {
  return fullBox('tfdt', 1, 0, uint64(baseDecodeTime));
}

function trunWithDefault(sampleCount) {
  return fullBox('trun', 0, 0, uint32(sampleCount));
}

function trunWithDurations(...durations) {
  return fullBox('trun', 0, 0x000100, uint32(durations.length), ...durations.map(uint32));
}

function trunWithCompositionOffset(duration, compositionOffset, version = 0) {
  return fullBox('trun', version, 0x000900, uint32(1), uint32(duration), version === 0 ? uint32(compositionOffset) : int32(compositionOffset));
}

function moof(...trackFragmentChildren) {
  return box('moof', box('traf', ...trackFragmentChildren));
}

function fragmentedMovie({ movieDuration = 0, fragmentDuration, defaultSampleDuration = 1000, initialTrackDuration = 0, timescale = 1000 }) {
  const movieExtends = box('mvex', ...(fragmentDuration === undefined ? [] : [mehd(fragmentDuration)]), trex(1, defaultSampleDuration));
  return box('moov', mvhd(movieDuration, timescale), trak(1, timescale, initialTrackDuration), movieExtends);
}

test('reads a regular movie duration from mvhd', async () => {
  const file = fileFrom(ftyp(), box('moov', mvhd(20_000)));
  assert.equal(await readVideoDurationMs(file), 20_000);
});

test('reads a version 1 mvhd duration', async () => {
  const file = fileFrom(ftyp(), box('moov', mvhdVersion1(20_000)));
  assert.equal(await readVideoDurationMs(file), 20_000);
});

test('uses mehd when a fragmented movie has no mvhd duration', async () => {
  const file = fileFrom(ftyp(), fragmentedMovie({ fragmentDuration: 18_500 }));
  assert.equal(await readVideoDurationMs(file), 18_500);
});

test('reads a version 1 mehd duration', async () => {
  const movie = box('moov', mvhd(0), trak(1, 1000), box('mvex', mehdVersion1(19_500), trex(1, 1000)));
  assert.equal(await readVideoDurationMs(fileFrom(ftyp(), movie)), 19_500);
});

test('derives two consecutive fragments from tfdt, trun and trex', async () => {
  const file = fileFrom(
    ftyp(),
    fragmentedMovie({}),
    moof(tfhd(1), tfdt(100_000), trunWithDefault(10)),
    moof(tfhd(1), trunWithDefault(10)),
  );
  assert.equal(await readVideoDurationMs(file), 20_000);
});

test('derives a fragment whose version 1 tfdt starts above uint32 range', async () => {
  const file = fileFrom(ftyp(), fragmentedMovie({}), moof(tfhd(1), tfdtVersion1(5_000_000_000), trunWithDefault(20)));
  assert.equal(await readVideoDurationMs(file), 20_000);
});

test('counts an empty-duration fragment from its resolved default', async () => {
  const file = fileFrom(ftyp(), fragmentedMovie({}), moof(emptyTfhd(1, 5_000), tfdt(0)));
  assert.equal(await readVideoDurationMs(file), 5_000);
});

test('uses an empty terminal traf with tfdt to close the preceding timeline gap', async () => {
  const file = fileFrom(
    ftyp(),
    fragmentedMovie({}),
    moof(tfhd(1), tfdt(0), trunWithDefault(10)),
    moof(tfhd(1), tfdt(20_000)),
  );
  assert.equal(await readVideoDurationMs(file), 20_000);
});

test('rejects duration-is-empty combined with a trun', async () => {
  const file = fileFrom(ftyp(), fragmentedMovie({ movieDuration: 5_000 }), moof(emptyTfhd(1, 5_000), tfdt(0), trunWithDefault(1)));
  assert.equal(await readVideoDurationMs(file), null);
});

test('prefers tfhd default duration over trex', async () => {
  const file = fileFrom(ftyp(), fragmentedMovie({ defaultSampleDuration: 1000 }), moof(tfhd(1, 500), tfdt(0), trunWithDefault(4)));
  assert.equal(await readVideoDurationMs(file), 2_000);
});

test('prefers per-sample trun durations over tfhd and trex', async () => {
  const file = fileFrom(
    ftyp(),
    fragmentedMovie({ defaultSampleDuration: 1000 }),
    moof(tfhd(1, 500), tfdt(0), trunWithDurations(400, 600, 1000)),
  );
  assert.equal(await readVideoDurationMs(file), 2_000);
});

test('does not inflate structural duration with composition offsets', async () => {
  const positive = fileFrom(ftyp(), fragmentedMovie({}), moof(tfhd(1), tfdt(0), trunWithCompositionOffset(1_000, 500)));
  const negative = fileFrom(ftyp(), fragmentedMovie({}), moof(tfhd(1), tfdt(0), trunWithCompositionOffset(1_000, -500, 1)));
  assert.equal(await readVideoDurationMs(positive), 1_000);
  assert.equal(await readVideoDurationMs(negative), 1_000);
});

test('includes samples already described by moov before the first fragment', async () => {
  const file = fileFrom(
    ftyp(),
    fragmentedMovie({ movieDuration: 5_000, initialTrackDuration: 5_000 }),
    moof(tfhd(1), tfdt(5_000), trunWithDefault(20)),
  );
  assert.equal(await readVideoDurationMs(file), 25_000);
});

test('uses the longest structural duration instead of a short mvhd hint', async () => {
  const file = fileFrom(ftyp(), fragmentedMovie({ movieDuration: 5_000 }), moof(tfhd(1), tfdt(0), trunWithDefault(20)));
  assert.equal(await readVideoDurationMs(file), 20_000);
});

test('rejects an invalid fragment instead of trusting a short mvhd', async () => {
  const movie = box('moov', mvhd(5_000), trak(1, 1000), box('mvex', trex(1, 0)));
  const file = fileFrom(ftyp(), movie, moof(tfhd(1), tfdt(0), trunWithDefault(1)));
  assert.equal(await readVideoDurationMs(file), null);
});

test('rejects unknown fragment flags instead of guessing their field layout', async () => {
  const unknownTfhd = fullBox('tfhd', 0, 0x000040, uint32(1));
  const file = fileFrom(ftyp(), fragmentedMovie({ movieDuration: 5_000 }), moof(unknownTfhd, tfdt(0), trunWithDefault(20)));
  assert.equal(await readVideoDurationMs(file), null);
});

test('rejects a truncated trex instead of using its partial defaults', async () => {
  const truncatedTrex = fullBox('trex', 0, 0, uint32(1), uint32(1), uint32(1_000));
  const movie = box('moov', mvhd(5_000), trak(1, 1000), box('mvex', truncatedTrex));
  assert.equal(await readVideoDurationMs(fileFrom(ftyp(), movie)), null);
});

test('skips a large mdat instead of reading its payload', async () => {
  class CountingFile extends File {
    bytesRead = 0;

    slice(start, end, contentType) {
      this.bytesRead += Math.max(0, (end ?? this.size) - (start ?? 0));
      return super.slice(start, end, contentType);
    }
  }

  const source = concat(ftyp(), box('mdat', new Uint8Array(5 * 1024 * 1024)), box('moov', mvhd(10_000)));
  const file = new CountingFile([source], 'video.mp4', { type: 'video/mp4' });
  assert.equal(await readVideoDurationMs(file), 10_000);
  assert.ok(file.bytesRead < 1024, `expected metadata-only reads, got ${file.bytesRead} bytes`);
});
