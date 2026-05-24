import CryptoJS, { type CryptoJsWordArray } from "crypto-js";
import {
  PDFArray,
  PDFBool,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFString,
} from "@cantoo/pdf-lib";

const DEFAULT_PASSWORD_BYTES = new Uint8Array([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff,
  0xfa, 0x01, 0x08, 0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c,
  0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

export type VerifyPdfOwnerPasswordResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "missing_encrypt_dictionary"
        | "unsupported_encryption"
        | "incorrect_password";
    };

const bytesToWordArray = (bytes: Uint8Array): CryptoJsWordArray =>
  CryptoJS.lib.WordArray.create(bytes, bytes.length);

const wordArrayToBytes = (wordArray: CryptoJsWordArray): Uint8Array => {
  const hex = wordArray.toString(CryptoJS.enc.Hex);
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
};

const md5 = (bytes: Uint8Array): Uint8Array =>
  wordArrayToBytes(CryptoJS.MD5(bytesToWordArray(bytes)));

const sha256 = (bytes: Uint8Array): Uint8Array =>
  wordArrayToBytes(CryptoJS.SHA256(bytesToWordArray(bytes)));

const sha384 = (bytes: Uint8Array): Uint8Array =>
  wordArrayToBytes(CryptoJS.SHA384(bytesToWordArray(bytes)));

const sha512 = (bytes: Uint8Array): Uint8Array =>
  wordArrayToBytes(CryptoJS.SHA512(bytesToWordArray(bytes)));

const aes128CbcNoPaddingEncrypt = (
  bytes: Uint8Array,
  key: Uint8Array,
  iv: Uint8Array,
): Uint8Array =>
  wordArrayToBytes(
    CryptoJS.AES.encrypt(bytesToWordArray(bytes), bytesToWordArray(key), {
      iv: bytesToWordArray(iv),
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.NoPadding,
    }).ciphertext,
  );

const isArrayEqual = (left: Uint8Array, right: Uint8Array) => {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) {
    diff |= left[i]! ^ right[i]!;
  }
  return diff === 0;
};

class ARCFourCipher {
  private readonly s: Uint8Array;
  private a = 0;
  private b = 0;

  constructor(key: Uint8Array) {
    const s = new Uint8Array(256);
    const keyLength = key.length;

    for (let i = 0; i < 256; i++) s[i] = i;
    for (let i = 0, j = 0; i < 256; i++) {
      const tmp = s[i]!;
      j = (j + tmp + key[i % keyLength]!) & 0xff;
      s[i] = s[j]!;
      s[j] = tmp;
    }
    this.s = s;
  }

  encryptBlock(data: Uint8Array) {
    let a = this.a;
    let b = this.b;
    const s = this.s;
    const output = new Uint8Array(data.length);

    for (let i = 0; i < data.length; i++) {
      a = (a + 1) & 0xff;
      const tmp = s[a]!;
      b = (b + tmp) & 0xff;
      const tmp2 = s[b]!;
      s[a] = tmp2;
      s[b] = tmp;
      output[i] = data[i]! ^ s[(tmp + tmp2) & 0xff]!;
    }

    this.a = a;
    this.b = b;
    return output;
  }
}

const stringAsByteArray = (value: string): Uint8Array => {
  const bytes = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i++) {
    bytes[i] = value.charCodeAt(i) & 0xff;
  }
  return bytes;
};

const getPasswordBytes = (password: string, revision: number): Uint8Array => {
  if (revision === 6) {
    try {
      return stringAsByteArray(unescape(encodeURIComponent(password)));
    } catch {
      return stringAsByteArray(password);
    }
  }
  return stringAsByteArray(password);
};

const calculatePdf20Hash = (
  password: Uint8Array,
  input: Uint8Array,
  userBytes: Uint8Array,
) => {
  let k = sha256(input).subarray(0, 32);
  let e = new Uint8Array([0]);
  let i = 0;

  while (i < 64 || e[e.length - 1]! > i - 32) {
    const combinedLength = password.length + k.length + userBytes.length;
    const combined = new Uint8Array(combinedLength);
    let offset = 0;
    combined.set(password, offset);
    offset += password.length;
    combined.set(k, offset);
    offset += k.length;
    combined.set(userBytes, offset);

    const k1 = new Uint8Array(combinedLength * 64);
    for (let j = 0, pos = 0; j < 64; j++, pos += combinedLength) {
      k1.set(combined, pos);
    }

    e = Uint8Array.from(
      aes128CbcNoPaddingEncrypt(k1, k.subarray(0, 16), k.subarray(16, 32)),
    );
    const remainder = e.slice(0, 16).reduce((sum, value) => sum + value, 0) % 3;
    if (remainder === 0) {
      k = sha256(e);
    } else if (remainder === 1) {
      k = sha384(e);
    } else {
      k = sha512(e);
    }
    i++;
  }

  return k.subarray(0, 32);
};

const checkAesOwnerPassword = (
  password: Uint8Array,
  revision: number,
  ownerBytes: Uint8Array,
  userBytes: Uint8Array,
) => {
  const ownerPassword = ownerBytes.subarray(0, 32);
  const ownerValidationSalt = ownerBytes.subarray(32, 40);
  const userBytesForOwner = userBytes.subarray(0, 48);
  const hashData = new Uint8Array(password.length + 56);
  hashData.set(password, 0);
  hashData.set(ownerValidationSalt, password.length);
  hashData.set(userBytesForOwner, password.length + ownerValidationSalt.length);
  const result =
    revision === 6
      ? calculatePdf20Hash(password, hashData, userBytesForOwner)
      : sha256(hashData);
  return isArrayEqual(result, ownerPassword);
};

const decodeUserPassword = (
  password: Uint8Array,
  ownerPassword: Uint8Array,
  revision: number,
  keyLength: number,
) => {
  const hashData = new Uint8Array(32);
  let i = 0;
  const n = Math.min(32, password.length);
  for (; i < n; i++) hashData[i] = password[i]!;
  let j = 0;
  while (i < 32) hashData[i++] = DEFAULT_PASSWORD_BYTES[j++]!;

  let hash = md5(hashData);
  const keyLengthInBytes = keyLength >> 3;
  if (revision >= 3) {
    for (j = 0; j < 50; j++) hash = md5(hash);
  }

  if (revision >= 3) {
    let userPassword = ownerPassword;
    const derivedKey = new Uint8Array(keyLengthInBytes);
    for (j = 19; j >= 0; j--) {
      for (let k = 0; k < keyLengthInBytes; k++) {
        derivedKey[k] = hash[k]! ^ j;
      }
      userPassword = new ARCFourCipher(derivedKey).encryptBlock(userPassword);
    }
    return userPassword;
  }

  return new ARCFourCipher(hash.subarray(0, keyLengthInBytes)).encryptBlock(
    ownerPassword,
  );
};

const prepareKeyData = (
  fileId: Uint8Array,
  password: Uint8Array | undefined,
  ownerPassword: Uint8Array,
  userPassword: Uint8Array,
  flags: number,
  revision: number,
  keyLength: number,
  encryptMetadata: boolean,
) => {
  const hashData = new Uint8Array(40 + ownerPassword.length + fileId.length);
  let i = 0;
  let j = 0;
  let n = 0;
  if (password) {
    n = Math.min(32, password.length);
    for (; i < n; i++) hashData[i] = password[i]!;
  }
  j = 0;
  while (i < 32) hashData[i++] = DEFAULT_PASSWORD_BYTES[j++]!;
  for (j = 0, n = ownerPassword.length; j < n; j++) {
    hashData[i++] = ownerPassword[j]!;
  }
  hashData[i++] = flags & 0xff;
  hashData[i++] = (flags >> 8) & 0xff;
  hashData[i++] = (flags >> 16) & 0xff;
  hashData[i++] = (flags >>> 24) & 0xff;
  for (j = 0, n = fileId.length; j < n; j++) hashData[i++] = fileId[j]!;
  if (revision >= 4 && !encryptMetadata) {
    hashData[i++] = 0xff;
    hashData[i++] = 0xff;
    hashData[i++] = 0xff;
    hashData[i++] = 0xff;
  }

  let hash = md5(hashData.subarray(0, i));
  const keyLengthInBytes = keyLength >> 3;
  if (revision >= 3) {
    for (j = 0; j < 50; j++) hash = md5(hash.subarray(0, keyLengthInBytes));
  }
  const encryptionKey = hash.subarray(0, keyLengthInBytes);

  let checkData: Uint8Array;
  if (revision >= 3) {
    const defaultAndFileId = new Uint8Array(
      DEFAULT_PASSWORD_BYTES.length + fileId.length,
    );
    defaultAndFileId.set(DEFAULT_PASSWORD_BYTES);
    defaultAndFileId.set(fileId, DEFAULT_PASSWORD_BYTES.length);
    checkData = new ARCFourCipher(encryptionKey).encryptBlock(
      md5(defaultAndFileId),
    );
    const derivedKey = new Uint8Array(encryptionKey.length);
    for (j = 1; j <= 19; j++) {
      for (let k = 0; k < encryptionKey.length; k++) {
        derivedKey[k] = encryptionKey[k]! ^ j;
      }
      checkData = new ARCFourCipher(derivedKey).encryptBlock(checkData);
    }
  } else {
    checkData = new ARCFourCipher(encryptionKey).encryptBlock(
      DEFAULT_PASSWORD_BYTES,
    );
  }

  return isArrayEqual(userPassword.subarray(0, checkData.length), checkData)
    ? encryptionKey
    : null;
};

const bytesFromPdfString = (value: PDFString | PDFHexString) => value.asBytes();

const readStandardEncryption = async (pdfBytes: Uint8Array) => {
  const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const context = pdfDoc.context;
  const encryptDict = context.lookup(context.trailerInfo.Encrypt, PDFDict);
  if (!(encryptDict instanceof PDFDict)) return null;

  const filter = encryptDict.lookup(PDFName.of("Filter"), PDFName);
  if (filter.asString() !== "/Standard") {
    throw new Error("unsupported encryption method");
  }

  const fileIds = context.lookup(context.trailerInfo.ID, PDFArray);
  const fileIdObject = fileIds.get(0);
  if (
    !(fileIdObject instanceof PDFString) &&
    !(fileIdObject instanceof PDFHexString)
  ) {
    throw new Error("missing file id");
  }
  const fileId = bytesFromPdfString(fileIdObject);
  const algorithm = encryptDict.lookup(PDFName.of("V"), PDFNumber).asNumber();
  const revision = encryptDict.lookup(PDFName.of("R"), PDFNumber).asNumber();
  const flags = encryptDict.lookup(PDFName.of("P"), PDFNumber).asNumber();
  const ownerBytes = bytesFromPdfString(
    encryptDict.lookup(PDFName.of("O"), PDFString, PDFHexString),
  );
  const userBytes = bytesFromPdfString(
    encryptDict.lookup(PDFName.of("U"), PDFString, PDFHexString),
  );

  let keyLength = encryptDict
    .lookupMaybe(PDFName.of("Length"), PDFNumber)
    ?.asNumber();
  if (!keyLength) {
    if (algorithm <= 3) {
      keyLength = 40;
    } else {
      const cfDict = encryptDict.lookupMaybe(PDFName.of("CF"), PDFDict);
      const streamCryptoName = encryptDict.lookupMaybe(
        PDFName.of("StmF"),
        PDFName,
      );
      const handlerDict =
        cfDict && streamCryptoName
          ? cfDict.lookupMaybe(PDFName.of(streamCryptoName.asString()), PDFDict)
          : undefined;
      keyLength =
        handlerDict?.lookupMaybe(PDFName.of("Length"), PDFNumber)?.asNumber() ??
        128;
      if (keyLength < 40) keyLength <<= 3;
    }
  }

  const encryptMetadata =
    (algorithm === 4 || algorithm === 5) &&
    encryptDict
      .lookupMaybe(PDFName.of("EncryptMetadata"), PDFBool)
      ?.asBoolean() !== false;

  return {
    algorithm,
    revision,
    keyLength,
    flags,
    fileId,
    ownerBytes,
    userBytes,
    encryptMetadata,
  };
};

export const verifyPdfOwnerPassword = async (
  pdfBytes: Uint8Array,
  password: string,
): Promise<VerifyPdfOwnerPasswordResult> => {
  let encryption: Awaited<ReturnType<typeof readStandardEncryption>>;
  try {
    encryption = await readStandardEncryption(pdfBytes);
  } catch (error) {
    console.warn("Failed to read PDF encryption dictionary", error);
    return { ok: false, reason: "unsupported_encryption" };
  }

  if (!encryption) return { ok: false, reason: "missing_encrypt_dictionary" };

  const { algorithm, revision, ownerBytes, userBytes } = encryption;
  if (
    !Number.isInteger(algorithm) ||
    (algorithm !== 1 && algorithm !== 2 && algorithm !== 4 && algorithm !== 5)
  ) {
    return { ok: false, reason: "unsupported_encryption" };
  }
  if (!Number.isInteger(revision) || revision < 2 || revision > 6) {
    return { ok: false, reason: "unsupported_encryption" };
  }

  const passwordBytes = getPasswordBytes(password, revision);
  const isOwnerPassword =
    revision >= 5
      ? checkAesOwnerPassword(passwordBytes, revision, ownerBytes, userBytes)
      : prepareKeyData(
          encryption.fileId,
          decodeUserPassword(
            passwordBytes,
            ownerBytes.subarray(0, 32),
            revision,
            encryption.keyLength,
          ),
          ownerBytes.subarray(0, 32),
          userBytes.subarray(0, 32),
          encryption.flags,
          revision,
          encryption.keyLength,
          encryption.encryptMetadata,
        ) !== null;

  return isOwnerPassword
    ? { ok: true }
    : { ok: false, reason: "incorrect_password" };
};
