// Read only VSIX metadata. Install-only needs Node.js, without project dependencies.
import { open } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import { verifyPackageIdentity } from './platform-runtime.mjs';

const metadataNames = new Set(['extension/package.json', 'extension.vsixmanifest']);
const metadataLimit = 1024 * 1024;

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function readMetadata(archive) {
  const file = await open(archive, 'r');
  try {
    const { size } = await file.stat();
    const read = async (offset, length) => {
      if (offset < 0 || length < 0 || offset + length > size)
        throw new Error('Truncated VSIX archive.');
      const buffer = Buffer.alloc(length);
      let total = 0;
      while (total < length) {
        const { bytesRead } = await file.read(buffer, total, length - total, offset + total);
        if (!bytesRead) throw new Error('Truncated VSIX archive.');
        total += bytesRead;
      }
      return buffer;
    };
    const tail = await read(Math.max(0, size - 65557), Math.min(size, 65557));
    let end = tail.length - 22;
    for (; end >= 0; end--) {
      if (
        tail.readUInt32LE(end) === 0x06054b50 &&
        end + 22 + tail.readUInt16LE(end + 20) === tail.length
      )
        break;
    }
    if (end < 0) throw new Error('Invalid VSIX ZIP directory.');
    const count = tail.readUInt16LE(end + 10),
      directorySize = tail.readUInt32LE(end + 12),
      directoryOffset = tail.readUInt32LE(end + 16);
    // VSCE creates ordinary single-disk ZIPs. Refuse unsupported formats explicitly.
    if (
      tail.readUInt16LE(end + 4) ||
      tail.readUInt16LE(end + 6) ||
      tail.readUInt16LE(end + 8) !== count ||
      count === 0xffff ||
      directorySize === 0xffffffff ||
      directoryOffset === 0xffffffff
    )
      throw new Error('Multi-disk and ZIP64 VSIX archives are not supported.');
    if (
      directorySize > 16 * metadataLimit ||
      directoryOffset + directorySize !== size - tail.length + end
    )
      throw new Error('Invalid VSIX ZIP directory size.');
    const directory = await read(directoryOffset, directorySize);
    const contents = new Map();
    let offset = 0;
    for (let index = 0; index < count; index++) {
      if (offset + 46 > directory.length || directory.readUInt32LE(offset) !== 0x02014b50)
        throw new Error('Invalid VSIX ZIP entry.');
      const flags = directory.readUInt16LE(offset + 8),
        method = directory.readUInt16LE(offset + 10);
      const checksum = directory.readUInt32LE(offset + 16),
        compressedSize = directory.readUInt32LE(offset + 20),
        expandedSize = directory.readUInt32LE(offset + 24);
      const nameLength = directory.readUInt16LE(offset + 28),
        extraLength = directory.readUInt16LE(offset + 30),
        commentLength = directory.readUInt16LE(offset + 32);
      const next = offset + 46 + nameLength + extraLength + commentLength;
      if (next > directory.length) throw new Error('Truncated VSIX ZIP entry.');
      const name = directory.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
      if (metadataNames.has(name)) {
        if (contents.has(name)) throw new Error(`Duplicate VSIX metadata: ${name}.`);
        if (
          flags & 1 ||
          ![0, 8].includes(method) ||
          expandedSize > metadataLimit ||
          compressedSize > 2 * metadataLimit
        )
          throw new Error('Unsupported or oversized VSIX metadata.');
        const localOffset = directory.readUInt32LE(offset + 42);
        const local = await read(localOffset, 30);
        if (
          local.readUInt32LE(0) !== 0x04034b50 ||
          local.readUInt16LE(6) !== flags ||
          local.readUInt16LE(8) !== method
        )
          throw new Error('Inconsistent VSIX ZIP headers.');
        const localNameLength = local.readUInt16LE(26),
          localExtraLength = local.readUInt16LE(28);
        const localName = await read(localOffset + 30, localNameLength);
        if (
          localName.toString('utf8') !== name ||
          localOffset + 30 + localNameLength + localExtraLength + compressedSize > directoryOffset
        )
          throw new Error('Inconsistent VSIX ZIP entry.');
        const compressed = await read(
          localOffset + 30 + localNameLength + localExtraLength,
          compressedSize,
        );
        const bytes =
          method === 0
            ? compressed
            : inflateRawSync(compressed, { maxOutputLength: metadataLimit });
        if (bytes.length !== expandedSize || crc32(bytes) !== checksum)
          throw new Error('Damaged VSIX metadata.');
        contents.set(name, bytes.toString('utf8'));
      }
      offset = next;
    }
    if (offset !== directory.length || contents.size !== metadataNames.size)
      throw new Error('Missing or invalid VSIX metadata.');
    return contents;
  } finally {
    await file.close();
  }
}

function xmlIdentity(xml) {
  // Only VSCE's Metadata/Identity attributes are needed; never expand a DTD.
  if (/<!DOCTYPE|<!ENTITY|<!\[CDATA\[/i.test(xml))
    throw new Error('Unsupported VSIX XML metadata.');
  const clean = xml.replace(/<!--[\s\S]*?-->/g, '');
  const metadata = [...clean.matchAll(/<Metadata(?:\s[^>]*)?>([\s\S]*?)<\/Metadata\s*>/g)];
  const identities = [...(metadata[0]?.[1] ?? '').matchAll(/<Identity\b([^<>]*)\/\s*>/g)];
  if (metadata.length !== 1 || identities.length !== 1)
    throw new Error('Missing or ambiguous VSIX XML identity.');
  const attributes = {};
  for (const match of identities[0][1].matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    if (Object.hasOwn(attributes, match[1])) throw new Error('Duplicate VSIX identity attribute.');
    attributes[match[1]] = (match[2] ?? match[3]).replace(/&([^;]+);/g, (_, entity) => {
      const entities = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' };
      if (Object.hasOwn(entities, entity)) return entities[entity];
      if (/^#(?:\d+|x[\da-f]+)$/i.test(entity))
        return String.fromCodePoint(
          entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1)),
        );
      throw new Error('Unsupported VSIX XML entity.');
    });
  }
  return attributes;
}

export async function inspectInstallPackage(archive, expected, target) {
  const contents = await readMetadata(archive);
  const manifest = JSON.parse(contents.get('extension/package.json'));
  verifyPackageIdentity(
    manifest,
    xmlIdentity(contents.get('extension.vsixmanifest')),
    expected,
    target,
  );
  return manifest;
}
