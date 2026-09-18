/** Synthetic ELF header for format/architecture tests; never run this fixture. */
export function linuxExecutableFixture(arch: "x64" | "arm64"): Buffer {
  const bytes = Buffer.alloc(128);
  bytes.writeUInt32BE(0x7f454c46, 0);
  bytes[4] = 2;
  bytes[5] = 1;
  bytes[6] = 1;
  bytes.writeUInt16LE(3, 16);
  bytes.writeUInt16LE(arch === "x64" ? 62 : 183, 18);
  bytes.writeUInt32LE(1, 20);
  bytes.writeUInt16LE(64, 52);
  return bytes;
}
