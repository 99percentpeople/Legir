declare module "crypto-js" {
  export interface CryptoJsWordArray {
    words: number[];
    sigBytes: number;
    toString(encoder?: unknown): string;
  }

  const CryptoJS: {
    lib: {
      WordArray: {
        create(
          data?: ArrayBuffer | Uint8Array | number[],
          sigBytes?: number,
        ): CryptoJsWordArray;
      };
    };
    enc: {
      Hex: unknown;
    };
    mode: {
      CBC: unknown;
    };
    pad: {
      NoPadding: unknown;
    };
    MD5(data: CryptoJsWordArray): CryptoJsWordArray;
    SHA256(data: CryptoJsWordArray): CryptoJsWordArray;
    SHA384(data: CryptoJsWordArray): CryptoJsWordArray;
    SHA512(data: CryptoJsWordArray): CryptoJsWordArray;
    AES: {
      encrypt(
        data: CryptoJsWordArray,
        key: CryptoJsWordArray,
        options: {
          iv: CryptoJsWordArray;
          mode: unknown;
          padding: unknown;
        },
      ): { ciphertext: CryptoJsWordArray };
    };
  };

  export default CryptoJS;
}
