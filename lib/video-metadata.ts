type IsoBox = {
  type: string;
  dataOffset: number;
  end: number;
};

type ParseBudget = {
  boxesRemaining: number;
  bytesRemaining: number;
  samplesRemaining: number;
};

type MovieHeader = {
  timescale: number;
  durationUnits: number | null;
};

type TrackMetadata = {
  timescale: number;
  initialDurationUnits: number | null;
};

type TrackFragmentHeader = {
  trackId: number;
  defaultSampleDuration: number | undefined;
  durationIsEmpty: boolean;
};

type TrackTimeline = {
  timescale: number;
  nextDecodeTime: number | null;
  minTime: number;
  maxTime: number;
  hasTiming: boolean;
};

const MAX_BOXES_TO_INSPECT = 20_000;
const MAX_METADATA_BYTES_TO_READ = 8 * 1024 * 1024;
const MAX_SAMPLES_TO_INSPECT = 1_000_000;
const MAX_DURATION_MS = 24 * 60 * 60 * 1000;
const UINT32_UNKNOWN = 0xffff_ffff;
const UINT64_UNKNOWN = BigInt('18446744073709551615');
const TFHD_KNOWN_FLAGS = 0x03003b;
const TRUN_KNOWN_FLAGS = 0x000f05;

function boxType(bytes: Uint8Array) {
  return String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]);
}

async function readBytes(file: File, start: number, end: number, budget: ParseBudget) {
  const length = end - start;
  if (start < 0 || length < 0 || end > file.size || length > budget.bytesRemaining) return null;
  budget.bytesRemaining -= length;
  const bytes = new Uint8Array(await file.slice(start, end).arrayBuffer());
  return bytes.length === length ? bytes : null;
}

async function readBox(file: File, offset: number, parentEnd: number, budget: ParseBudget): Promise<IsoBox | null> {
  if (offset < 0 || offset + 8 > parentEnd || budget.boxesRemaining <= 0) return null;
  budget.boxesRemaining -= 1;
  const firstBytes = await readBytes(file, offset, Math.min(offset + 16, parentEnd), budget);
  if (!firstBytes || firstBytes.length < 8) return null;
  const view = new DataView(firstBytes.buffer, firstBytes.byteOffset, firstBytes.byteLength);
  const shortSize = view.getUint32(0, false);
  const type = boxType(firstBytes);
  let headerSize = 8;
  let size = shortSize;
  if (shortSize === 1) {
    if (firstBytes.length < 16) return null;
    const extendedSize = view.getBigUint64(8, false);
    if (extendedSize > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    size = Number(extendedSize);
    headerSize = 16;
  } else if (shortSize === 0) {
    size = parentEnd - offset;
  }
  if (!Number.isSafeInteger(size) || size < headerSize) return null;
  const end = offset + size;
  if (!Number.isSafeInteger(end) || end > parentEnd || end <= offset) return null;
  return { type, dataOffset: offset + headerSize, end };
}

async function listBoxes(file: File, start: number, end: number, budget: ParseBudget) {
  const boxes: IsoBox[] = [];
  let offset = start;
  while (offset + 8 <= end) {
    const box = await readBox(file, offset, end, budget);
    if (!box) return null;
    boxes.push(box);
    offset = box.end;
  }
  return offset === end ? boxes : null;
}

async function readBoxPrefix(file: File, box: IsoBox, maximumLength: number, budget: ParseBudget) {
  return readBytes(file, box.dataOffset, Math.min(box.end, box.dataOffset + maximumLength), budget);
}

function fullBoxFlags(bytes: Uint8Array) {
  return (bytes[1] << 16) | (bytes[2] << 8) | bytes[3];
}

function knownUint32Duration(value: number) {
  return value === 0 || value === UINT32_UNKNOWN ? null : value;
}

function knownUint64Duration(value: bigint) {
  if (value === BigInt(0) || value === UINT64_UNKNOWN || value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(value);
}

function durationToMs(durationUnits: number | null, timescale: number) {
  if (!durationUnits || !timescale || !Number.isSafeInteger(durationUnits) || !Number.isSafeInteger(timescale)) return null;
  const durationMs = (durationUnits / timescale) * 1000;
  return Number.isFinite(durationMs) && durationMs > 0 && durationMs <= MAX_DURATION_MS ? Math.round(durationMs) : null;
}

function safeAdd(left: number, right: number) {
  const value = left + right;
  return Number.isSafeInteger(value) ? value : null;
}

async function readMovieHeader(file: File, movieHeader: IsoBox, budget: ParseBudget): Promise<MovieHeader | null> {
  const bytes = await readBoxPrefix(file, movieHeader, 32, budget);
  if (!bytes || bytes.length < 20) return null;
  if (fullBoxFlags(bytes) !== 0) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = bytes[0];
  if (version === 0) {
    const timescale = view.getUint32(12, false);
    if (!timescale) return null;
    return { timescale, durationUnits: knownUint32Duration(view.getUint32(16, false)) };
  }
  if (version === 1 && bytes.length >= 32) {
    const timescale = view.getUint32(20, false);
    if (!timescale) return null;
    return { timescale, durationUnits: knownUint64Duration(view.getBigUint64(24, false)) };
  }
  return null;
}

async function readFragmentDurationHint(file: File, movieExtendsHeader: IsoBox, budget: ParseBudget) {
  const bytes = await readBoxPrefix(file, movieExtendsHeader, 12, budget);
  if (!bytes || bytes.length < 8) return null;
  if (fullBoxFlags(bytes) !== 0) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes[0] === 0) return knownUint32Duration(view.getUint32(4, false));
  if (bytes[0] === 1 && bytes.length >= 12) return knownUint64Duration(view.getBigUint64(4, false));
  return null;
}

async function readTrackId(file: File, trackHeader: IsoBox, budget: ParseBudget) {
  const bytes = await readBoxPrefix(file, trackHeader, 24, budget);
  if (!bytes || bytes.length < 16) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const trackId = bytes[0] === 0 ? view.getUint32(12, false) : bytes[0] === 1 && bytes.length >= 24 ? view.getUint32(20, false) : 0;
  return trackId > 0 ? trackId : null;
}

async function readMediaHeader(file: File, mediaHeader: IsoBox, budget: ParseBudget): Promise<TrackMetadata | null> {
  const bytes = await readBoxPrefix(file, mediaHeader, 32, budget);
  if (!bytes || bytes.length < 20) return null;
  if (fullBoxFlags(bytes) !== 0) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes[0] === 0) {
    const timescale = view.getUint32(12, false);
    return timescale > 0 ? { timescale, initialDurationUnits: knownUint32Duration(view.getUint32(16, false)) } : null;
  }
  if (bytes[0] === 1 && bytes.length >= 32) {
    const timescale = view.getUint32(20, false);
    return timescale > 0 ? { timescale, initialDurationUnits: knownUint64Duration(view.getBigUint64(24, false)) } : null;
  }
  return null;
}

async function readTrackMetadata(file: File, movieChildren: IsoBox[], budget: ParseBudget) {
  const metadata = new Map<number, TrackMetadata>();
  for (const track of movieChildren.filter((box) => box.type === 'trak')) {
    const trackChildren = await listBoxes(file, track.dataOffset, track.end, budget);
    if (!trackChildren) return null;
    const trackHeaders = trackChildren.filter((box) => box.type === 'tkhd');
    const mediaBoxes = trackChildren.filter((box) => box.type === 'mdia');
    if (trackHeaders.length !== 1 || mediaBoxes.length !== 1) return null;
    const trackHeader = trackHeaders[0];
    const media = mediaBoxes[0];
    const mediaChildren = await listBoxes(file, media.dataOffset, media.end, budget);
    const mediaHeaders = mediaChildren?.filter((box) => box.type === 'mdhd');
    if (!mediaHeaders || mediaHeaders.length !== 1) return null;
    const mediaHeader = mediaHeaders[0];
    const trackId = await readTrackId(file, trackHeader, budget);
    const mediaHeaderData = await readMediaHeader(file, mediaHeader, budget);
    if (!trackId || !mediaHeaderData || metadata.has(trackId)) return null;
    metadata.set(trackId, mediaHeaderData);
  }
  return metadata;
}

async function readTrackDefaultDuration(file: File, trackExtends: IsoBox, budget: ParseBudget) {
  const bytes = await readBoxPrefix(file, trackExtends, 24, budget);
  if (!bytes || bytes.length < 24 || bytes[0] !== 0 || fullBoxFlags(bytes) !== 0) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const trackId = view.getUint32(4, false);
  const defaultSampleDuration = view.getUint32(12, false);
  return trackId > 0 ? { trackId, defaultSampleDuration } : null;
}

async function readTrackDefaults(file: File, movieExtendsChildren: IsoBox[], budget: ParseBudget) {
  const defaults = new Map<number, number>();
  for (const trackExtends of movieExtendsChildren.filter((box) => box.type === 'trex')) {
    const parsed = await readTrackDefaultDuration(file, trackExtends, budget);
    if (!parsed || defaults.has(parsed.trackId)) return null;
    defaults.set(parsed.trackId, parsed.defaultSampleDuration);
  }
  return defaults;
}

async function readTrackFragmentHeader(file: File, trackFragmentHeader: IsoBox, budget: ParseBudget): Promise<TrackFragmentHeader | null> {
  const bytes = await readBoxPrefix(file, trackFragmentHeader, 32, budget);
  if (!bytes || bytes.length < 8 || bytes[0] !== 0) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const flags = fullBoxFlags(bytes);
  if ((flags & ~TFHD_KNOWN_FLAGS) !== 0) return null;
  const trackId = view.getUint32(4, false);
  if (!trackId) return null;
  let cursor = 8;
  if (flags & 0x000001) cursor += 8;
  if (flags & 0x000002) cursor += 4;
  let defaultSampleDuration: number | undefined;
  if (flags & 0x000008) {
    if (cursor + 4 > bytes.length) return null;
    defaultSampleDuration = view.getUint32(cursor, false);
    cursor += 4;
  }
  if (flags & 0x000010) cursor += 4;
  if (flags & 0x000020) cursor += 4;
  if (cursor > bytes.length) return null;
  return { trackId, defaultSampleDuration, durationIsEmpty: Boolean(flags & 0x010000) };
}

async function readBaseDecodeTime(file: File, trackFragmentDecodeTime: IsoBox, budget: ParseBudget) {
  const bytes = await readBoxPrefix(file, trackFragmentDecodeTime, 12, budget);
  if (!bytes || bytes.length < 8) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (fullBoxFlags(bytes) !== 0) return null;
  if (bytes[0] === 0) return view.getUint32(4, false);
  if (bytes[0] === 1 && bytes.length >= 12) {
    const value = view.getBigUint64(4, false);
    return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
  }
  return null;
}

async function readTrackRunTiming(file: File, trackRun: IsoBox, defaultSampleDuration: number | undefined, budget: ParseBudget) {
  const prefix = await readBoxPrefix(file, trackRun, 16, budget);
  if (!prefix || prefix.length < 8 || (prefix[0] !== 0 && prefix[0] !== 1)) return null;
  const prefixView = new DataView(prefix.buffer, prefix.byteOffset, prefix.byteLength);
  const flags = fullBoxFlags(prefix);
  if ((flags & ~TRUN_KNOWN_FLAGS) !== 0 || (flags & 0x000004 && flags & 0x000400)) return null;
  const sampleCount = prefixView.getUint32(4, false);
  if (sampleCount > budget.samplesRemaining) return null;
  budget.samplesRemaining -= sampleCount;

  let cursor = 8;
  if (flags & 0x000001) cursor += 4;
  if (flags & 0x000004) cursor += 4;
  const hasSampleDuration = Boolean(flags & 0x000100);
  let bytesPerSample = 0;
  if (hasSampleDuration) bytesPerSample += 4;
  if (flags & 0x000200) bytesPerSample += 4;
  if (flags & 0x000400) bytesPerSample += 4;
  if (flags & 0x000800) bytesPerSample += 4;
  const sampleBytes = sampleCount * bytesPerSample;
  if (!Number.isSafeInteger(sampleBytes)) return null;
  const requiredLength = cursor + sampleBytes;
  if (requiredLength > trackRun.end - trackRun.dataOffset) return null;
  if (sampleCount > 0 && !hasSampleDuration && defaultSampleDuration === undefined) return null;

  if (!hasSampleDuration) {
    const durationUnits = sampleCount * (defaultSampleDuration ?? 0);
    if (!Number.isSafeInteger(durationUnits)) return null;
    return { sampleCount, durationUnits };
  }

  const bytes = await readBoxPrefix(file, trackRun, requiredLength, budget);
  if (!bytes || bytes.length < requiredLength) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let decodeTime = 0;
  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    const sampleDuration = hasSampleDuration ? view.getUint32(cursor, false) : defaultSampleDuration ?? 0;
    if (hasSampleDuration) cursor += 4;
    if (flags & 0x000200) cursor += 4;
    if (flags & 0x000400) cursor += 4;
    if (flags & 0x000800) cursor += 4;
    const nextDecodeTime = safeAdd(decodeTime, sampleDuration);
    if (nextDecodeTime === null) return null;
    decodeTime = nextDecodeTime;
  }
  return { sampleCount, durationUnits: decodeTime };
}

async function readFragmentedDurationMs(
  file: File,
  movieFragments: IsoBox[],
  trackMetadata: Map<number, TrackMetadata>,
  trackDefaults: Map<number, number>,
  budget: ParseBudget,
) {
  if (!movieFragments.length || !trackMetadata.size) return null;
  const timelines = new Map<number, TrackTimeline>();
  for (const movieFragment of movieFragments) {
    const fragmentChildren = await listBoxes(file, movieFragment.dataOffset, movieFragment.end, budget);
    if (!fragmentChildren) return null;
    for (const trackFragment of fragmentChildren.filter((box) => box.type === 'traf')) {
      const trackFragmentChildren = await listBoxes(file, trackFragment.dataOffset, trackFragment.end, budget);
      if (!trackFragmentChildren) return null;
      const trackFragmentHeaders = trackFragmentChildren.filter((box) => box.type === 'tfhd');
      const decodeTimeBoxes = trackFragmentChildren.filter((box) => box.type === 'tfdt');
      if (trackFragmentHeaders.length !== 1 || decodeTimeBoxes.length > 1) return null;
      const trackFragmentHeaderBox = trackFragmentHeaders[0];
      const trackFragmentHeader = await readTrackFragmentHeader(file, trackFragmentHeaderBox, budget);
      if (!trackFragmentHeader) return null;
      const metadata = trackMetadata.get(trackFragmentHeader.trackId);
      if (!metadata) return null;
      const initialDurationUnits = metadata.initialDurationUnits;
      const current = timelines.get(trackFragmentHeader.trackId) || {
        timescale: metadata.timescale,
        nextDecodeTime: initialDurationUnits,
        minTime: initialDurationUnits ? 0 : Number.POSITIVE_INFINITY,
        maxTime: initialDurationUnits ?? Number.NEGATIVE_INFINITY,
        hasTiming: Boolean(initialDurationUnits),
      };
      const decodeTimeBox = decodeTimeBoxes[0];
      const explicitDecodeTime = decodeTimeBox ? await readBaseDecodeTime(file, decodeTimeBox, budget) : null;
      if (decodeTimeBox && explicitDecodeTime === null) return null;
      let decodeTime = explicitDecodeTime ?? current.nextDecodeTime ?? 0;
      const trackRuns = trackFragmentChildren.filter((box) => box.type === 'trun');
      const defaultSampleDuration = trackFragmentHeader.defaultSampleDuration ?? trackDefaults.get(trackFragmentHeader.trackId);
      if (trackFragmentHeader.durationIsEmpty) {
        if (trackRuns.length || defaultSampleDuration === undefined) return null;
        // ISO 14496-12 uses the resolved default as the length of an empty-time interval with no samples.
        const emptyEnd = safeAdd(decodeTime, defaultSampleDuration);
        if (emptyEnd === null) return null;
        if (defaultSampleDuration > 0) {
          current.minTime = Math.min(current.minTime, decodeTime);
          current.maxTime = Math.max(current.maxTime, emptyEnd);
          current.hasTiming = true;
        }
        current.nextDecodeTime = emptyEnd;
        timelines.set(trackFragmentHeader.trackId, current);
        continue;
      }
      if (!trackRuns.length) {
        if (!decodeTimeBox) return null;
        if (current.hasTiming) current.maxTime = Math.max(current.maxTime, decodeTime);
        current.nextDecodeTime = decodeTime;
        timelines.set(trackFragmentHeader.trackId, current);
        continue;
      }
      for (const trackRun of trackRuns) {
        const timing = await readTrackRunTiming(file, trackRun, defaultSampleDuration, budget);
        if (!timing) return null;
        if (timing.sampleCount > 0) {
          const decodeEnd = safeAdd(decodeTime, timing.durationUnits);
          if (decodeEnd === null) return null;
          current.minTime = Math.min(current.minTime, decodeTime);
          current.maxTime = Math.max(current.maxTime, decodeEnd);
          current.hasTiming = true;
          decodeTime = decodeEnd;
        }
      }
      current.nextDecodeTime = decodeTime;
      timelines.set(trackFragmentHeader.trackId, current);
    }
  }

  let durationMs: number | null = null;
  for (const timeline of timelines.values()) {
    if (!timeline.hasTiming || !Number.isFinite(timeline.minTime) || !Number.isFinite(timeline.maxTime)) continue;
    const trackDurationMs = durationToMs(timeline.maxTime - timeline.minTime, timeline.timescale);
    if (!trackDurationMs) return null;
    durationMs = Math.max(durationMs || 0, trackDurationMs);
  }
  return durationMs;
}

export async function readVideoDurationMs(file: File) {
  const budget: ParseBudget = {
    boxesRemaining: MAX_BOXES_TO_INSPECT,
    bytesRemaining: MAX_METADATA_BYTES_TO_READ,
    samplesRemaining: MAX_SAMPLES_TO_INSPECT,
  };
  const topLevelBoxes = await listBoxes(file, 0, file.size, budget);
  const movies = topLevelBoxes?.filter((box) => box.type === 'moov');
  if (!topLevelBoxes || !movies || movies.length !== 1) return null;
  const movie = movies[0];
  const movieChildren = await listBoxes(file, movie.dataOffset, movie.end, budget);
  const movieHeaderBoxes = movieChildren?.filter((box) => box.type === 'mvhd');
  if (!movieChildren || !movieHeaderBoxes || movieHeaderBoxes.length !== 1) return null;
  const movieHeaderBox = movieHeaderBoxes[0];
  const movieHeader = await readMovieHeader(file, movieHeaderBox, budget);
  if (!movieHeader) return null;

  const durations: number[] = [];
  const movieHeaderDurationMs = durationToMs(movieHeader.durationUnits, movieHeader.timescale);
  if (movieHeaderDurationMs) durations.push(movieHeaderDurationMs);

  const movieExtendsBoxes = movieChildren.filter((box) => box.type === 'mvex');
  if (movieExtendsBoxes.length > 1) return null;
  const movieExtends = movieExtendsBoxes[0];
  let trackDefaults = new Map<number, number>();
  if (movieExtends) {
    const movieExtendsChildren = await listBoxes(file, movieExtends.dataOffset, movieExtends.end, budget);
    if (!movieExtendsChildren) return null;
    const movieExtendsHeaders = movieExtendsChildren.filter((box) => box.type === 'mehd');
    if (movieExtendsHeaders.length > 1) return null;
    const movieExtendsHeader = movieExtendsHeaders[0];
    if (movieExtendsHeader) {
      const fragmentDurationUnits = await readFragmentDurationHint(file, movieExtendsHeader, budget);
      const fragmentDurationMs = durationToMs(fragmentDurationUnits, movieHeader.timescale);
      if (fragmentDurationMs) durations.push(fragmentDurationMs);
    }
    const parsedDefaults = await readTrackDefaults(file, movieExtendsChildren, budget);
    if (!parsedDefaults) return null;
    trackDefaults = parsedDefaults;
  }

  const movieFragments = topLevelBoxes.filter((box) => box.type === 'moof');
  if (movieFragments.length) {
    const trackMetadata = await readTrackMetadata(file, movieChildren, budget);
    if (!trackMetadata) return null;
    const fragmentedDurationMs = await readFragmentedDurationMs(file, movieFragments, trackMetadata, trackDefaults, budget);
    if (!fragmentedDurationMs) return null;
    durations.push(fragmentedDurationMs);
  }

  return durations.length ? Math.max(...durations) : null;
}
