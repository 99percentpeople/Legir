import type { LoadOptions, NativeModule } from "./types.js";

const encoder = new TextEncoder();
export const decoder = new TextDecoder();

export class Runtime {
  constructor(readonly native: NativeModule) {}
  call(name: string, ...args: number[]): number {
    const fn = this.native[`_${name}`];
    if (!fn) throw new Error(`Missing PDFium native export: ${name}`);
    return fn(...args);
  }
  withBytes<T>(
    bytes: Uint8Array,
    use: (pointer: number, length: number) => T,
  ): T {
    const length = bytes.length;
    const pointer = this.copyBytes(bytes);
    try {
      return use(pointer, length);
    } finally {
      this.call("free", pointer);
    }
  }
  copyBytes(bytes: Uint8Array): number {
    const length = bytes.length;
    const borrowed = bytes.buffer === this.native.HEAPU8.buffer;
    const offset = bytes.byteOffset;
    const pointer = this.call("malloc", length + 1);
    if (!pointer) throw new Error("PDFium memory allocation failed.");
    // malloc may grow WASM memory and detach a borrowed source view. Its
    // allocation remains valid at the same offset in the new memory buffer.
    const source = borrowed
      ? this.native.HEAPU8.subarray(offset, offset + length)
      : bytes;
    try {
      this.native.HEAPU8.set(source, pointer);
      this.native.HEAPU8[pointer + length] = 0;
      return pointer;
    } catch (error) {
      this.call("free", pointer);
      throw error;
    }
  }
  withString<T>(text: string, use: (pointer: number, length: number) => T): T {
    return this.withBytes(encoder.encode(text), use);
  }
  buffer(pointer: number) {
    if (!pointer) throw new Error("PDFium operation failed.");
    return new PDFBuffer(this, pointer);
  }
}

export class PDFBuffer {
  constructor(
    readonly runtime: Runtime,
    public pointer: number,
  ) {}
  asUint8Array(): Uint8Array {
    if (!this.pointer) throw new Error("PDFium buffer is closed.");
    const start = this.runtime.call("LPDF_BufferData", this.pointer);
    const size = this.runtime.call("LPDF_BufferSize", this.pointer);
    return this.runtime.native.HEAPU8.subarray(start, start + size);
  }
  destroy() {
    if (this.pointer) this.runtime.call("LPDF_BufferDrop", this.pointer);
    this.pointer = 0;
  }
}

export async function loadRuntime(options: LoadOptions = {}) {
  const url =
    options.moduleUrl ??
    new URL(/* @vite-ignore */ "../wasm/pdfium.js", import.meta.url).href;
  const factory = (await import(/* @vite-ignore */ url)).default;
  const module = await factory({
    wasmBinary: options.wasmBinary,
    locateFile: options.locateFile,
  });
  const runtime = new Runtime(module as NativeModule);
  runtime.call("LPDF_Init");
  return runtime;
}
