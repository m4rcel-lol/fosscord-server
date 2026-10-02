"use strict";
(() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
    get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
  }) : x)(function(x) {
    if (typeof require !== "undefined") return require.apply(this, arguments);
    throw Error('Dynamic require of "' + x + '" is not supported');
  });
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod2, isNodeMode, target) => (target = mod2 != null ? __create(__getProtoOf(mod2)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod2 || !mod2.__esModule ? __defProp(target, "default", { value: mod2, enumerable: true }) : target,
    mod2
  ));

  // client/e2ee/src/bytes.ts
  var encoder = new TextEncoder();
  var decoder = new TextDecoder();
  var utf8 = (text) => encoder.encode(text);
  var fromUtf8 = (bytes) => decoder.decode(bytes);
  var toB64u = (input) => {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  };
  var fromB64u = (text) => {
    if (typeof text !== "string" || !/^[A-Za-z0-9_-]*$/.test(text)) throw new Error("invalid base64url");
    const binary = atob(
      text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "=")
    );
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  };
  var randomBytes = (length) => crypto.getRandomValues(new Uint8Array(length));
  var sha256 = async (data) => new Uint8Array(await crypto.subtle.digest("SHA-256", data));

  // ../../../node_modules/@hpke/common/esm/src/errors.js
  var HpkeError = class extends Error {
    constructor(e) {
      let message;
      if (e instanceof Error) {
        message = e.message;
      } else if (typeof e === "string") {
        message = e;
      } else {
        message = "";
      }
      super(message);
      this.name = this.constructor.name;
    }
  };
  var InvalidParamError = class extends HpkeError {
  };
  var SerializeError = class extends HpkeError {
  };
  var DeserializeError = class extends HpkeError {
  };
  var EncapError = class extends HpkeError {
  };
  var DecapError = class extends HpkeError {
  };
  var ExportError = class extends HpkeError {
  };
  var SealError = class extends HpkeError {
  };
  var OpenError = class extends HpkeError {
  };
  var MessageLimitReachedError = class extends HpkeError {
  };
  var DeriveKeyPairError = class extends HpkeError {
  };
  var NotSupportedError = class extends HpkeError {
  };

  // ../../../node_modules/@hpke/common/esm/_dnt.shims.js
  var dntGlobals = {};
  var dntGlobalThis = createMergeProxy(globalThis, dntGlobals);
  function createMergeProxy(baseObj, extObj) {
    return new Proxy(baseObj, {
      get(_target, prop, _receiver) {
        if (prop in extObj) {
          return extObj[prop];
        } else {
          return baseObj[prop];
        }
      },
      set(_target, prop, value) {
        if (prop in extObj) {
          delete extObj[prop];
        }
        baseObj[prop] = value;
        return true;
      },
      deleteProperty(_target, prop) {
        let success = false;
        if (prop in extObj) {
          delete extObj[prop];
          success = true;
        }
        if (prop in baseObj) {
          delete baseObj[prop];
          success = true;
        }
        return success;
      },
      ownKeys(_target) {
        const baseKeys = Reflect.ownKeys(baseObj);
        const extKeys = Reflect.ownKeys(extObj);
        const extKeysSet = new Set(extKeys);
        return [...baseKeys.filter((k) => !extKeysSet.has(k)), ...extKeys];
      },
      defineProperty(_target, prop, desc) {
        if (prop in extObj) {
          delete extObj[prop];
        }
        Reflect.defineProperty(baseObj, prop, desc);
        return true;
      },
      getOwnPropertyDescriptor(_target, prop) {
        if (prop in extObj) {
          return Reflect.getOwnPropertyDescriptor(extObj, prop);
        } else {
          return Reflect.getOwnPropertyDescriptor(baseObj, prop);
        }
      },
      has(_target, prop) {
        return prop in extObj || prop in baseObj;
      }
    });
  }

  // ../../../node_modules/@hpke/common/esm/src/algorithm.js
  async function loadSubtleCrypto() {
    if (dntGlobalThis !== void 0 && globalThis.crypto !== void 0) {
      return globalThis.crypto.subtle;
    }
    try {
      const { webcrypto } = await import("crypto");
      return webcrypto.subtle;
    } catch (e) {
      throw new NotSupportedError(e);
    }
  }
  var NativeAlgorithm = class {
    constructor() {
      Object.defineProperty(this, "_api", {
        enumerable: true,
        configurable: true,
        writable: true,
        value: void 0
      });
    }
    async _setup() {
      if (this._api !== void 0) {
        return;
      }
      this._api = await loadSubtleCrypto();
    }
  };

  // ../../../node_modules/@hpke/common/esm/src/identifiers.js
  var Mode = {
    Base: 0,
    Psk: 1,
    Auth: 2,
    AuthPsk: 3
  };
  var KemId = {
    NotAssigned: 0,
    DhkemP256HkdfSha256: 16,
    DhkemP384HkdfSha384: 17,
    DhkemP521HkdfSha512: 18,
    DhkemSecp256k1HkdfSha256: 19,
    DhkemX25519HkdfSha256: 32,
    DhkemX448HkdfSha512: 33,
    HybridkemX25519Kyber768: 48,
    MlKem512: 64,
    MlKem768: 65,
    MlKem1024: 66,
    XWing: 25722
  };
  var KdfId = {
    HkdfSha256: 1,
    HkdfSha384: 2,
    HkdfSha512: 3,
    Sha3256: 4,
    Sha3384: 5,
    Sha3512: 6,
    Shake128: 16,
    Shake256: 17,
    TurboShake128: 18,
    TurboShake256: 19
  };
  var AeadId = {
    Aes128Gcm: 1,
    Aes256Gcm: 2,
    Chacha20Poly1305: 3,
    ExportOnly: 65535
  };

  // ../../../node_modules/@hpke/common/esm/src/consts.js
  var INPUT_LENGTH_LIMIT = 8192;
  var INFO_LENGTH_LIMIT = 268435456;
  var MINIMUM_PSK_LENGTH = 32;
  var EMPTY = /* @__PURE__ */ new Uint8Array(0);

  // ../../../node_modules/@hpke/common/esm/src/interfaces/kemInterface.js
  var SUITE_ID_HEADER_KEM = /* @__PURE__ */ new Uint8Array([
    75,
    69,
    77,
    0,
    0
  ]);

  // ../../../node_modules/@hpke/common/esm/src/kdfs/hkdf.js
  var HPKE_VERSION = /* @__PURE__ */ new Uint8Array([
    72,
    80,
    75,
    69,
    45,
    118,
    49
  ]);
  function toUint8Array(input) {
    return new Uint8Array(toArrayBuffer(input));
  }
  function toArrayBuffer(input) {
    if (input instanceof ArrayBuffer) {
      return input;
    }
    if (ArrayBuffer.isView(input)) {
      return new Uint8Array(input.buffer, input.byteOffset, input.byteLength).slice().buffer;
    }
    return new Uint8Array(input).slice().buffer;
  }
  var HkdfNative = class extends NativeAlgorithm {
    constructor() {
      super();
      Object.defineProperty(this, "id", {
        enumerable: true,
        configurable: true,
        writable: true,
        value: KdfId.HkdfSha256
      });
      Object.defineProperty(this, "hashSize", {
        enumerable: true,
        configurable: true,
        writable: true,
        value: 0
      });
      Object.defineProperty(this, "_suiteId", {
        enumerable: true,
        configurable: true,
        writable: true,
        value: EMPTY
      });
      Object.defineProperty(this, "algHash", {
        enumerable: true,
        configurable: true,
        writable: true,
        value: {
          name: "HMAC",
          hash: "SHA-256",
          length: 256
        }
      });
    }
    init(suiteId) {
      this._suiteId = suiteId;
    }
    buildLabeledIkm(label, ikm) {
      this._checkInit();
      const ret = new Uint8Array(7 + this._suiteId.byteLength + label.byteLength + ikm.byteLength);
      ret.set(HPKE_VERSION, 0);
      ret.set(this._suiteId, 7);
      ret.set(label, 7 + this._suiteId.byteLength);
      ret.set(ikm, 7 + this._suiteId.byteLength + label.byteLength);
      return ret;
    }
    buildLabeledInfo(label, info, len) {
      this._checkInit();
      const ret = new Uint8Array(9 + this._suiteId.byteLength + label.byteLength + info.byteLength);
      ret.set(new Uint8Array([0, len]), 0);
      ret.set(HPKE_VERSION, 2);
      ret.set(this._suiteId, 9);
      ret.set(label, 9 + this._suiteId.byteLength);
      ret.set(info, 9 + this._suiteId.byteLength + label.byteLength);
      return ret;
    }
    async extract(salt, ikm) {
      await this._setup();
      const saltBuf = salt.byteLength === 0 ? new ArrayBuffer(this.hashSize) : toArrayBuffer(salt);
      if (saltBuf.byteLength !== this.hashSize) {
        throw new InvalidParamError("The salt length must be the same as the hashSize");
      }
      const ikmBuf = toArrayBuffer(ikm);
      const key = await this._api.importKey("raw", saltBuf, this.algHash, false, [
        "sign"
      ]);
      return await this._api.sign("HMAC", key, ikmBuf);
    }
    async expand(prk, info, len) {
      await this._setup();
      const prkBuf = toArrayBuffer(prk);
      const key = await this._api.importKey("raw", prkBuf, this.algHash, false, [
        "sign"
      ]);
      const okm = new ArrayBuffer(len);
      const okmBytes = new Uint8Array(okm);
      let prev = EMPTY;
      const mid = toUint8Array(info);
      const tail = new Uint8Array(1);
      if (len > 255 * this.hashSize) {
        throw new Error("Entropy limit reached");
      }
      const tmp = new Uint8Array(this.hashSize + mid.length + 1);
      for (let i = 1, cur = 0; cur < okmBytes.length; i++) {
        tail[0] = i;
        tmp.set(prev, 0);
        tmp.set(mid, prev.length);
        tmp.set(tail, prev.length + mid.length);
        prev = new Uint8Array(await this._api.sign("HMAC", key, tmp.slice(0, prev.length + mid.length + 1)));
        if (okmBytes.length - cur >= prev.length) {
          okmBytes.set(prev, cur);
          cur += prev.length;
        } else {
          okmBytes.set(prev.slice(0, okmBytes.length - cur), cur);
          cur += okmBytes.length - cur;
        }
      }
      return okm;
    }
    async extractAndExpand(salt, ikm, info, len) {
      await this._setup();
      const ikmBuf = toArrayBuffer(ikm);
      const baseKey = await this._api.importKey("raw", ikmBuf, "HKDF", false, ["deriveBits"]);
      return await this._api.deriveBits({
        name: "HKDF",
        hash: this.algHash.hash,
        salt: toArrayBuffer(salt),
        info: toArrayBuffer(info)
      }, baseKey, len * 8);
    }
    async labeledExtract(salt, label, ikm) {
      return await this.extract(salt, this.buildLabeledIkm(label, ikm));
    }
    async labeledExpand(prk, label, info, len) {
      return await this.expand(prk, this.buildLabeledInfo(label, info, len), len);
    }
    _checkInit() {
      if (this._suiteId === EMPTY) {
        throw new Error("Not initialized. Call init()");
      }
    }
  };
  var HkdfSha256Native = class extends HkdfNative {
    constructor() {
      super(...arguments);
      Object.defineProperty(this, "id", {
        enumerable: true,
        configurable: true,
        writable: true,
        value: KdfId.HkdfSha256
      });
      Object.defineProperty(this, "hashSize", {
        enumerable: true,
        configurable: true,
        writable: true,
        value: 32
      });
      Object.defineProperty(this, "algHash", {
        enumerable: true,
        configurable: true,
        writable: true,
        value: {
          name: "HMAC",
          hash: "SHA-256",
          length: 256
        }
      });
    }
  };

  // ../../../node_modules/@hpke/common/esm/src/utils/misc.js
  var isCryptoKeyPair = (x) => typeof x === "object" && x !== null && typeof x.privateKey === "object" && typeof x.publicKey === "object";
  function i2Osp(n, w) {
    if (w <= 0) {
      throw new Error("i2Osp: too small size");
    }
    if (n >= 256 ** w) {
      throw new Error("i2Osp: too large integer");
    }
    const ret = new Uint8Array(w);
    for (let i = 0; i < w && n; i++) {
      ret[w - (i + 1)] = n % 256;
      n = Math.floor(n / 256);
    }
    return ret;
  }
  function concat(a, b) {
    const ret = new Uint8Array(a.length + b.length);
    ret.set(a, 0);
    ret.set(b, a.length);
    return ret;
  }
  function base64UrlToBytes(v) {
    const base64 = v.replace(/-/g, "+").replace(/_/g, "/");
    const byteString = atob(base64);
    const ret = new Uint8Array(byteString.length);
    for (let i = 0; i < byteString.length; i++) {
      ret[i] = byteString.charCodeAt(i);
    }
    return ret;
  }
  function xor(a, b) {
    if (a.byteLength !== b.byteLength) {
      throw new Error("xor: different length inputs");
    }
    const buf = new Uint8Array(a.byteLength);
    for (let i = 0; i < a.byteLength; i++) {
      buf[i] = a[i] ^ b[i];
    }
    return buf;
  }

  // ../../../node_modules/@hpke/common/esm/src/kems/dhkem.js
  var LABEL_EAE_PRK = /* @__PURE__ */ new Uint8Array([
    101,
    97,
    101,
    95,
    112,
    114,
    107
  ]);
  var LABEL_SHARED_SECRET = /* @__PURE__ */ new Uint8Array([
    115,
    104,
    97,
    114,
    101,
    100,
    95,
    115,
    101,
    99,
    114,
    101,
    116
  ]);
  function concat3(a, b, c) {
    const ret = new Uint8Array(a.length + b.length + c.length);
    ret.set(a, 0);
    ret.set(b, a.length);
    ret.set(c, a.length + b.length);
    return ret;
  }
  var Dhkem = class {
    constructor(id, prim, kdf) {
      Object.defineProperty(this, "id", {
        enumerable: true,
        configurable: true,
        writable: true,
        value: void 0
      });
      Object.defineProperty(this, "secretSize", {
        enumerable: true,
        configurable: true,
        writable: true,
        value: 0
      });
      Object.defineProperty(this, "encSize", {
        enumerable: true,
        configurable: true,
        writable: true,
        value: 0
      });
      Object.defineProperty(this, "publicKeySize", {
        enumerable: true,
        configurable: true,
        writable: true,
        value: 0
      });
      Object.defineProperty(this, "privateKeySize", {
        enumerable: true,
        configurable: true,
        writable: true,
        value: 0
      });
      Object.defineProperty(this, "_prim", {
        enumerable: true,
        configurable: true,
        writable: true,
        value: void 0
      });
      Object.defineProperty(this, "_kdf", {
        enumerable: true,
        configurable: true,
        writable: true,
        value: void 0
      });
      this.id = id;
      this._prim = prim;
      this._kdf = kdf;
      const suiteId = new Uint8Array(SUITE_ID_HEADER_KEM);
      suiteId.set(i2Osp(this.id, 2), 3);
      this._kdf.init(suiteId);
    }
    async serializePublicKey(key) {
      return await this._prim.serializePublicKey(key);
    }
    async deserializePublicKey(key) {
      return await this._prim.deserializePublicKey(toArrayBuffer(key));
    }
    async serializePrivateKey(key) {
      return await this._prim.serializePrivateKey(key);
    }
    async deserializePrivateKey(key) {
      return await this._prim.deserializePrivateKey(toArrayBuffer(key));
    }
    async importKey(format, key, isPublic = true) {
      return await this._prim.importKey(format, key, isPublic);
    }
    async generateKeyPair() {
      return await this._prim.generateKeyPair();
    }
    async deriveKeyPair(ikm) {
      const rawIkm = toArrayBuffer(ikm);
      if (rawIkm.byteLength > INPUT_LENGTH_LIMIT) {
        throw new InvalidParamError("Too long ikm");
      }
      return await this._prim.deriveKeyPair(rawIkm);
    }
    async encap(params) {
      let ke;
      if (params.ekm === void 0) {
        ke = await this.generateKeyPair();
      } else if (isCryptoKeyPair(params.ekm)) {
        ke = params.ekm;
      } else {
        ke = await this.deriveKeyPair(params.ekm);
      }
      const enc = await this._prim.serializePublicKey(ke.publicKey);
      const pkrm = await this._prim.serializePublicKey(params.recipientPublicKey);
      try {
        let dh;
        if (params.senderKey === void 0) {
          dh = new Uint8Array(await this._prim.dh(ke.privateKey, params.recipientPublicKey));
        } else {
          const sks = isCryptoKeyPair(params.senderKey) ? params.senderKey.privateKey : params.senderKey;
          const dh1 = new Uint8Array(await this._prim.dh(ke.privateKey, params.recipientPublicKey));
          const dh2 = new Uint8Array(await this._prim.dh(sks, params.recipientPublicKey));
          dh = concat(dh1, dh2);
        }
        let kemContext;
        if (params.senderKey === void 0) {
          kemContext = concat(new Uint8Array(enc), new Uint8Array(pkrm));
        } else {
          const pks = isCryptoKeyPair(params.senderKey) ? params.senderKey.publicKey : await this._prim.derivePublicKey(params.senderKey);
          const pksm = await this._prim.serializePublicKey(pks);
          kemContext = concat3(new Uint8Array(enc), new Uint8Array(pkrm), new Uint8Array(pksm));
        }
        const sharedSecret = await this._generateSharedSecret(dh, kemContext);
        return {
          enc,
          sharedSecret
        };
      } catch (e) {
        throw new EncapError(e);
      }
    }
    async decap(params) {
      const enc = toArrayBuffer(params.enc);
      const pke = await this._prim.deserializePublicKey(enc);
      const skr = isCryptoKeyPair(params.recipientKey) ? params.recipientKey.privateKey : params.recipientKey;
      const pkr = isCryptoKeyPair(params.recipientKey) ? params.recipientKey.publicKey : await this._prim.derivePublicKey(params.recipientKey);
      const pkrm = await this._prim.serializePublicKey(pkr);
      try {
        let dh;
        if (params.senderPublicKey === void 0) {
          dh = new Uint8Array(await this._prim.dh(skr, pke));
        } else {
          const dh1 = new Uint8Array(await this._prim.dh(skr, pke));
          const dh2 = new Uint8Array(await this._prim.dh(skr, params.senderPublicKey));
          dh = concat(dh1, dh2);
        }
        let kemContext;
        if (params.senderPublicKey === void 0) {
          kemContext = concat(new Uint8Array(enc), new Uint8Array(pkrm));
        } else {
          const pksm = await this._prim.serializePublicKey(params.senderPublicKey);
          kemContext = new Uint8Array(enc.byteLength + pkrm.byteLength + pksm.byteLength);
          kemContext.set(new Uint8Array(enc), 0);
          kemContext.set(new Uint8Array(pkrm), enc.byteLength);
          kemContext.set(new Uint8Array(pksm), enc.byteLength + pkrm.byteLength);
        }
        return await this._generateSharedSecret(dh, kemContext);
      } catch (e) {
        throw new DecapError(e);
      }
    }
    async _generateSharedSecret(dh, kemContext) {
      const labeledIkm = this._kdf.buildLabeledIkm(LABEL_EAE_PRK, dh);
      const labeledInfo = this._kdf.buildLabeledInfo(LABEL_SHARED_SECRET, kemContext, this.secretSize);
      return await this._kdf.extractAndExpand(EMPTY, labeledIkm, labeledInfo, this.secretSize);
    }
  };

  // ../../../node_modules/@hpke/common/esm/src/interfaces/dhkemPrimitives.js
  var KEM_USAGES = ["deriveBits"];
  var LABEL_DKP_PRK = /* @__PURE__ */ new Uint8Array([
    100,
    107,
    112,
    95,
    112,
    114,
    107
  ]);
  var LABEL_SK = /* @__PURE__ */ new Uint8Array([115, 107]);

  // ../../../node_modules/@hpke/common/esm/src/kems/dhkemPrimitives/ec.js
  var EC_P_521_PARAMS = {
    p: (1n << 521n) - 1n,
    b: 0x0051953eb9618e1c9a1f929a21a0b68540eea2da725b99b315f3b8b489918ef109e156193951ec7e937b1652c0bd3bb1bf073573df883d2c34f1ef451fd46b503f00n,
    gx: 0x00c6858e06b70404e9cd9e3ecb662395b4429c648139053fb521f828af606b4d3dbaa14b5e77efe75928fe1dc127a2ffa8de3348b3c1856a429bf97e7e31c2e5bd66n,
    gy: 0x011839296a789a3bc0045c8a5fb42c7d1bd998f54449579b446817afbd17273e662c97ee72995ef42640c550b9013fad0761353c7086a272c24088be94769fd16650n,
    coordinateSize: 66
  };

  // ../../../node_modules/@hpke/common/esm/src/interfaces/aeadEncryptionContext.js
  var AEAD_USAGES = ["encrypt", "decrypt"];

  // ../../../node_modules/@hpke/common/esm/src/utils/noble.js
  function isBytes(a) {
    return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array";
  }
  function anumber(n, title = "") {
    if (!Number.isSafeInteger(n) || n < 0) {
      const prefix = title && `"${title}" `;
      throw new Error(`${prefix}expected integer >0, got ${n}`);
    }
  }
  function abytes(value, length, title = "") {
    const bytes = isBytes(value);
    const len = value?.length;
    const needsLen = length !== void 0;
    if (!bytes || needsLen && len !== length) {
      const prefix = title && `"${title}" `;
      const ofLen = needsLen ? ` of length ${length}` : "";
      const got = bytes ? `length=${len}` : `type=${typeof value}`;
      throw new Error(prefix + "expected Uint8Array" + ofLen + ", got " + got);
    }
    return value;
  }
  function aexists(instance, checkFinished = true) {
    if (instance.destroyed)
      throw new Error("Hash instance has been destroyed");
    if (checkFinished && instance.finished) {
      throw new Error("Hash#digest() has already been called");
    }
  }
  function clean(...arrays) {
    for (let i = 0; i < arrays.length; i++) {
      arrays[i].fill(0);
    }
  }
  var _endianTestBuffer = /* @__PURE__ */ new Uint32Array([287454020]);
  var _endianTestBytes = /* @__PURE__ */ new Uint8Array(_endianTestBuffer.buffer);
  var isLE = _endianTestBytes[0] === 68;

  // ../../../node_modules/@hpke/common/esm/src/hash/hash.js
  function ahash(h) {
    if (typeof h !== "function" || typeof h.create !== "function") {
      throw new Error("Hash must wrapped by utils.createHasher");
    }
    anumber(h.outputLen);
    anumber(h.blockLen);
  }

  // ../../../node_modules/@hpke/common/esm/src/hash/hmac.js
  var _HMAC = class {
    constructor(hash, key) {
      Object.defineProperty(this, "oHash", {
        enumerable: true,
        configurable: true,
        writable: true,
        value: void 0
      });
      Object.defineProperty(this, "iHash", {
        enumerable: true,
        configurable: true,
        writable: true,
        value: void 0
      });
      Object.defineProperty(this, "blockLen", {
        enumerable: true,
        configurable: true,
        writable: true,
        value: void 0
      });
      Object.defineProperty(this, "outputLen", {
        enumerable: true,
        configurable: true,
        writable: true,
        value: void 0
      });
      Object.defineProperty(this, "finished", {
        enumerable: true,
        configurable: true,
        writable: true,
        value: false
      });
      Object.defineProperty(this, "destroyed", {
        enumerable: true,
        configurable: true,
        writable: true,
        value: false
      });
      ahash(hash);
      abytes(key, void 0, "key");
      this.iHash = hash.create();
      if (typeof this.iHash.update !== "function") {
        throw new Error("Expected instance of class which extends utils.Hash");
      }
      this.blockLen = this.iHash.blockLen;
      this.outputLen = this.iHash.outputLen;
      const blockLen = this.blockLen;
      const pad = new Uint8Array(blockLen);
      pad.set(key.length > blockLen ? hash.create().update(key).digest() : key);
      for (let i = 0; i < pad.length; i++)
        pad[i] ^= 54;
      this.iHash.update(pad);
      this.oHash = hash.create();
      for (let i = 0; i < pad.length; i++)
        pad[i] ^= 54 ^ 92;
      this.oHash.update(pad);
      clean(pad);
    }
    update(buf) {
      aexists(this);
      this.iHash.update(buf);
      return this;
    }
    digestInto(out) {
      aexists(this);
      abytes(out, this.outputLen, "output");
      this.finished = true;
      this.iHash.digestInto(out);
      this.oHash.update(out);
      this.oHash.digestInto(out);
      this.destroy();
    }
    digest() {
      const out = new Uint8Array(this.oHash.outputLen);
      this.digestInto(out);
      return out;
    }
    _cloneInto(to) {
      to ||= Object.create(Object.getPrototypeOf(this), {});
      const { oHash, iHash, finished, destroyed, blockLen, outputLen } = this;
      to = to;
      to.finished = finished;
      to.destroyed = destroyed;
      to.blockLen = blockLen;
      to.outputLen = outputLen;
      to.oHash = oHash._cloneInto(to.oHash);
      to.iHash = iHash._cloneInto(to.iHash);
      return to;
    }
    clone() {
      return this._cloneInto();
    }
    destroy() {
      this.destroyed = true;
      this.oHash.destroy();
      this.iHash.destroy();
    }
  };
  var hmac = (hash, key, message) => new _HMAC(hash, key).update(message).digest();
  hmac.create = (hash, key) => new _HMAC(hash, key);

  // ../../../node_modules/@hpke/common/esm/src/hash/u64.js
  var U32_MASK64 = 0xffffffffn;
  var _32n = 32n;
  function fromBig(n, le = false) {
    if (le) {
      return { h: Number(n & U32_MASK64), l: Number(n >> _32n & U32_MASK64) };
    }
    return {
      h: Number(n >> _32n & U32_MASK64) | 0,
      l: Number(n & U32_MASK64) | 0
    };
  }
  function split(lst, le = false) {
    const len = lst.length;
    const Ah = new Uint32Array(len);
    const Al = new Uint32Array(len);
    for (let i = 0; i < len; i++) {
      const { h, l } = fromBig(lst[i], le);
      [Ah[i], Al[i]] = [h, l];
    }
    return [Ah, Al];
  }

  // ../../../node_modules/@hpke/common/esm/src/hash/sha3.js
  var _0n = 0n;
  var _1n = 1n;
  var _2n = 2n;
  var _7n = 7n;
  var _256n = 256n;
  var _0x71n = 0x71n;
  var SHA3_PI = [];
  var SHA3_ROTL = [];
  var _SHA3_IOTA = [];
  for (let round = 0, R = _1n, x = 1, y = 0; round < 24; round++) {
    [x, y] = [y, (2 * x + 3 * y) % 5];
    SHA3_PI.push(2 * (5 * y + x));
    SHA3_ROTL.push((round + 1) * (round + 2) / 2 % 64);
    let t = _0n;
    for (let j = 0; j < 7; j++) {
      R = (R << _1n ^ (R >> _7n) * _0x71n) % _256n;
      if (R & _2n)
        t ^= _1n << (_1n << BigInt(j)) - _1n;
    }
    _SHA3_IOTA.push(t);
  }
  var IOTAS = split(_SHA3_IOTA, true);
  var SHA3_IOTA_H = IOTAS[0];
  var SHA3_IOTA_L = IOTAS[1];

  // ../../../node_modules/@hpke/core/esm/src/aeads/aesGcm.js
  var AesGcmContext = class extends NativeAlgorithm {
    constructor(key) {
      super();
      Object.defineProperty(this, "_rawKey", {
        enumerable: true,
        configurable: true,
        writable: true,
        value: void 0
      });
      Object.defineProperty(this, "_key", {
        enumerable: true,
        configurable: true,
        writable: true,
        value: void 0
      });
      this._rawKey = toArrayBuffer(key);
    }
    async seal(iv, data, aad) {
      await this._setupKey();
      const alg = {
        name: "AES-GCM",
        iv: toArrayBuffer(iv),
        additionalData: toArrayBuffer(aad)
      };
      const ct = await this._api.encrypt(alg, this._key, toArrayBuffer(data));
      return ct;
    }
    async open(iv, data, aad) {
      await this._setupKey();
      const alg = {
        name: "AES-GCM",
        iv: toArrayBuffer(iv),
        additionalData: toArrayBuffer(aad)
      };
      const pt = await this._api.decrypt(alg, this._key, toArrayBuffer(data));
      return pt;
    }
    async _setupKey() {
      if (this._key !== void 0) {
        return;
      }
      await this._setup();
      const key = await this._importKey(this._rawKey);
      new Uint8Array(this._rawKey).fill(0);
      this._key = key;
      return;
    }
    async _importKey(key) {
      return await this._api.importKey("raw", key, { name: "AES-GCM" }, true, AEAD_USAGES);
    }
  };
  var Aes128Gcm = class {
    constructor() {
      Object.defineProperty(this, "id", {
        enumerable: true,
        configurable: true,
        writable: true,
        value: AeadId.Aes128Gcm
      });
      Object.defineProperty(this, "keySize", {
        enumerable: true,
        configurable: true,
        writable: true,
        value: 16
      });
      Object.defineProperty(this, "nonceSize", {
        enumerable: true,
        configurable: true,
        writable: true,
        value: 12
      });
      Object.defineProperty(this, "tagSize", {
        enumerable: true,
        configurable: true,
        writable: true,
        value: 16
      });
    }
    createEncryptionContext(key) {
      return new AesGcmContext(key);
    }
  };
  var Aes256Gcm = class extends Aes128Gcm {
    constructor() {
      super(...arguments);
      Object.defineProperty(this, "id", {
        enumerable: true,
        configurable: true,
        writable: true,
        value: AeadId.Aes256Gcm
      });
      Object.defineProperty(this, "keySize", {
        enumerable: true,
        configurable: true,
        writable: true,
        value: 32
      });
      Object.defineProperty(this, "nonceSize", {
        enumerable: true,
        configurable: true,
        writable: true,
        value: 12
      });
      Object.defineProperty(this, "tagSize", {
        enumerable: true,
        configurable: true,
        writable: true,
        value: 16
      });
    }
  };

  // ../../../node_modules/@hpke/core/esm/src/utils/emitNotSupported.js
  function emitNotSupported() {
    return new Promise((_resolve, reject) => {
      reject(new NotSupportedError("Not supported"));
    });
  }

  // ../../../node_modules/@hpke/core/esm/src/exporterContext.js
  var LABEL_SEC = new Uint8Array([115, 101, 99]);
  var ExporterContextImpl = class {
    constructor(api2, kdf, exporterSecret) {
      Object.defineProperty(this, "_api", {
        enumerable: true,
        configurable: true,
        writable: true,
        value: void 0
      });
      Object.defineProperty(this, "exporterSecret", {
        enumerable: true,
        configurable: true,
        writable: true,
        value: void 0
      });
      Object.defineProperty(this, "_kdf", {
        enumerable: true,
        configurable: true,
        writable: true,
        value: void 0
      });
      this._api = api2;
      this._kdf = kdf;
      this.exporterSecret = exporterSecret;
    }
    async seal(_data, _aad) {
      return await emitNotSupported();
    }
    async open(_data, _aad) {
      return await emitNotSupported();
    }
    async export(exporterContext, len) {
      const rawExporterContext = toArrayBuffer(exporterContext);
      if (rawExporterContext.byteLength > INPUT_LENGTH_LIMIT) {
        throw new InvalidParamError("Too long exporter context");
      }
      try {
        return await this._kdf.labeledExpand(this.exporterSecret, LABEL_SEC, new Uint8Array(rawExporterContext), len);
      } catch (e) {
        throw new ExportError(e);
      }
    }
  };
  var RecipientExporterContextImpl = class extends ExporterContextImpl {
  };
  var SenderExporterContextImpl = class extends ExporterContextImpl {
    constructor(api2, kdf, exporterSecret, enc) {
      super(api2, kdf, exporterSecret);
      Object.defineProperty(this, "enc", {
        enumerable: true,
        configurable: true,
        writable: true,
        value: void 0
      });
      this.enc = enc;
      return;
    }
  };

  // ../../../node_modules/@hpke/core/esm/src/encryptionContext.js
  var EncryptionContextImpl = class extends ExporterContextImpl {
    constructor(api2, kdf, params) {
      super(api2, kdf, params.exporterSecret);
      Object.defineProperty(this, "_aead", {
        enumerable: true,
        configurable: true,
        writable: true,
        value: void 0
      });
      Object.defineProperty(this, "_nK", {
        enumerable: true,
        configurable: true,
        writable: true,
        value: void 0
      });
      Object.defineProperty(this, "_nN", {
        enumerable: true,
        configurable: true,
        writable: true,
        value: void 0
      });
      Object.defineProperty(this, "_nT", {
        enumerable: true,
        configurable: true,
        writable: true,
        value: void 0
      });
      Object.defineProperty(this, "_ctx", {
        enumerable: true,
        configurable: true,
        writable: true,
        value: void 0
      });
      if (params.key === void 0 || params.baseNonce === void 0 || params.seq === void 0) {
        throw new Error("Required parameters are missing");
      }
      this._aead = params.aead;
      this._nK = this._aead.keySize;
      this._nN = this._aead.nonceSize;
      this._nT = this._aead.tagSize;
      const key = this._aead.createEncryptionContext(params.key);
      this._ctx = {
        key,
        baseNonce: params.baseNonce,
        seq: params.seq
      };
    }
    computeNonce(k) {
      const seqBytes = i2Osp(k.seq, k.baseNonce.byteLength);
      return xor(k.baseNonce, seqBytes).buffer;
    }
    incrementSeq(k) {
      if (k.seq > Number.MAX_SAFE_INTEGER) {
        throw new MessageLimitReachedError("Message limit reached");
      }
      k.seq += 1;
      return;
    }
  };

  // ../../../node_modules/@hpke/core/esm/src/mutex.js
  var __classPrivateFieldGet = function(receiver, state, kind, f) {
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
  };
  var __classPrivateFieldSet = function(receiver, state, value, kind, f) {
    if (kind === "m") throw new TypeError("Private method is not writable");
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
    return kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value), value;
  };
  var _Mutex_locked;
  var Mutex = class {
    constructor() {
      _Mutex_locked.set(this, Promise.resolve());
    }
    async lock() {
      let releaseLock;
      const nextLock = new Promise((resolve) => {
        releaseLock = resolve;
      });
      const previousLock = __classPrivateFieldGet(this, _Mutex_locked, "f");
      __classPrivateFieldSet(this, _Mutex_locked, nextLock, "f");
      await previousLock;
      return releaseLock;
    }
  };
  _Mutex_locked = /* @__PURE__ */ new WeakMap();

  // ../../../node_modules/@hpke/core/esm/src/recipientContext.js
  var __classPrivateFieldGet2 = function(receiver, state, kind, f) {
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
  };
  var __classPrivateFieldSet2 = function(receiver, state, value, kind, f) {
    if (kind === "m") throw new TypeError("Private method is not writable");
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
    return kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value), value;
  };
  var _RecipientContextImpl_mutex;
  var RecipientContextImpl = class extends EncryptionContextImpl {
    constructor() {
      super(...arguments);
      _RecipientContextImpl_mutex.set(this, void 0);
    }
    async open(data, aad = EMPTY.buffer) {
      __classPrivateFieldSet2(this, _RecipientContextImpl_mutex, __classPrivateFieldGet2(this, _RecipientContextImpl_mutex, "f") ?? new Mutex(), "f");
      const release = await __classPrivateFieldGet2(this, _RecipientContextImpl_mutex, "f").lock();
      let pt;
      try {
        pt = await this._ctx.key.open(this.computeNonce(this._ctx), toArrayBuffer(data), toArrayBuffer(aad));
      } catch (e) {
        throw new OpenError(e);
      } finally {
        release();
      }
      this.incrementSeq(this._ctx);
      return pt;
    }
  };
  _RecipientContextImpl_mutex = /* @__PURE__ */ new WeakMap();

  // ../../../node_modules/@hpke/core/esm/src/senderContext.js
  var __classPrivateFieldGet3 = function(receiver, state, kind, f) {
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
  };
  var __classPrivateFieldSet3 = function(receiver, state, value, kind, f) {
    if (kind === "m") throw new TypeError("Private method is not writable");
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
    return kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value), value;
  };
  var _SenderContextImpl_mutex;
  var SenderContextImpl = class extends EncryptionContextImpl {
    constructor(api2, kdf, params, enc) {
      super(api2, kdf, params);
      Object.defineProperty(this, "enc", {
        enumerable: true,
        configurable: true,
        writable: true,
        value: void 0
      });
      _SenderContextImpl_mutex.set(this, void 0);
      this.enc = enc;
    }
    async seal(data, aad = EMPTY.buffer) {
      __classPrivateFieldSet3(this, _SenderContextImpl_mutex, __classPrivateFieldGet3(this, _SenderContextImpl_mutex, "f") ?? new Mutex(), "f");
      const release = await __classPrivateFieldGet3(this, _SenderContextImpl_mutex, "f").lock();
      let ct;
      try {
        ct = await this._ctx.key.seal(this.computeNonce(this._ctx), toArrayBuffer(data), toArrayBuffer(aad));
      } catch (e) {
        throw new SealError(e);
      } finally {
        release();
      }
      this.incrementSeq(this._ctx);
      return ct;
    }
  };
  _SenderContextImpl_mutex = /* @__PURE__ */ new WeakMap();

  // ../../../node_modules/@hpke/core/esm/src/cipherSuiteNative.js
  var LABEL_BASE_NONCE = new Uint8Array([
    98,
    97,
    115,
    101,
    95,
    110,
    111,
    110,
    99,
    101
  ]);
  var LABEL_EXP = new Uint8Array([101, 120, 112]);
  var LABEL_INFO_HASH = new Uint8Array([
    105,
    110,
    102,
    111,
    95,
    104,
    97,
    115,
    104
  ]);
  var LABEL_KEY = new Uint8Array([107, 101, 121]);
  var LABEL_PSK_ID_HASH = new Uint8Array([
    112,
    115,
    107,
    95,
    105,
    100,
    95,
    104,
    97,
    115,
    104
  ]);
  var LABEL_SECRET = new Uint8Array([115, 101, 99, 114, 101, 116]);
  var SUITE_ID_HEADER_HPKE = new Uint8Array([
    72,
    80,
    75,
    69,
    0,
    0,
    0,
    0,
    0,
    0
  ]);
  var CipherSuiteNative = class extends NativeAlgorithm {
    /**
     * @param params A set of parameters for building a cipher suite.
     *
     * If the error occurred, throws {@link InvalidParamError}.
     *
     * @throws {@link InvalidParamError}
     */
    constructor(params) {
      super();
      Object.defineProperty(this, "_kem", {
        enumerable: true,
        configurable: true,
        writable: true,
        value: void 0
      });
      Object.defineProperty(this, "_kdf", {
        enumerable: true,
        configurable: true,
        writable: true,
        value: void 0
      });
      Object.defineProperty(this, "_aead", {
        enumerable: true,
        configurable: true,
        writable: true,
        value: void 0
      });
      Object.defineProperty(this, "_suiteId", {
        enumerable: true,
        configurable: true,
        writable: true,
        value: void 0
      });
      if (typeof params.kem === "number") {
        throw new InvalidParamError("KemId cannot be used");
      }
      this._kem = params.kem;
      if (typeof params.kdf === "number") {
        throw new InvalidParamError("KdfId cannot be used");
      }
      this._kdf = params.kdf;
      if (typeof params.aead === "number") {
        throw new InvalidParamError("AeadId cannot be used");
      }
      this._aead = params.aead;
      this._suiteId = new Uint8Array(SUITE_ID_HEADER_HPKE);
      this._suiteId.set(i2Osp(this._kem.id, 2), 4);
      this._suiteId.set(i2Osp(this._kdf.id, 2), 6);
      this._suiteId.set(i2Osp(this._aead.id, 2), 8);
      this._kdf.init(this._suiteId);
    }
    /**
     * Gets the KEM context of the ciphersuite.
     */
    get kem() {
      return this._kem;
    }
    /**
     * Gets the KDF context of the ciphersuite.
     */
    get kdf() {
      return this._kdf;
    }
    /**
     * Gets the AEAD context of the ciphersuite.
     */
    get aead() {
      return this._aead;
    }
    /**
     * Creates an encryption context for a sender.
     *
     * If the error occurred, throws {@link DecapError} | {@link ValidationError}.
     *
     * @param params A set of parameters for the sender encryption context.
     * @returns A sender encryption context.
     * @throws {@link EncapError}, {@link ValidationError}
     */
    async createSenderContext(params) {
      this._validateInputLength(params);
      await this._setup();
      const dh = await this._kem.encap(params);
      let mode;
      if (params.psk !== void 0) {
        mode = params.senderKey !== void 0 ? Mode.AuthPsk : Mode.Psk;
      } else {
        mode = params.senderKey !== void 0 ? Mode.Auth : Mode.Base;
      }
      return await this._keyScheduleS(mode, dh.sharedSecret, dh.enc, params);
    }
    /**
     * Creates an encryption context for a recipient.
     *
     * If the error occurred, throws {@link DecapError}
     * | {@link DeserializeError} | {@link ValidationError}.
     *
     * @param params A set of parameters for the recipient encryption context.
     * @returns A recipient encryption context.
     * @throws {@link DecapError}, {@link DeserializeError}, {@link ValidationError}
     */
    async createRecipientContext(params) {
      this._validateInputLength(params);
      await this._setup();
      const sharedSecret = await this._kem.decap(params);
      let mode;
      if (params.psk !== void 0) {
        mode = params.senderPublicKey !== void 0 ? Mode.AuthPsk : Mode.Psk;
      } else {
        mode = params.senderPublicKey !== void 0 ? Mode.Auth : Mode.Base;
      }
      return await this._keyScheduleR(mode, sharedSecret, params);
    }
    /**
     * Encrypts a message to a recipient.
     *
     * If the error occurred, throws `EncapError` | `MessageLimitReachedError` | `SealError` | `ValidationError`.
     *
     * @param params A set of parameters for building a sender encryption context.
     * @param pt A plain text as bytes to be encrypted.
     * @param aad Additional authenticated data as bytes fed by an application.
     * @returns A cipher text and an encapsulated key as bytes.
     * @throws {@link EncapError}, {@link MessageLimitReachedError}, {@link SealError}, {@link ValidationError}
     */
    async seal(params, pt, aad = EMPTY.buffer) {
      const ctx = await this.createSenderContext(params);
      return {
        ct: await ctx.seal(pt, aad),
        enc: ctx.enc
      };
    }
    /**
     * Decrypts a message from a sender.
     *
     * If the error occurred, throws `DecapError` | `DeserializeError` | `OpenError` | `ValidationError`.
     *
     * @param params A set of parameters for building a recipient encryption context.
     * @param ct An encrypted text as bytes to be decrypted.
     * @param aad Additional authenticated data as bytes fed by an application.
     * @returns A decrypted plain text as bytes.
     * @throws {@link DecapError}, {@link DeserializeError}, {@link OpenError}, {@link ValidationError}
     */
    async open(params, ct, aad = EMPTY.buffer) {
      const ctx = await this.createRecipientContext(params);
      return await ctx.open(ct, aad);
    }
    // private verifyPskInputs(mode: Mode, params: KeyScheduleParams) {
    //   const gotPsk = (params.psk !== undefined);
    //   const gotPskId = (params.psk !== undefined && params.psk.id.byteLength > 0);
    //   if (gotPsk !== gotPskId) {
    //     throw new Error('Inconsistent PSK inputs');
    //   }
    //   if (gotPsk && (mode === Mode.Base || mode === Mode.Auth)) {
    //     throw new Error('PSK input provided when not needed');
    //   }
    //   if (!gotPsk && (mode === Mode.Psk || mode === Mode.AuthPsk)) {
    //     throw new Error('Missing required PSK input');
    //   }
    //   return;
    // }
    async _keySchedule(mode, sharedSecret, params) {
      const pskId = params.psk === void 0 ? EMPTY : toUint8Array(params.psk.id);
      const pskIdHash = await this._kdf.labeledExtract(EMPTY, LABEL_PSK_ID_HASH, pskId);
      const info = params.info === void 0 ? EMPTY : toUint8Array(params.info);
      const infoHash = await this._kdf.labeledExtract(EMPTY, LABEL_INFO_HASH, info);
      const keyScheduleContext = new Uint8Array(1 + pskIdHash.byteLength + infoHash.byteLength);
      keyScheduleContext.set(new Uint8Array([mode]), 0);
      keyScheduleContext.set(new Uint8Array(pskIdHash), 1);
      keyScheduleContext.set(new Uint8Array(infoHash), 1 + pskIdHash.byteLength);
      const psk = params.psk === void 0 ? EMPTY : toUint8Array(params.psk.key);
      const ikm = this._kdf.buildLabeledIkm(LABEL_SECRET, psk);
      const exporterSecretInfo = this._kdf.buildLabeledInfo(LABEL_EXP, keyScheduleContext, this._kdf.hashSize);
      const exporterSecret = await this._kdf.extractAndExpand(sharedSecret, ikm, exporterSecretInfo, this._kdf.hashSize);
      if (this._aead.id === AeadId.ExportOnly) {
        return { aead: this._aead, exporterSecret };
      }
      const keyInfo = this._kdf.buildLabeledInfo(LABEL_KEY, keyScheduleContext, this._aead.keySize);
      const key = await this._kdf.extractAndExpand(sharedSecret, ikm, keyInfo, this._aead.keySize);
      const baseNonceInfo = this._kdf.buildLabeledInfo(LABEL_BASE_NONCE, keyScheduleContext, this._aead.nonceSize);
      const baseNonce = await this._kdf.extractAndExpand(sharedSecret, ikm, baseNonceInfo, this._aead.nonceSize);
      return {
        aead: this._aead,
        exporterSecret,
        key,
        baseNonce: new Uint8Array(baseNonce),
        seq: 0
      };
    }
    async _keyScheduleS(mode, sharedSecret, enc, params) {
      const res = await this._keySchedule(mode, sharedSecret, params);
      if (res.key === void 0) {
        return new SenderExporterContextImpl(this._api, this._kdf, res.exporterSecret, enc);
      }
      return new SenderContextImpl(this._api, this._kdf, res, enc);
    }
    async _keyScheduleR(mode, sharedSecret, params) {
      const res = await this._keySchedule(mode, sharedSecret, params);
      if (res.key === void 0) {
        return new RecipientExporterContextImpl(this._api, this._kdf, res.exporterSecret);
      }
      return new RecipientContextImpl(this._api, this._kdf, res);
    }
    _validateInputLength(params) {
      if (params.info !== void 0 && params.info.byteLength > INFO_LENGTH_LIMIT) {
        throw new InvalidParamError("Too long info");
      }
      if (params.psk !== void 0) {
        if (params.psk.key.byteLength < MINIMUM_PSK_LENGTH) {
          throw new InvalidParamError(`PSK must have at least ${MINIMUM_PSK_LENGTH} bytes`);
        }
        if (params.psk.key.byteLength > INPUT_LENGTH_LIMIT) {
          throw new InvalidParamError("Too long psk.key");
        }
        if (params.psk.id.byteLength > INPUT_LENGTH_LIMIT) {
          throw new InvalidParamError("Too long psk.id");
        }
      }
      return;
    }
  };

  // ../../../node_modules/@hpke/core/esm/src/native.js
  var CipherSuite = class extends CipherSuiteNative {
  };
  var HkdfSha256 = class extends HkdfSha256Native {
  };

  // ../../../node_modules/@hpke/core/esm/src/kems/dhkemPrimitives/x25519.js
  var ALG_NAME = "X25519";
  var PKCS8_ALG_ID_X25519 = new Uint8Array([
    48,
    46,
    2,
    1,
    0,
    48,
    5,
    6,
    3,
    43,
    101,
    110,
    4,
    34,
    4,
    32
  ]);
  var BASE_POINT_X25519 = /* @__PURE__ */ (() => {
    const p = new Uint8Array(32);
    p[0] = 9;
    return p;
  })();
  var X25519 = class extends NativeAlgorithm {
    constructor(hkdf2) {
      super();
      Object.defineProperty(this, "_hkdf", {
        enumerable: true,
        configurable: true,
        writable: true,
        value: void 0
      });
      Object.defineProperty(this, "_alg", {
        enumerable: true,
        configurable: true,
        writable: true,
        value: void 0
      });
      Object.defineProperty(this, "_nPk", {
        enumerable: true,
        configurable: true,
        writable: true,
        value: void 0
      });
      Object.defineProperty(this, "_nSk", {
        enumerable: true,
        configurable: true,
        writable: true,
        value: void 0
      });
      Object.defineProperty(this, "_nDh", {
        enumerable: true,
        configurable: true,
        writable: true,
        value: void 0
      });
      Object.defineProperty(this, "_pkcs8AlgId", {
        enumerable: true,
        configurable: true,
        writable: true,
        value: void 0
      });
      this._alg = { name: ALG_NAME };
      this._hkdf = hkdf2;
      this._nPk = 32;
      this._nSk = 32;
      this._nDh = 32;
      this._pkcs8AlgId = PKCS8_ALG_ID_X25519;
    }
    async serializePublicKey(key) {
      await this._setup();
      try {
        return await this._api.exportKey("raw", key);
      } catch (e) {
        throw new SerializeError(e);
      }
    }
    async deserializePublicKey(key) {
      await this._setup();
      try {
        return await this._importRawKey(toArrayBuffer(key), true);
      } catch (e) {
        throw new DeserializeError(e);
      }
    }
    async serializePrivateKey(key) {
      await this._setup();
      try {
        const jwk = await this._api.exportKey("jwk", key);
        if (!("d" in jwk)) {
          throw new Error("Not private key");
        }
        return base64UrlToBytes(jwk["d"]).buffer;
      } catch (e) {
        throw new SerializeError(e);
      }
    }
    async deserializePrivateKey(key) {
      await this._setup();
      try {
        return await this._importRawKey(toArrayBuffer(key), false);
      } catch (e) {
        throw new DeserializeError(e);
      }
    }
    async importKey(format, key, isPublic) {
      await this._setup();
      try {
        if (format === "raw") {
          return await this._importRawKey(key, isPublic);
        }
        if (key instanceof ArrayBuffer) {
          throw new Error("Invalid jwk key format");
        }
        return await this._importJWK(key, isPublic);
      } catch (e) {
        throw new DeserializeError(e);
      }
    }
    async generateKeyPair() {
      await this._setup();
      try {
        return await this._api.generateKey(ALG_NAME, true, KEM_USAGES);
      } catch (e) {
        throw new NotSupportedError(e);
      }
    }
    async deriveKeyPair(ikm) {
      await this._setup();
      try {
        const rawIkm = toArrayBuffer(ikm);
        const dkpPrk = await this._hkdf.labeledExtract(EMPTY, LABEL_DKP_PRK, new Uint8Array(rawIkm));
        const rawSk = await this._hkdf.labeledExpand(dkpPrk, LABEL_SK, EMPTY, this._nSk);
        const rawSkBytes = new Uint8Array(rawSk);
        const sk = await this._deserializePkcs8Key(rawSkBytes);
        rawSkBytes.fill(0);
        return {
          privateKey: sk,
          publicKey: await this.derivePublicKey(sk)
        };
      } catch (e) {
        throw new DeriveKeyPairError(e);
      }
    }
    async derivePublicKey(key) {
      await this._setup();
      try {
        const jwk = await this._api.exportKey("jwk", key);
        delete jwk["d"];
        delete jwk["key_ops"];
        return await this._api.importKey("jwk", jwk, this._alg, true, []);
      } catch {
        try {
          const bp = await this._api.importKey("raw", BASE_POINT_X25519.buffer, this._alg, true, []);
          const bits = await this._api.deriveBits({
            name: ALG_NAME,
            public: bp
          }, key, this._nPk * 8);
          return await this._api.importKey("raw", bits, this._alg, true, []);
        } catch (e) {
          throw new DeserializeError(e);
        }
      }
    }
    async dh(sk, pk) {
      await this._setup();
      try {
        const bits = await this._api.deriveBits({
          name: ALG_NAME,
          public: pk
        }, sk, this._nDh * 8);
        return bits;
      } catch (e) {
        throw new SerializeError(e);
      }
    }
    async _importRawKey(key, isPublic) {
      if (isPublic && key.byteLength !== this._nPk) {
        throw new Error("Invalid public key for the ciphersuite");
      }
      if (!isPublic && key.byteLength !== this._nSk) {
        throw new Error("Invalid private key for the ciphersuite");
      }
      if (isPublic) {
        return await this._api.importKey("raw", key, this._alg, true, []);
      }
      return await this._deserializePkcs8Key(new Uint8Array(key));
    }
    async _importJWK(key, isPublic) {
      if (typeof key.kty === "undefined" || key.kty !== "OKP") {
        throw new Error(`Invalid kty: ${key.crv}`);
      }
      if (typeof key.crv === "undefined" || key.crv !== ALG_NAME) {
        throw new Error(`Invalid crv: ${key.crv}`);
      }
      if (isPublic) {
        if (typeof key.d !== "undefined") {
          throw new Error("Invalid key: `d` should not be set");
        }
        return await this._api.importKey("jwk", key, this._alg, true, []);
      }
      if (typeof key.d === "undefined") {
        throw new Error("Invalid key: `d` not found");
      }
      return await this._api.importKey("jwk", key, this._alg, true, KEM_USAGES);
    }
    async _deserializePkcs8Key(k) {
      const pkcs8Key = new Uint8Array(this._pkcs8AlgId.length + k.length);
      pkcs8Key.set(this._pkcs8AlgId, 0);
      pkcs8Key.set(k, this._pkcs8AlgId.length);
      return await this._api.importKey("pkcs8", pkcs8Key, this._alg, true, KEM_USAGES);
    }
  };

  // ../../../node_modules/@hpke/core/esm/src/kems/dhkemX25519.js
  var DhkemX25519HkdfSha256 = class extends Dhkem {
    constructor() {
      const kdf = new HkdfSha256Native();
      super(KemId.DhkemX25519HkdfSha256, new X25519(kdf), kdf);
      Object.defineProperty(this, "id", {
        enumerable: true,
        configurable: true,
        writable: true,
        value: KemId.DhkemX25519HkdfSha256
      });
      Object.defineProperty(this, "secretSize", {
        enumerable: true,
        configurable: true,
        writable: true,
        value: 32
      });
      Object.defineProperty(this, "encSize", {
        enumerable: true,
        configurable: true,
        writable: true,
        value: 32
      });
      Object.defineProperty(this, "publicKeySize", {
        enumerable: true,
        configurable: true,
        writable: true,
        value: 32
      });
      Object.defineProperty(this, "privateKeySize", {
        enumerable: true,
        configurable: true,
        writable: true,
        value: 32
      });
    }
  };

  // ../../../node_modules/@hpke/core/esm/src/kems/dhkemPrimitives/x448.js
  var PKCS8_ALG_ID_X448 = new Uint8Array([
    48,
    70,
    2,
    1,
    0,
    48,
    5,
    6,
    3,
    43,
    101,
    111,
    4,
    58,
    4,
    56
  ]);

  // client/e2ee/src/crypto.ts
  var ALGORITHM = "x25519-hpke-aes256gcm-ed25519";
  var suite = new CipherSuite({ kem: new DhkemX25519HkdfSha256(), kdf: new HkdfSha256(), aead: new Aes256Gcm() });
  var subtle = () => crypto.subtle;
  var generateSigningKey = () => subtle().generateKey({ name: "Ed25519" }, false, ["sign", "verify"]);
  var generateAgreementKey = () => subtle().generateKey({ name: "X25519" }, false, ["deriveBits"]);
  var exportPublic = async (key) => toB64u(await subtle().exportKey("raw", key));
  var sign = async (key, message) => toB64u(await subtle().sign({ name: "Ed25519" }, key, utf8(message)));
  var verify = async (publicKey, message, signature) => {
    try {
      const raw = fromB64u(publicKey);
      const sig = fromB64u(signature);
      if (raw.length !== 32 || sig.length !== 64) return false;
      const key = await subtle().importKey("raw", raw, { name: "Ed25519" }, false, ["verify"]);
      return await subtle().verify({ name: "Ed25519" }, key, sig, utf8(message));
    } catch {
      return false;
    }
  };
  var deviceIdFor = async (signingKey) => toB64u((await sha256(fromB64u(signingKey))).subarray(0, 16));
  var hpkeSeal = async (recipientPublic, plaintext, info, aad) => {
    const recipientPublicKey = await suite.kem.deserializePublicKey(fromB64u(recipientPublic));
    const { ct, enc } = await suite.seal({ recipientPublicKey, info: utf8(info) }, plaintext, utf8(aad));
    return { enc: toB64u(enc), wrapped: toB64u(ct) };
  };
  var hpkeOpen = async (recipientKey, enc, wrapped, info, aad) => new Uint8Array(await suite.open({ recipientKey, enc: fromB64u(enc), info: utf8(info) }, fromB64u(wrapped), utf8(aad)));
  var aesKey = (raw, usage) => subtle().importKey("raw", raw, { name: "AES-GCM" }, false, [usage]);
  var aesEncrypt = async (raw, iv, plaintext, aad) => new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv, additionalData: utf8(aad) }, await aesKey(raw, "encrypt"), plaintext));
  var aesDecrypt = async (raw, iv, ciphertext, aad) => new Uint8Array(await subtle().decrypt({ name: "AES-GCM", iv, additionalData: utf8(aad) }, await aesKey(raw, "decrypt"), ciphertext));
  var generateExportable = async (name) => {
    const pair = await subtle().generateKey({ name }, true, name === "Ed25519" ? ["sign", "verify"] : ["deriveBits"]);
    const { kty, crv, x, d } = await subtle().exportKey("jwk", pair.privateKey);
    return { kty, crv, x, d };
  };
  var importSigningJwk = (jwk) => subtle().importKey("jwk", { ...jwk, key_ops: ["sign"] }, { name: "Ed25519" }, false, ["sign"]);
  var importAgreementJwk = async (jwk) => ({
    privateKey: await subtle().importKey("jwk", { ...jwk, key_ops: ["deriveBits"] }, { name: "X25519" }, false, ["deriveBits"]),
    publicKey: await subtle().importKey("raw", fromB64u(jwk.x), { name: "X25519" }, true, [])
  });
  var x25519 = async (privateKey, publicKey) => {
    const peer = await subtle().importKey("raw", fromB64u(publicKey), { name: "X25519" }, false, []);
    return new Uint8Array(await subtle().deriveBits({ name: "X25519", public: peer }, privateKey, 256));
  };
  var hkdf = async (ikm, salt, info) => {
    const base = await subtle().importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
    return new Uint8Array(await subtle().deriveBits({ name: "HKDF", hash: "SHA-256", salt, info: utf8(info) }, base, 256));
  };
  var sealBox = async (key, plaintext, aad) => {
    const iv = new Uint8Array(12);
    crypto.getRandomValues(iv);
    const ct = await aesEncrypt(key, iv, plaintext, aad);
    const out = new Uint8Array(12 + ct.length);
    out.set(iv);
    out.set(ct, 12);
    return toB64u(out);
  };
  var openBox = (key, box, aad) => {
    const raw = fromB64u(box);
    if (raw.length < 28) throw new Error("box too short");
    return aesDecrypt(key, raw.slice(0, 12), raw.slice(12), aad);
  };
  var rotationMessage = (userId, previousKey, nextKey) => `fosscord-e2ee/v1/identity-rotate
${userId}
${previousKey}
${nextKey}`;
  var backupKeyMessage = (userId, publicKey) => `fosscord-e2ee/v1/backup-key
${userId}
${publicKey}`;
  var deviceMessage = (userId, deviceId, signingKey) => `fosscord-e2ee/v1/device
${userId}
${deviceId}
${signingKey}`;
  var prekeyMessage = (deviceId, prekeyId, publicKey) => `fosscord-e2ee/v1/prekey
${deviceId}
${prekeyId}
${publicKey}`;

  // ../../../node_modules/hash-wasm/dist/index.esm.js
  function __awaiter(thisArg, _arguments, P, generator) {
    function adopt(value) {
      return value instanceof P ? value : new P(function(resolve) {
        resolve(value);
      });
    }
    return new (P || (P = Promise))(function(resolve, reject) {
      function fulfilled(value) {
        try {
          step(generator.next(value));
        } catch (e) {
          reject(e);
        }
      }
      function rejected(value) {
        try {
          step(generator["throw"](value));
        } catch (e) {
          reject(e);
        }
      }
      function step(result) {
        result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected);
      }
      step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
  }
  var Mutex2 = class {
    constructor() {
      this.mutex = Promise.resolve();
    }
    lock() {
      let begin = () => {
      };
      this.mutex = this.mutex.then(() => new Promise(begin));
      return new Promise((res) => {
        begin = res;
      });
    }
    dispatch(fn) {
      return __awaiter(this, void 0, void 0, function* () {
        const unlock = yield this.lock();
        try {
          return yield Promise.resolve(fn());
        } finally {
          unlock();
        }
      });
    }
  };
  var _a;
  function getGlobal() {
    if (typeof globalThis !== "undefined")
      return globalThis;
    if (typeof self !== "undefined")
      return self;
    if (typeof window !== "undefined")
      return window;
    return global;
  }
  var globalObject = getGlobal();
  var nodeBuffer = (_a = globalObject.Buffer) !== null && _a !== void 0 ? _a : null;
  var textEncoder = globalObject.TextEncoder ? new globalObject.TextEncoder() : null;
  function hexCharCodesToInt(a, b) {
    return (a & 15) + (a >> 6 | a >> 3 & 8) << 4 | (b & 15) + (b >> 6 | b >> 3 & 8);
  }
  function writeHexToUInt8(buf, str) {
    const size = str.length >> 1;
    for (let i = 0; i < size; i++) {
      const index = i << 1;
      buf[i] = hexCharCodesToInt(str.charCodeAt(index), str.charCodeAt(index + 1));
    }
  }
  function hexStringEqualsUInt8(str, buf) {
    if (str.length !== buf.length * 2) {
      return false;
    }
    for (let i = 0; i < buf.length; i++) {
      const strIndex = i << 1;
      if (buf[i] !== hexCharCodesToInt(str.charCodeAt(strIndex), str.charCodeAt(strIndex + 1))) {
        return false;
      }
    }
    return true;
  }
  var alpha = "a".charCodeAt(0) - 10;
  var digit = "0".charCodeAt(0);
  function getDigestHex(tmpBuffer, input, hashLength) {
    let p = 0;
    for (let i = 0; i < hashLength; i++) {
      let nibble = input[i] >>> 4;
      tmpBuffer[p++] = nibble > 9 ? nibble + alpha : nibble + digit;
      nibble = input[i] & 15;
      tmpBuffer[p++] = nibble > 9 ? nibble + alpha : nibble + digit;
    }
    return String.fromCharCode.apply(null, tmpBuffer);
  }
  var getUInt8Buffer = nodeBuffer !== null ? (data) => {
    if (typeof data === "string") {
      const buf = nodeBuffer.from(data, "utf8");
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.length);
    }
    if (nodeBuffer.isBuffer(data)) {
      return new Uint8Array(data.buffer, data.byteOffset, data.length);
    }
    if (ArrayBuffer.isView(data)) {
      return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    }
    throw new Error("Invalid data type!");
  } : (data) => {
    if (typeof data === "string") {
      return textEncoder.encode(data);
    }
    if (ArrayBuffer.isView(data)) {
      return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    }
    throw new Error("Invalid data type!");
  };
  var base64Chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  var base64Lookup = new Uint8Array(256);
  for (let i = 0; i < base64Chars.length; i++) {
    base64Lookup[base64Chars.charCodeAt(i)] = i;
  }
  function encodeBase64(data, pad = true) {
    const len = data.length;
    const extraBytes = len % 3;
    const parts = [];
    const len2 = len - extraBytes;
    for (let i = 0; i < len2; i += 3) {
      const tmp = (data[i] << 16 & 16711680) + (data[i + 1] << 8 & 65280) + (data[i + 2] & 255);
      const triplet = base64Chars.charAt(tmp >> 18 & 63) + base64Chars.charAt(tmp >> 12 & 63) + base64Chars.charAt(tmp >> 6 & 63) + base64Chars.charAt(tmp & 63);
      parts.push(triplet);
    }
    if (extraBytes === 1) {
      const tmp = data[len - 1];
      const a = base64Chars.charAt(tmp >> 2);
      const b = base64Chars.charAt(tmp << 4 & 63);
      parts.push(`${a}${b}`);
      if (pad) {
        parts.push("==");
      }
    } else if (extraBytes === 2) {
      const tmp = (data[len - 2] << 8) + data[len - 1];
      const a = base64Chars.charAt(tmp >> 10);
      const b = base64Chars.charAt(tmp >> 4 & 63);
      const c = base64Chars.charAt(tmp << 2 & 63);
      parts.push(`${a}${b}${c}`);
      if (pad) {
        parts.push("=");
      }
    }
    return parts.join("");
  }
  function getDecodeBase64Length(data) {
    let bufferLength = Math.floor(data.length * 0.75);
    const len = data.length;
    if (data[len - 1] === "=") {
      bufferLength -= 1;
      if (data[len - 2] === "=") {
        bufferLength -= 1;
      }
    }
    return bufferLength;
  }
  function decodeBase64(data) {
    const bufferLength = getDecodeBase64Length(data);
    const len = data.length;
    const bytes = new Uint8Array(bufferLength);
    let p = 0;
    for (let i = 0; i < len; i += 4) {
      const encoded1 = base64Lookup[data.charCodeAt(i)];
      const encoded2 = base64Lookup[data.charCodeAt(i + 1)];
      const encoded3 = base64Lookup[data.charCodeAt(i + 2)];
      const encoded4 = base64Lookup[data.charCodeAt(i + 3)];
      bytes[p] = encoded1 << 2 | encoded2 >> 4;
      p += 1;
      bytes[p] = (encoded2 & 15) << 4 | encoded3 >> 2;
      p += 1;
      bytes[p] = (encoded3 & 3) << 6 | encoded4 & 63;
      p += 1;
    }
    return bytes;
  }
  var MAX_HEAP = 16 * 1024;
  var WASM_FUNC_HASH_LENGTH = 4;
  var wasmMutex = new Mutex2();
  var wasmModuleCache = /* @__PURE__ */ new Map();
  function WASMInterface(binary, hashLength) {
    return __awaiter(this, void 0, void 0, function* () {
      let wasmInstance = null;
      let memoryView = null;
      let initialized2 = false;
      if (typeof WebAssembly === "undefined") {
        throw new Error("WebAssembly is not supported in this environment!");
      }
      const writeMemory = (data, offset = 0) => {
        memoryView.set(data, offset);
      };
      const getMemory = () => memoryView;
      const getExports = () => wasmInstance.exports;
      const setMemorySize = (totalSize) => {
        wasmInstance.exports.Hash_SetMemorySize(totalSize);
        const arrayOffset = wasmInstance.exports.Hash_GetBuffer();
        const memoryBuffer = wasmInstance.exports.memory.buffer;
        memoryView = new Uint8Array(memoryBuffer, arrayOffset, totalSize);
      };
      const getStateSize = () => {
        const view = new DataView(wasmInstance.exports.memory.buffer);
        const stateSize = view.getUint32(wasmInstance.exports.STATE_SIZE, true);
        return stateSize;
      };
      const loadWASMPromise = wasmMutex.dispatch(() => __awaiter(this, void 0, void 0, function* () {
        if (!wasmModuleCache.has(binary.name)) {
          const asm = decodeBase64(binary.data);
          const promise = WebAssembly.compile(asm);
          wasmModuleCache.set(binary.name, promise);
        }
        const module = yield wasmModuleCache.get(binary.name);
        wasmInstance = yield WebAssembly.instantiate(module, {
          // env: {
          //   emscripten_memcpy_big: (dest, src, num) => {
          //     const memoryBuffer = wasmInstance.exports.memory.buffer;
          //     const memView = new Uint8Array(memoryBuffer, 0);
          //     memView.set(memView.subarray(src, src + num), dest);
          //   },
          //   print_memory: (offset, len) => {
          //     const memoryBuffer = wasmInstance.exports.memory.buffer;
          //     const memView = new Uint8Array(memoryBuffer, 0);
          //     console.log('print_int32', memView.subarray(offset, offset + len));
          //   },
          // },
        });
      }));
      const setupInterface = () => __awaiter(this, void 0, void 0, function* () {
        if (!wasmInstance) {
          yield loadWASMPromise;
        }
        const arrayOffset = wasmInstance.exports.Hash_GetBuffer();
        const memoryBuffer = wasmInstance.exports.memory.buffer;
        memoryView = new Uint8Array(memoryBuffer, arrayOffset, MAX_HEAP);
      });
      const init = (bits = null) => {
        initialized2 = true;
        wasmInstance.exports.Hash_Init(bits);
      };
      const updateUInt8Array = (data) => {
        let read = 0;
        while (read < data.length) {
          const chunk = data.subarray(read, read + MAX_HEAP);
          read += chunk.length;
          memoryView.set(chunk);
          wasmInstance.exports.Hash_Update(chunk.length);
        }
      };
      const update = (data) => {
        if (!initialized2) {
          throw new Error("update() called before init()");
        }
        const Uint8Buffer = getUInt8Buffer(data);
        updateUInt8Array(Uint8Buffer);
      };
      const digestChars = new Uint8Array(hashLength * 2);
      const digest = (outputType, padding = null) => {
        if (!initialized2) {
          throw new Error("digest() called before init()");
        }
        initialized2 = false;
        wasmInstance.exports.Hash_Final(padding);
        if (outputType === "binary") {
          return memoryView.slice(0, hashLength);
        }
        return getDigestHex(digestChars, memoryView, hashLength);
      };
      const save = () => {
        if (!initialized2) {
          throw new Error("save() can only be called after init() and before digest()");
        }
        const stateOffset = wasmInstance.exports.Hash_GetState();
        const stateLength = getStateSize();
        const memoryBuffer = wasmInstance.exports.memory.buffer;
        const internalState = new Uint8Array(memoryBuffer, stateOffset, stateLength);
        const prefixedState = new Uint8Array(WASM_FUNC_HASH_LENGTH + stateLength);
        writeHexToUInt8(prefixedState, binary.hash);
        prefixedState.set(internalState, WASM_FUNC_HASH_LENGTH);
        return prefixedState;
      };
      const load = (state) => {
        if (!(state instanceof Uint8Array)) {
          throw new Error("load() expects an Uint8Array generated by save()");
        }
        const stateOffset = wasmInstance.exports.Hash_GetState();
        const stateLength = getStateSize();
        const overallLength = WASM_FUNC_HASH_LENGTH + stateLength;
        const memoryBuffer = wasmInstance.exports.memory.buffer;
        if (state.length !== overallLength) {
          throw new Error(`Bad state length (expected ${overallLength} bytes, got ${state.length})`);
        }
        if (!hexStringEqualsUInt8(binary.hash, state.subarray(0, WASM_FUNC_HASH_LENGTH))) {
          throw new Error("This state was written by an incompatible hash implementation");
        }
        const internalState = state.subarray(WASM_FUNC_HASH_LENGTH);
        new Uint8Array(memoryBuffer, stateOffset, stateLength).set(internalState);
        initialized2 = true;
      };
      const isDataShort = (data) => {
        if (typeof data === "string") {
          return data.length < MAX_HEAP / 4;
        }
        return data.byteLength < MAX_HEAP;
      };
      let canSimplify = isDataShort;
      switch (binary.name) {
        case "argon2":
        case "scrypt":
          canSimplify = () => true;
          break;
        case "blake2b":
        case "blake2s":
          canSimplify = (data, initParam) => initParam <= 512 && isDataShort(data);
          break;
        case "blake3":
          canSimplify = (data, initParam) => initParam === 0 && isDataShort(data);
          break;
        case "xxhash64":
        // cannot simplify
        case "xxhash3":
        case "xxhash128":
        case "crc64":
          canSimplify = () => false;
          break;
      }
      const calculate = (data, initParam = null, digestParam = null) => {
        if (!canSimplify(data, initParam)) {
          init(initParam);
          update(data);
          return digest("hex", digestParam);
        }
        const buffer = getUInt8Buffer(data);
        memoryView.set(buffer);
        wasmInstance.exports.Hash_Calculate(buffer.length, initParam, digestParam);
        return getDigestHex(digestChars, memoryView, hashLength);
      };
      yield setupInterface();
      return {
        getMemory,
        writeMemory,
        getExports,
        setMemorySize,
        init,
        update,
        digest,
        save,
        load,
        calculate,
        hashLength
      };
    });
  }
  var mutex$l = new Mutex2();
  var name$k = "argon2";
  var data$k = "AGFzbQEAAAABKQVgAX8Bf2AAAX9gEH9/f39/f39/f39/f39/f38AYAR/f39/AGACf38AAwYFAAECAwQFBgEBAoCAAgYIAX8BQZCoBAsHQQQGbWVtb3J5AgASSGFzaF9TZXRNZW1vcnlTaXplAAAOSGFzaF9HZXRCdWZmZXIAAQ5IYXNoX0NhbGN1bGF0ZQAECvEyBVgBAn9BACEBAkAgAEEAKAKICCICRg0AAkAgACACayIAQRB2IABBgIB8cSAASWoiAEAAQX9HDQBB/wHADwtBACEBQQBBACkDiAggAEEQdK18NwOICAsgAcALcAECfwJAQQAoAoAIIgANAEEAPwBBEHQiADYCgAhBACgCiAgiAUGAgCBGDQACQEGAgCAgAWsiAEEQdiAAQYCAfHEgAElqIgBAAEF/Rw0AQQAPC0EAQQApA4gIIABBEHStfDcDiAhBACgCgAghAAsgAAvcDgECfiAAIAQpAwAiECAAKQMAIhF8IBFCAYZC/v///x+DIBBC/////w+DfnwiEDcDACAMIBAgDCkDAIVCIIkiEDcDACAIIBAgCCkDACIRfCARQgGGQv7///8fgyAQQv////8Pg358IhA3AwAgBCAQIAQpAwCFQiiJIhA3AwAgACAQIAApAwAiEXwgEEL/////D4MgEUIBhkL+////H4N+fCIQNwMAIAwgECAMKQMAhUIwiSIQNwMAIAggECAIKQMAIhF8IBBC/////w+DIBFCAYZC/v///x+DfnwiEDcDACAEIBAgBCkDAIVCAYk3AwAgASAFKQMAIhAgASkDACIRfCARQgGGQv7///8fgyAQQv////8Pg358IhA3AwAgDSAQIA0pAwCFQiCJIhA3AwAgCSAQIAkpAwAiEXwgEUIBhkL+////H4MgEEL/////D4N+fCIQNwMAIAUgECAFKQMAhUIoiSIQNwMAIAEgECABKQMAIhF8IBBC/////w+DIBFCAYZC/v///x+DfnwiEDcDACANIBAgDSkDAIVCMIkiEDcDACAJIBAgCSkDACIRfCAQQv////8PgyARQgGGQv7///8fg358IhA3AwAgBSAQIAUpAwCFQgGJNwMAIAIgBikDACIQIAIpAwAiEXwgEUIBhkL+////H4MgEEL/////D4N+fCIQNwMAIA4gECAOKQMAhUIgiSIQNwMAIAogECAKKQMAIhF8IBFCAYZC/v///x+DIBBC/////w+DfnwiEDcDACAGIBAgBikDAIVCKIkiEDcDACACIBAgAikDACIRfCAQQv////8PgyARQgGGQv7///8fg358IhA3AwAgDiAQIA4pAwCFQjCJIhA3AwAgCiAQIAopAwAiEXwgEEL/////D4MgEUIBhkL+////H4N+fCIQNwMAIAYgECAGKQMAhUIBiTcDACADIAcpAwAiECADKQMAIhF8IBFCAYZC/v///x+DIBBC/////w+DfnwiEDcDACAPIBAgDykDAIVCIIkiEDcDACALIBAgCykDACIRfCARQgGGQv7///8fgyAQQv////8Pg358IhA3AwAgByAQIAcpAwCFQiiJIhA3AwAgAyAQIAMpAwAiEXwgEEL/////D4MgEUIBhkL+////H4N+fCIQNwMAIA8gECAPKQMAhUIwiSIQNwMAIAsgECALKQMAIhF8IBBC/////w+DIBFCAYZC/v///x+DfnwiEDcDACAHIBAgBykDAIVCAYk3AwAgACAFKQMAIhAgACkDACIRfCARQgGGQv7///8fgyAQQv////8Pg358IhA3AwAgDyAQIA8pAwCFQiCJIhA3AwAgCiAQIAopAwAiEXwgEUIBhkL+////H4MgEEL/////D4N+fCIQNwMAIAUgECAFKQMAhUIoiSIQNwMAIAAgECAAKQMAIhF8IBBC/////w+DIBFCAYZC/v///x+DfnwiEDcDACAPIBAgDykDAIVCMIkiEDcDACAKIBAgCikDACIRfCAQQv////8PgyARQgGGQv7///8fg358IhA3AwAgBSAQIAUpAwCFQgGJNwMAIAEgBikDACIQIAEpAwAiEXwgEUIBhkL+////H4MgEEL/////D4N+fCIQNwMAIAwgECAMKQMAhUIgiSIQNwMAIAsgECALKQMAIhF8IBFCAYZC/v///x+DIBBC/////w+DfnwiEDcDACAGIBAgBikDAIVCKIkiEDcDACABIBAgASkDACIRfCAQQv////8PgyARQgGGQv7///8fg358IhA3AwAgDCAQIAwpAwCFQjCJIhA3AwAgCyAQIAspAwAiEXwgEEL/////D4MgEUIBhkL+////H4N+fCIQNwMAIAYgECAGKQMAhUIBiTcDACACIAcpAwAiECACKQMAIhF8IBFCAYZC/v///x+DIBBC/////w+DfnwiEDcDACANIBAgDSkDAIVCIIkiEDcDACAIIBAgCCkDACIRfCARQgGGQv7///8fgyAQQv////8Pg358IhA3AwAgByAQIAcpAwCFQiiJIhA3AwAgAiAQIAIpAwAiEXwgEEL/////D4MgEUIBhkL+////H4N+fCIQNwMAIA0gECANKQMAhUIwiSIQNwMAIAggECAIKQMAIhF8IBBC/////w+DIBFCAYZC/v///x+DfnwiEDcDACAHIBAgBykDAIVCAYk3AwAgAyAEKQMAIhAgAykDACIRfCARQgGGQv7///8fgyAQQv////8Pg358IhA3AwAgDiAQIA4pAwCFQiCJIhA3AwAgCSAQIAkpAwAiEXwgEUIBhkL+////H4MgEEL/////D4N+fCIQNwMAIAQgECAEKQMAhUIoiSIQNwMAIAMgECADKQMAIhF8IBBC/////w+DIBFCAYZC/v///x+DfnwiEDcDACAOIBAgDikDAIVCMIkiEDcDACAJIBAgCSkDACIRfCAQQv////8PgyARQgGGQv7///8fg358IhA3AwAgBCAQIAQpAwCFQgGJNwMAC98aAQN/QQAhBEEAIAIpAwAgASkDAIU3A5AIQQAgAikDCCABKQMIhTcDmAhBACACKQMQIAEpAxCFNwOgCEEAIAIpAxggASkDGIU3A6gIQQAgAikDICABKQMghTcDsAhBACACKQMoIAEpAyiFNwO4CEEAIAIpAzAgASkDMIU3A8AIQQAgAikDOCABKQM4hTcDyAhBACACKQNAIAEpA0CFNwPQCEEAIAIpA0ggASkDSIU3A9gIQQAgAikDUCABKQNQhTcD4AhBACACKQNYIAEpA1iFNwPoCEEAIAIpA2AgASkDYIU3A/AIQQAgAikDaCABKQNohTcD+AhBACACKQNwIAEpA3CFNwOACUEAIAIpA3ggASkDeIU3A4gJQQAgAikDgAEgASkDgAGFNwOQCUEAIAIpA4gBIAEpA4gBhTcDmAlBACACKQOQASABKQOQAYU3A6AJQQAgAikDmAEgASkDmAGFNwOoCUEAIAIpA6ABIAEpA6ABhTcDsAlBACACKQOoASABKQOoAYU3A7gJQQAgAikDsAEgASkDsAGFNwPACUEAIAIpA7gBIAEpA7gBhTcDyAlBACACKQPAASABKQPAAYU3A9AJQQAgAikDyAEgASkD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";
  var hash$k = "e4cdc523";
  var wasmJson$k = {
    name: name$k,
    data: data$k,
    hash: hash$k
  };
  var name$j = "blake2b";
  var data$j = "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";
  var hash$j = "c6f286e6";
  var wasmJson$j = {
    name: name$j,
    data: data$j,
    hash: hash$j
  };
  var mutex$k = new Mutex2();
  function validateBits$4(bits) {
    if (!Number.isInteger(bits) || bits < 8 || bits > 512 || bits % 8 !== 0) {
      return new Error("Invalid variant! Valid values: 8, 16, ..., 512");
    }
    return null;
  }
  function getInitParam$1(outputBits, keyBits) {
    return outputBits | keyBits << 16;
  }
  function createBLAKE2b(bits = 512, key = null) {
    if (validateBits$4(bits)) {
      return Promise.reject(validateBits$4(bits));
    }
    let keyBuffer = null;
    let initParam = bits;
    if (key !== null) {
      keyBuffer = getUInt8Buffer(key);
      if (keyBuffer.length > 64) {
        return Promise.reject(new Error("Max key length is 64 bytes"));
      }
      initParam = getInitParam$1(bits, keyBuffer.length);
    }
    const outputSize = bits / 8;
    return WASMInterface(wasmJson$j, outputSize).then((wasm) => {
      if (initParam > 512) {
        wasm.writeMemory(keyBuffer);
      }
      wasm.init(initParam);
      const obj = {
        init: initParam > 512 ? () => {
          wasm.writeMemory(keyBuffer);
          wasm.init(initParam);
          return obj;
        } : () => {
          wasm.init(initParam);
          return obj;
        },
        update: (data) => {
          wasm.update(data);
          return obj;
        },
        // biome-ignore lint/suspicious/noExplicitAny: Conflict with IHasher type
        digest: (outputType) => wasm.digest(outputType),
        save: () => wasm.save(),
        load: (data) => {
          wasm.load(data);
          return obj;
        },
        blockSize: 128,
        digestSize: outputSize
      };
      return obj;
    });
  }
  function encodeResult(salt, options, res) {
    const parameters = [
      `m=${options.memorySize}`,
      `t=${options.iterations}`,
      `p=${options.parallelism}`
    ].join(",");
    return `$argon2${options.hashType}$v=19$${parameters}$${encodeBase64(salt, false)}$${encodeBase64(res, false)}`;
  }
  var uint32View = new DataView(new ArrayBuffer(4));
  function int32LE(x) {
    uint32View.setInt32(0, x, true);
    return new Uint8Array(uint32View.buffer);
  }
  function hashFunc(blake512, buf, len) {
    return __awaiter(this, void 0, void 0, function* () {
      if (len <= 64) {
        const blake = yield createBLAKE2b(len * 8);
        blake.update(int32LE(len));
        blake.update(buf);
        return blake.digest("binary");
      }
      const r = Math.ceil(len / 32) - 2;
      const ret = new Uint8Array(len);
      blake512.init();
      blake512.update(int32LE(len));
      blake512.update(buf);
      let vp = blake512.digest("binary");
      ret.set(vp.subarray(0, 32), 0);
      for (let i = 1; i < r; i++) {
        blake512.init();
        blake512.update(vp);
        vp = blake512.digest("binary");
        ret.set(vp.subarray(0, 32), i * 32);
      }
      const partialBytesNeeded = len - 32 * r;
      let blakeSmall;
      if (partialBytesNeeded === 64) {
        blakeSmall = blake512;
        blakeSmall.init();
      } else {
        blakeSmall = yield createBLAKE2b(partialBytesNeeded * 8);
      }
      blakeSmall.update(vp);
      vp = blakeSmall.digest("binary");
      ret.set(vp.subarray(0, partialBytesNeeded), r * 32);
      return ret;
    });
  }
  function getHashType(type) {
    switch (type) {
      case "d":
        return 0;
      case "i":
        return 1;
      default:
        return 2;
    }
  }
  function argon2Internal(options) {
    return __awaiter(this, void 0, void 0, function* () {
      var _a2;
      const { parallelism, iterations, hashLength } = options;
      const password = getUInt8Buffer(options.password);
      const salt = getUInt8Buffer(options.salt);
      const version = 19;
      const hashType = getHashType(options.hashType);
      const { memorySize } = options;
      const secret = getUInt8Buffer((_a2 = options.secret) !== null && _a2 !== void 0 ? _a2 : "");
      const [argon2Interface, blake512] = yield Promise.all([
        WASMInterface(wasmJson$k, 1024),
        createBLAKE2b(512)
      ]);
      argon2Interface.setMemorySize(memorySize * 1024 + 1024);
      const initVector = new Uint8Array(24);
      const initVectorView = new DataView(initVector.buffer);
      initVectorView.setInt32(0, parallelism, true);
      initVectorView.setInt32(4, hashLength, true);
      initVectorView.setInt32(8, memorySize, true);
      initVectorView.setInt32(12, iterations, true);
      initVectorView.setInt32(16, version, true);
      initVectorView.setInt32(20, hashType, true);
      argon2Interface.writeMemory(initVector, memorySize * 1024);
      blake512.init();
      blake512.update(initVector);
      blake512.update(int32LE(password.length));
      blake512.update(password);
      blake512.update(int32LE(salt.length));
      blake512.update(salt);
      blake512.update(int32LE(secret.length));
      blake512.update(secret);
      blake512.update(int32LE(0));
      const segments = Math.floor(memorySize / (parallelism * 4));
      const lanes = segments * 4;
      const param = new Uint8Array(72);
      const H0 = blake512.digest("binary");
      param.set(H0);
      for (let lane = 0; lane < parallelism; lane++) {
        param.set(int32LE(0), 64);
        param.set(int32LE(lane), 68);
        let position = lane * lanes;
        let chunk = yield hashFunc(blake512, param, 1024);
        argon2Interface.writeMemory(chunk, position * 1024);
        position += 1;
        param.set(int32LE(1), 64);
        chunk = yield hashFunc(blake512, param, 1024);
        argon2Interface.writeMemory(chunk, position * 1024);
      }
      const C = new Uint8Array(1024);
      writeHexToUInt8(C, argon2Interface.calculate(new Uint8Array([]), memorySize));
      const res = yield hashFunc(blake512, C, hashLength);
      if (options.outputType === "hex") {
        const digestChars = new Uint8Array(hashLength * 2);
        return getDigestHex(digestChars, res, hashLength);
      }
      if (options.outputType === "encoded") {
        return encodeResult(salt, options, res);
      }
      return res;
    });
  }
  var validateOptions$3 = (options) => {
    var _a2;
    if (!options || typeof options !== "object") {
      throw new Error("Invalid options parameter. It requires an object.");
    }
    if (!options.password) {
      throw new Error("Password must be specified");
    }
    options.password = getUInt8Buffer(options.password);
    if (options.password.length < 1) {
      throw new Error("Password must be specified");
    }
    if (!options.salt) {
      throw new Error("Salt must be specified");
    }
    options.salt = getUInt8Buffer(options.salt);
    if (options.salt.length < 8) {
      throw new Error("Salt should be at least 8 bytes long");
    }
    options.secret = getUInt8Buffer((_a2 = options.secret) !== null && _a2 !== void 0 ? _a2 : "");
    if (!Number.isInteger(options.iterations) || options.iterations < 1) {
      throw new Error("Iterations should be a positive number");
    }
    if (!Number.isInteger(options.parallelism) || options.parallelism < 1) {
      throw new Error("Parallelism should be a positive number");
    }
    if (!Number.isInteger(options.hashLength) || options.hashLength < 4) {
      throw new Error("Hash length should be at least 4 bytes.");
    }
    if (!Number.isInteger(options.memorySize)) {
      throw new Error("Memory size should be specified.");
    }
    if (options.memorySize < 8 * options.parallelism) {
      throw new Error("Memory size should be at least 8 * parallelism.");
    }
    if (options.outputType === void 0) {
      options.outputType = "hex";
    }
    if (!["hex", "binary", "encoded"].includes(options.outputType)) {
      throw new Error(`Insupported output type ${options.outputType}. Valid values: ['hex', 'binary', 'encoded']`);
    }
  };
  function argon2id(options) {
    return __awaiter(this, void 0, void 0, function* () {
      validateOptions$3(options);
      return argon2Internal(Object.assign(Object.assign({}, options), { hashType: "id" }));
    });
  }
  var mutex$j = new Mutex2();
  var mutex$i = new Mutex2();
  var mutex$h = new Mutex2();
  var mutex$g = new Mutex2();
  var polyBuffer = new Uint8Array(8);
  var mutex$f = new Mutex2();
  var mutex$e = new Mutex2();
  var mutex$d = new Mutex2();
  var mutex$c = new Mutex2();
  var mutex$b = new Mutex2();
  var mutex$a = new Mutex2();
  var mutex$9 = new Mutex2();
  var mutex$8 = new Mutex2();
  var mutex$7 = new Mutex2();
  var mutex$6 = new Mutex2();
  var mutex$5 = new Mutex2();
  var seedBuffer$2 = new Uint8Array(8);
  var mutex$4 = new Mutex2();
  var seedBuffer$1 = new Uint8Array(8);
  var mutex$3 = new Mutex2();
  var seedBuffer = new Uint8Array(8);
  var mutex$2 = new Mutex2();
  var mutex$1 = new Mutex2();
  var mutex = new Mutex2();

  // client/e2ee/src/backup.ts
  var PASSWORD_KDF = { name: "argon2id", memory: 65536, iterations: 3, parallelism: 1 };
  var RECOVERY_KDF = { name: "hkdf-sha256" };
  var ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  var CODE_LENGTH = 32;
  var generateRecoveryCode = () => ([...randomBytes(CODE_LENGTH)].map((byte) => ALPHABET[byte & 31]).join("").match(/.{4}/g) ?? []).join("-");
  var normalizeRecoveryCode = (code) => code.toUpperCase().replace(/[^0-9A-Z]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  var derived = /* @__PURE__ */ new Map();
  var deriveBackupKey = (kdf, salt, input) => {
    const cacheKey = `${kdf.name}|${kdf.memory}|${kdf.iterations}|${salt}|${input}`;
    let pending = derived.get(cacheKey);
    if (!pending) {
      pending = kdf.name === "argon2id" ? argon2id({
        password: utf8(input),
        salt: fromB64u(salt),
        parallelism: kdf.parallelism ?? 1,
        iterations: kdf.iterations ?? 3,
        memorySize: kdf.memory ?? 65536,
        hashLength: 32,
        outputType: "binary"
      }).then((bytes) => new Uint8Array(bytes)) : hkdf(utf8(normalizeRecoveryCode(input)), fromB64u(salt), "fosscord-e2ee/v1/recovery-code");
      pending.catch(() => derived.delete(cacheKey));
      derived.clear();
      derived.set(cacheKey, pending);
    }
    return pending;
  };
  var secretAad = (userId) => `fosscord-e2ee/v1/backup-secret
${userId}`;
  var wrapSecret = async (userId, mode, input, secret) => {
    const kdf = mode === "password" ? PASSWORD_KDF : RECOVERY_KDF;
    const salt = toB64u(randomBytes(16));
    const key = await deriveBackupKey(kdf, salt, input);
    return { mode, kdf, salt, wrapped_secret: await sealBox(key, secret, secretAad(userId)) };
  };
  var unwrapSecret = async (userId, record, input) => {
    if (!record.wrapped_secret) throw new Error("backup has no wrapped secret");
    const key = await deriveBackupKey(record.kdf, record.salt, input);
    return openBox(key, record.wrapped_secret, secretAad(userId));
  };
  var secretKey = (secret, label) => hkdf(secret, new Uint8Array(32), `fosscord-e2ee/v1/backup/${label}`);
  var sealJwk = async (secret, label, userId, jwk) => sealBox(await secretKey(secret, label), utf8(JSON.stringify(jwk)), `${label}
${userId}`);
  var openJwk = async (secret, label, userId, box) => {
    const jwk = JSON.parse(fromUtf8(await openBox(await secretKey(secret, label), box, `${label}
${userId}`)));
    if (jwk.kty !== "OKP" || typeof jwk.x !== "string" || typeof jwk.d !== "string") throw new Error("bad key in backup");
    return jwk;
  };

  // client/e2ee/src/store.ts
  var database = null;
  var open = () => database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open("fosscord-e2ee", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("kv");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  var run = async (mode, action) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("kv", mode);
      const request = action(tx.objectStore("kv"));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  };
  var scoped = (userId) => {
    const key = (name) => `${userId}:${name}`;
    return {
      get: (name) => run("readonly", (s) => s.get(key(name))),
      set: (name, value) => run("readwrite", (s) => s.put(value, key(name))),
      del: (name) => run("readwrite", (s) => s.delete(key(name)))
    };
  };

  // client/e2ee/src/engine.ts
  var FALLBACK_CONTENT = "🔒 Encrypted message";
  var WRAP_INFO = "fosscord-e2ee/v1/wrap";
  var BACKUP_INFO = "fosscord-e2ee/v1/backup-wrap";
  var PREKEY_ROTATE_MS = 7 * 24 * 3600 * 1e3;
  var PREKEY_KEEP_MS = 30 * 24 * 3600 * 1e3;
  var DIRECTORY_TTL_MS = 5 * 60 * 1e3;
  var PASSWORD_TTL_MS = 10 * 60 * 1e3;
  var E2eeError = class extends Error {
    constructor(code, message, userId) {
      super(message);
      this.code = code;
      this.userId = userId;
    }
    code;
    userId;
  };
  var binding = (mid, nonce) => mid ? `m:${mid}` : `n:${nonce ?? ""}`;
  var messageAad = (channelId, senderId, senderDevice, bind) => `fosscord-e2ee/v1/msg
${channelId}
${senderId}
${senderDevice}
${bind}`;
  var storedKeyAad = (userId, messageId, sig) => `fosscord-e2ee/v1/backup-key
${userId}
${messageId}
${sig}`;
  var sameBytes = (a, b) => a.length === b.length && a.every((byte, i) => byte === b[i]);
  var sleep = (ms) => new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
  var signedPayload = (channelId, senderId, bind, env) => {
    const base = [
      "fosscord-e2ee/v1/sig",
      channelId,
      senderId,
      bind,
      env.v,
      env.alg,
      env.sender_device,
      env.mid ?? null,
      env.iv,
      env.ct,
      [...env.keys].sort((a, b) => a.device_id < b.device_id ? -1 : 1).map((k) => [k.user_id, k.device_id, k.prekey_id, k.enc, k.wrapped])
    ];
    if (env.backup) base.push([...env.backup].sort((a, b) => a.user_id < b.user_id ? -1 : 1).map((b) => [b.user_id, b.enc, b.wrapped]));
    return JSON.stringify(base);
  };
  var deviceName = () => {
    const ua = navigator.userAgent;
    const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "a browser";
    const os = /Windows/.test(ua) ? "Windows" : /Mac OS X|Macintosh/.test(ua) ? "macOS" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Linux/.test(ua) ? "Linux" : "";
    return os ? `${browser} on ${os}` : browser;
  };
  var Engine = class {
    constructor(api2) {
      this.api = api2;
    }
    api;
    userId = "";
    linked = false;
    deviceStatus = "unregistered";
    identity = null;
    trustedKey = null;
    serverKey = null;
    device = null;
    devices = [];
    prekeys = [];
    contacts = {};
    encryptedChannels = /* @__PURE__ */ new Set();
    backup = null;
    backupKeyPair = null;
    secret = null;
    password = null;
    store = null;
    queue = Promise.resolve();
    directory = /* @__PURE__ */ new Map();
    members = /* @__PURE__ */ new Map();
    profiles = /* @__PURE__ */ new Map();
    plaintext = /* @__PURE__ */ new Map();
    listeners = /* @__PURE__ */ new Set();
    unlockListeners = /* @__PURE__ */ new Set();
    uploads = /* @__PURE__ */ new Map();
    uploadTimer = null;
    lookups = /* @__PURE__ */ new Map();
    lookupTimer = null;
    storedKeys = /* @__PURE__ */ new Map();
    backfilling = false;
    onChange(listener) {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    }
    onUnlock(listener) {
      this.unlockListeners.add(listener);
      return () => this.unlockListeners.delete(listener);
    }
    emit() {
      this.listeners.forEach((listener) => listener());
    }
    get hasSecret() {
      return !!this.secret;
    }
    get locked() {
      return !!this.userId && !this.linked;
    }
    get backupNeedsPassword() {
      if (!this.linked || !this.identity || this.identity.publicKey !== this.serverKey) return false;
      const backup = this.backup?.identity_key === this.serverKey ? this.backup : null;
      if (!backup) return true;
      return backup.mode === "password" && !backup.wrapped_secret && !!this.secret;
    }
    async backUpWithPassword(password) {
      this.password = { value: password, at: Date.now() };
      await this.refresh();
      if (this.backupNeedsPassword) throw new E2eeError("BAD_SECRET", "Your keys couldn't be backed up. Try again in a moment.");
    }
    rememberPassword(value) {
      this.password = { value, at: Date.now() };
      if (this.userId) this.refresh().catch((error) => console.error("[e2ee] password refresh failed", error));
    }
    async passwordChanged(previous, next, api2 = this.api) {
      if (!this.userId) return this.rememberPassword(next);
      await this.serialized(async () => {
        const backup = this.backup = await this.fetchBackup(api2);
        if (!backup || backup.mode !== "password") return;
        let secret = this.secret;
        if (!secret && previous && backup.wrapped_secret) secret = await unwrapSecret(this.userId, backup, previous).catch(() => null);
        if (!secret) {
          this.password = { value: next, at: Date.now() };
          return;
        }
        this.backup = await api2.request("patch", "/users/@me/e2ee/backup", {
          version: backup.version,
          ...await wrapSecret(this.userId, "password", next, secret)
        });
        this.password = null;
      });
      this.emit();
    }
    async init(userId) {
      this.userId = userId;
      this.store = scoped(userId);
      this.contacts = await this.store.get("contacts") ?? {};
      await this.refresh();
    }
    serialized(task) {
      const run2 = this.queue.then(task);
      this.queue = run2.then(
        () => {
        },
        () => {
        }
      );
      return run2;
    }
    async refresh() {
      const wasLinked = this.linked;
      const hadBackupKey = !!this.backupKeyPair;
      await this.serialized(() => this.ensureKeys());
      this.emit();
      if (!wasLinked && this.linked || !hadBackupKey && this.backupKeyPair) this.unlockListeners.forEach((listener) => listener());
      if (this.linked && this.backupKeyPair) this.backfill().catch((error) => console.error("[e2ee] backfill failed", error));
    }
    async saveContacts() {
      await this.store.set("contacts", this.contacts);
    }
    async newPrekey(id) {
      const keyPair = await generateAgreementKey();
      const publicKey = await exportPublic(keyPair.publicKey);
      const signature = await sign(this.device.privateKey, prekeyMessage(this.device.deviceId, id, publicKey));
      return { id, publicKey, signature, keyPair, createdAt: Date.now(), retiredAt: null };
    }
    currentPrekey() {
      return this.prekeys.reduce((a, b) => b.id > a.id ? b : a);
    }
    async fetchBackup(api2 = this.api) {
      try {
        return await api2.request("get", "/users/@me/e2ee/backup");
      } catch (error) {
        if (error?.status === 404) return null;
        throw error;
      }
    }
    async adoptIdentity(jwk) {
      const identity = { publicKey: jwk.x, privateKey: await importSigningJwk(jwk) };
      await this.store.set("identity", identity);
      await this.trust(jwk.x);
      this.identity = identity;
      return identity;
    }
    async trust(key) {
      if (this.trustedKey === key) return;
      this.trustedKey = key;
      await this.store.set("trusted-identity", key);
    }
    async restoreFromSecret(secret, backup) {
      const identityJwk = await openJwk(secret, "identity", this.userId, backup.wrapped_identity);
      if (identityJwk.x !== backup.identity_key) throw new Error("backup identity doesn't match");
      const backupJwk = await openJwk(secret, "backup-key", this.userId, backup.wrapped_backup_key);
      if (backupJwk.x !== backup.backup_public_key) throw new Error("backup key doesn't match");
      await this.adoptIdentity(identityJwk);
      this.backupKeyPair = { publicKey: backupJwk.x, keyPair: await importAgreementJwk(backupJwk) };
      this.secret = secret;
      await this.store.set("backup-secret", secret);
      return identityJwk;
    }
    passwordValue() {
      if (this.password && Date.now() - this.password.at > PASSWORD_TTL_MS) this.password = null;
      return this.password?.value ?? null;
    }
    async createBackup(state, identityJwk) {
      if (!this.passwordValue()) return;
      const userId = this.userId;
      let identity = this.identity;
      if (!identityJwk) {
        identityJwk = await generateExportable("Ed25519");
        const next = { publicKey: identityJwk.x, privateKey: await importSigningJwk(identityJwk) };
        const devices = [];
        for (const d of state.devices) {
          if (d.status === "revoked" || !d.identity_signature) continue;
          if (!await verify(identity.publicKey, deviceMessage(userId, d.device_id, d.signing_key), d.identity_signature)) continue;
          devices.push({ device_id: d.device_id, identity_signature: await sign(next.privateKey, deviceMessage(userId, d.device_id, d.signing_key)) });
        }
        const previous_signature = await sign(identity.privateKey, rotationMessage(userId, identity.publicKey, next.publicKey));
        Object.assign(state, await this.api.request("put", "/users/@me/e2ee/identity", { public_key: next.publicKey, previous_signature, devices }));
        identity = await this.adoptIdentity(identityJwk);
        this.directory.delete(userId);
      }
      const password = this.passwordValue();
      if (!password) return;
      const secret = randomBytes(32);
      const backupJwk = await generateExportable("X25519");
      const secretFields = await wrapSecret(userId, "password", password, secret);
      this.backup = await this.api.request("put", "/users/@me/e2ee/backup", {
        version: this.backup?.version ?? 0,
        ...secretFields,
        identity_key: identity.publicKey,
        wrapped_identity: await sealJwk(secret, "identity", userId, identityJwk),
        backup_public_key: backupJwk.x,
        backup_key_signature: await sign(identity.privateKey, backupKeyMessage(userId, backupJwk.x)),
        wrapped_backup_key: await sealJwk(secret, "backup-key", userId, backupJwk)
      });
      this.password = null;
      this.secret = secret;
      await this.store.set("backup-secret", secret);
      this.backupKeyPair = { publicKey: backupJwk.x, keyPair: await importAgreementJwk(backupJwk) };
    }
    async syncPassword() {
      const password = this.passwordValue();
      const backup = this.backup;
      if (!password || !this.secret || !backup) return;
      if (backup.mode !== "password") {
        this.password = null;
        return;
      }
      const current = backup.wrapped_secret ? await unwrapSecret(this.userId, backup, password).catch(() => null) : null;
      if (!current || !sameBytes(current, this.secret))
        this.backup = await this.api.request("patch", "/users/@me/e2ee/backup", {
          version: backup.version,
          ...await wrapSecret(this.userId, "password", password, this.secret)
        });
      this.password = null;
    }
    async ensureKeys() {
      const store = this.store;
      const userId = this.userId;
      this.device = await store.get("device") ?? null;
      let state = await this.api.request("get", `/users/@me/e2ee${this.device ? `?device_id=${encodeURIComponent(this.device.deviceId)}` : ""}`);
      this.encryptedChannels = new Set(state.channels);
      this.identity = await store.get("identity") ?? null;
      this.trustedKey = await store.get("trusted-identity") ?? null;
      this.prekeys = await store.get("prekeys") ?? [];
      this.secret = await store.get("backup-secret") ?? null;
      this.backup = await this.fetchBackup();
      let identityJwk = null;
      if (!state.identity_key) {
        identityJwk = await generateExportable("Ed25519");
        await this.adoptIdentity(identityJwk);
        state = await this.api.request("put", "/users/@me/e2ee/identity", { public_key: identityJwk.x });
        this.secret = null;
        this.backupKeyPair = null;
      }
      const serverKey = state.identity_key;
      this.serverKey = serverKey;
      if (this.identity && this.identity.publicKey !== serverKey) {
        const previous = state.previous_identity;
        const rotated = previous?.public_key === this.identity.publicKey && await verify(previous.public_key, rotationMessage(userId, previous.public_key, serverKey), previous.signature);
        this.identity = null;
        await store.del("identity");
        if (rotated) await this.trust(serverKey);
      }
      if (this.identity) await this.trust(this.identity.publicKey);
      const backup = this.backup?.identity_key === serverKey ? this.backup : null;
      if (backup && this.secret && (!this.identity || !this.backupKeyPair || this.backupKeyPair.publicKey !== backup.backup_public_key)) {
        try {
          identityJwk = await this.restoreFromSecret(this.secret, backup);
        } catch (error) {
          console.error("[e2ee] stored backup secret doesn't open the backup", error);
          this.secret = null;
          this.backupKeyPair = null;
          await store.del("backup-secret");
        }
      }
      const password = this.passwordValue();
      if (backup && !this.secret && password && backup.mode === "password" && backup.wrapped_secret) {
        const secret = await unwrapSecret(userId, backup, password).catch(() => null);
        if (secret) identityJwk = await this.restoreFromSecret(secret, backup);
      }
      if (this.identity && !backup) {
        try {
          await this.createBackup(state, identityJwk);
        } catch (error) {
          console.error("[e2ee] couldn't create the key backup", error);
        }
      }
      await this.syncPassword().catch((error) => console.error("[e2ee] couldn't update the backup password", error));
      const trusted = this.trustedKey === state.identity_key ? this.trustedKey : null;
      let serverDevice = this.device ? state.devices.find((d) => d.device_id === this.device.deviceId) : void 0;
      if (!this.device || serverDevice?.status === "revoked") {
        const pair = await generateSigningKey();
        const signingKey = await exportPublic(pair.publicKey);
        this.device = { deviceId: await deviceIdFor(signingKey), signingKey, privateKey: pair.privateKey };
        this.prekeys = [];
        serverDevice = void 0;
        await store.set("device", this.device);
      }
      if (!this.prekeys.length) {
        this.prekeys = [await this.newPrekey(1)];
        await store.set("prekeys", this.prekeys);
      }
      let current = this.currentPrekey();
      if (serverDevice && Date.now() - current.createdAt > PREKEY_ROTATE_MS) {
        const next = await this.newPrekey(current.id + 1);
        current.retiredAt = Date.now();
        this.prekeys = [...this.prekeys.filter((p) => !p.retiredAt || Date.now() - p.retiredAt < PREKEY_KEEP_MS), next];
        await store.set("prekeys", this.prekeys);
        await this.api.request("put", `/users/@me/e2ee/devices/${this.device.deviceId}/prekey`, { id: next.id, public_key: next.publicKey, signature: next.signature });
        serverDevice.prekey = { id: next.id, public_key: next.publicKey, signature: next.signature };
        current = next;
      }
      const message = deviceMessage(userId, this.device.deviceId, this.device.signingKey);
      const signedBy = async (device) => !!trusted && device?.status === "active" && !!device.identity_signature && await verify(trusted, message, device.identity_signature);
      const canSign = !!this.identity && this.identity.publicKey === trusted;
      if (!serverDevice || serverDevice.prekey.id !== current.id || canSign && !await signedBy(serverDevice)) {
        serverDevice = await this.api.request("post", "/users/@me/e2ee/devices", {
          device_id: this.device.deviceId,
          signing_key: this.device.signingKey,
          identity_signature: canSign ? await sign(this.identity.privateKey, message) : void 0,
          name: deviceName(),
          prekey: { id: current.id, public_key: current.publicKey, signature: current.signature }
        });
        state.devices = [...state.devices.filter((d) => d.device_id !== serverDevice.device_id), serverDevice];
      }
      this.devices = state.devices;
      this.deviceStatus = serverDevice.status;
      this.linked = await signedBy(serverDevice);
      this.directory.delete(userId);
    }
    async unlockWith(kind, input) {
      const backup = this.backup = await this.fetchBackup();
      if (kind === "password" && (!backup || backup.mode === "password" && !backup.wrapped_secret))
        throw new E2eeError("BAD_SECRET", "Your keys aren't backed up with your password yet.");
      if (!backup?.wrapped_secret || backup.mode !== kind) throw new E2eeError("BAD_SECRET", "There's no backup to unlock with that");
      const secret = await unwrapSecret(this.userId, backup, input).catch(() => null);
      if (!secret) throw new E2eeError("BAD_SECRET", kind === "password" ? "That password didn't unlock your keys" : "That recovery code didn't work");
      await this.unlockWithSecret(secret);
    }
    async unlockWithSecret(secret) {
      await this.store.set("backup-secret", secret);
      this.secret = secret;
      await this.refresh();
      if (!this.linked) throw new E2eeError("BAD_SECRET", "That key didn't unlock this browser");
    }
    exportSecret() {
      return this.secret;
    }
    async useRecoveryCode() {
      const code = generateRecoveryCode();
      await this.setBackupMode("recovery", code);
      return code;
    }
    async setBackupMode(mode, input) {
      if (!this.secret) throw new E2eeError("LOCKED", "Unlock this browser first");
      await this.serialized(async () => {
        const backup = this.backup = await this.fetchBackup();
        if (!backup) throw new E2eeError("LOCKED", "There's no backup yet");
        this.backup = await this.api.request("patch", "/users/@me/e2ee/backup", {
          version: backup.version,
          ...await wrapSecret(this.userId, mode, input, this.secret)
        });
      });
      this.emit();
    }
    async removeDevice(deviceId) {
      await this.api.request("del", `/users/@me/e2ee/devices/${deviceId}`);
      this.devices = this.devices.filter((d) => d.device_id !== deviceId);
      this.directory.delete(this.userId);
      this.emit();
    }
    async reloadBackup() {
      this.backup = await this.fetchBackup();
      this.emit();
      return this.backup;
    }
    invalidateUser(userId) {
      this.directory.delete(userId);
    }
    invalidateChannel(channelId) {
      this.members.delete(channelId);
    }
    invalidateAll() {
      this.directory.clear();
      this.members.clear();
    }
    setChannelEncrypted(channelId) {
      this.encryptedChannels.add(channelId);
      this.emit();
    }
    isEncrypted(channelId) {
      return this.encryptedChannels.has(channelId);
    }
    channelMembers(channelId) {
      let pending = this.members.get(channelId);
      if (!pending) {
        pending = this.api.request("post", "/e2ee/keys/query", { channel_id: channelId }).then((res) => {
          const ids = res.channel_members ?? [];
          for (const id of ids) {
            const entry = this.verifyEntry(id, res.users[id] ?? { identity_key: null, devices: [] });
            entry.catch(() => this.directory.delete(id));
            this.directory.set(id, entry);
          }
          return ids.filter((id) => id !== this.userId);
        });
        pending.catch(() => this.members.delete(channelId));
        this.members.set(channelId, pending);
      }
      return pending;
    }
    profile(userId) {
      let pending = this.profiles.get(userId);
      if (!pending) {
        pending = this.api.request("get", `/users/${userId}`).catch(() => ({ id: userId, username: userId }));
        this.profiles.set(userId, pending);
      }
      return pending;
    }
    async keysFor(userIds, force = false) {
      const missing = [...new Set(userIds)].filter((id) => force || !this.directory.has(id));
      if (missing.length) {
        const batch = this.api.request("post", "/e2ee/keys/query", { user_ids: missing });
        for (const id of missing) {
          const entry = batch.then((res) => this.verifyEntry(id, res.users[id] ?? { identity_key: null, devices: [] }));
          entry.catch(() => this.directory.delete(id));
          this.directory.set(id, entry);
        }
      }
      const entries = await Promise.all(userIds.map((id) => this.directory.get(id)));
      const stale = entries.filter((e) => Date.now() - e.fetchedAt > DIRECTORY_TTL_MS).map((e) => e.userId);
      return stale.length && !force ? this.keysFor(userIds, true) : entries;
    }
    async verifyEntry(userId, keys) {
      const identityKey = keys.identity_key;
      let identityChanged = false;
      if (identityKey && userId === this.userId) identityChanged = identityKey !== this.trustedKey;
      else if (identityKey) {
        const contact = this.contacts[userId];
        const previous = keys.previous_identity;
        if (!contact) {
          this.contacts[userId] = { identityKey, verified: false, pendingKey: null, firstSeen: Date.now() };
          await this.saveContacts();
        } else if (contact.identityKey !== identityKey && previous?.public_key === contact.identityKey && await verify(previous.public_key, rotationMessage(userId, previous.public_key, identityKey), previous.signature)) {
          contact.identityKey = identityKey;
          contact.pendingKey = null;
          await this.saveContacts();
        } else if (contact.identityKey !== identityKey) {
          if (contact.pendingKey !== identityKey) {
            contact.pendingKey = identityKey;
            contact.verified = false;
            await this.saveContacts();
            queueMicrotask(() => this.emit());
          }
          identityChanged = true;
        }
      }
      const devices = [];
      let backupKey = null;
      if (identityKey) {
        for (const device of keys.devices) {
          if (!device.identity_signature) continue;
          if (await deviceIdFor(device.signing_key) !== device.device_id) continue;
          if (!await verify(identityKey, deviceMessage(userId, device.device_id, device.signing_key), device.identity_signature)) continue;
          if (!await verify(device.signing_key, prekeyMessage(device.device_id, device.prekey.id, device.prekey.public_key), device.prekey.signature)) continue;
          devices.push({
            deviceId: device.device_id,
            signingKey: device.signing_key,
            status: device.status,
            name: device.name,
            prekeyId: device.prekey.id,
            prekeyPublic: device.prekey.public_key
          });
        }
        const backup = keys.backup_key;
        if (backup && await verify(identityKey, backupKeyMessage(userId, backup.public_key), backup.signature)) backupKey = backup.public_key;
      }
      return { userId, identityKey, identityChanged, backupKey, devices, fetchedAt: Date.now() };
    }
    async acceptIdentity(userId) {
      const contact = this.contacts[userId];
      if (!contact?.pendingKey) return;
      contact.identityKey = contact.pendingKey;
      contact.pendingKey = null;
      contact.verified = false;
      await this.saveContacts();
      this.directory.delete(userId);
      this.emit();
    }
    async setVerified(userId, verified) {
      const contact = this.contacts[userId];
      if (!contact) return;
      contact.verified = verified;
      await this.saveContacts();
      this.emit();
    }
    async encrypt(channelId, content, opts) {
      if (!this.device || !this.userId) throw new E2eeError("NOT_READY", "Encryption is still starting up");
      if (!this.linked) throw new E2eeError("NOT_LINKED", "This browser isn't unlocked for encrypted messages yet");
      const members = [this.userId, ...await this.channelMembers(channelId)];
      const entries = await this.keysFor(members);
      const targets2 = [];
      for (const entry of entries) {
        if (entry.identityChanged) throw new E2eeError("IDENTITY_CHANGED", "A safety number changed", entry.userId);
        const active = entry.devices.filter((d) => d.status === "active");
        if (!active.length) throw new E2eeError("NO_DEVICES", "A member has no encryption keys yet", entry.userId);
        active.forEach((device) => targets2.push({ userId: entry.userId, device }));
      }
      if (!targets2.some((t) => t.device.deviceId === this.device.deviceId)) {
        const current = this.currentPrekey();
        targets2.push({
          userId: this.userId,
          device: { deviceId: this.device.deviceId, signingKey: this.device.signingKey, status: "active", name: null, prekeyId: current.id, prekeyPublic: current.publicKey }
        });
      }
      const bind = binding(opts.mid, opts.nonce);
      const aad = messageAad(channelId, this.userId, this.device.deviceId, bind);
      const contentKey = randomBytes(32);
      const iv = randomBytes(12);
      const ct = await aesEncrypt(contentKey, iv, utf8(JSON.stringify({ content })), aad);
      const keys = await Promise.all(
        targets2.map(async ({ userId, device }) => ({
          user_id: userId,
          device_id: device.deviceId,
          prekey_id: device.prekeyId,
          ...await hpkeSeal(device.prekeyPublic, contentKey, WRAP_INFO, `${aad}
${device.deviceId}`)
        }))
      );
      const backup = await Promise.all(
        entries.filter((e) => e.backupKey).map(async (e) => ({ user_id: e.userId, ...await hpkeSeal(e.backupKey, contentKey, BACKUP_INFO, `${aad}
backup:${e.userId}`) }))
      );
      const unsigned = {
        v: 1,
        alg: ALGORITHM,
        sender_device: this.device.deviceId,
        ...opts.mid ? { mid: opts.mid } : {},
        iv: toB64u(iv),
        ct: toB64u(ct),
        keys,
        ...backup.length ? { backup } : {}
      };
      const sig = await sign(this.device.privateKey, signedPayload(channelId, this.userId, bind, unsigned));
      const envelope = { ...unsigned, sig };
      this.plaintext.set(`${opts.mid ?? ""}:${sig}`, content);
      return envelope;
    }
    cached(message) {
      const env = message.encrypted;
      return env ? this.plaintext.get(`${message.id}:${env.sig}`) ?? this.plaintext.get(`${env.mid ?? ""}:${env.sig}`) : void 0;
    }
    async decrypt(message, remember = true) {
      const env = message.encrypted;
      if (!env || env.v !== 1 || env.alg !== ALGORITHM || !Array.isArray(env.keys)) throw new E2eeError("BAD_ENVELOPE", "Unsupported envelope");
      const hit = this.cached(message);
      if (hit !== void 0) {
        this.plaintext.set(`${message.id}:${env.sig}`, hit);
        return hit;
      }
      if (!this.device) throw new E2eeError("NOT_READY", "Encryption is still starting up");
      const senderId = message.author?.id;
      if (!senderId) throw new E2eeError("BAD_ENVELOPE", "Missing author");
      if (env.mid && env.mid !== message.id) throw new E2eeError("BAD_ENVELOPE", "Envelope belongs to another message");
      const nonce = message.nonce == null ? void 0 : String(message.nonce);
      if (!env.mid && !nonce) throw new E2eeError("BAD_ENVELOPE", "Missing nonce");
      let [entry] = await this.keysFor([senderId]);
      let sender = entry.devices.find((d) => d.deviceId === env.sender_device);
      if (!sender) {
        [entry] = await this.keysFor([senderId], true);
        sender = entry.devices.find((d) => d.deviceId === env.sender_device);
      }
      if (!sender) throw new E2eeError("BAD_SIGNATURE", "Unknown sender device");
      const bind = binding(env.mid, nonce);
      const { sig, ...unsigned } = env;
      if (!await verify(sender.signingKey, signedPayload(message.channel_id, senderId, bind, unsigned), sig)) throw new E2eeError("BAD_SIGNATURE", "Signature check failed");
      const aad = messageAad(message.channel_id, senderId, env.sender_device, bind);
      const mine = env.keys.find((k) => k.device_id === this.device.deviceId);
      const prekey = mine && this.prekeys.find((p) => p.id === mine.prekey_id);
      let contentKey = null;
      if (mine && prekey) contentKey = await hpkeOpen(prekey.keyPair, mine.enc, mine.wrapped, WRAP_INFO, `${aad}
${mine.device_id}`);
      const backupEntry = env.backup?.find((b) => b.user_id === this.userId);
      const backupKey = this.backupKeyPair;
      if (!contentKey && backupEntry && backupKey)
        contentKey = await hpkeOpen(backupKey.keyPair, backupEntry.enc, backupEntry.wrapped, BACKUP_INFO, `${aad}
backup:${this.userId}`).catch(() => null);
      if (!contentKey && backupKey) {
        const stored = await this.lookupStoredKey(message.id);
        if (stored) contentKey = await hpkeOpen(backupKey.keyPair, stored.enc, stored.wrapped, BACKUP_INFO, storedKeyAad(this.userId, message.id, sig)).catch(() => null);
      }
      if (!contentKey) {
        if (!this.linked || !backupKey) throw new E2eeError("LOCKED", "This browser isn't unlocked yet");
        throw new E2eeError("NO_KEY", "Sent before this browser was set up");
      }
      const payload = JSON.parse(fromUtf8(await aesDecrypt(contentKey, fromB64u(env.iv), fromB64u(env.ct), aad)));
      const content = typeof payload.content === "string" ? payload.content : "";
      if (mine && prekey && backupKey) {
        const covered = !!backupEntry && !!await hpkeOpen(backupKey.keyPair, backupEntry.enc, backupEntry.wrapped, BACKUP_INFO, `${aad}
backup:${this.userId}`).catch(() => null);
        if (!covered) await this.queueBackup(message.id, sig, contentKey);
      }
      if (remember) this.plaintext.set(`${message.id}:${env.sig}`, content);
      return content;
    }
    lookupStoredKey(messageId) {
      const known = this.storedKeys.get(messageId);
      if (known) return Promise.resolve(known);
      const existing = this.lookups.get(messageId);
      if (existing) return existing.promise;
      let resolve = () => {
      };
      const promise = new Promise((r) => {
        resolve = r;
      });
      this.lookups.set(messageId, { promise, resolve });
      this.lookupTimer ??= setTimeout(() => this.flushLookups(), 25);
      return promise;
    }
    async flushLookups() {
      this.lookupTimer = null;
      const batch = [...this.lookups.entries()].slice(0, 100);
      batch.forEach(([id]) => this.lookups.delete(id));
      if (this.lookups.size) this.lookupTimer = setTimeout(() => this.flushLookups(), 0);
      try {
        const res = await this.api.request("post", "/users/@me/e2ee/backup/keys/query", {
          message_ids: batch.map(([id]) => id)
        });
        for (const key of res.keys) this.storedKeys.set(key.message_id, { user_id: this.userId, enc: key.enc, wrapped: key.wrapped });
      } catch (error) {
        console.error("[e2ee] backup key lookup failed", error);
      }
      batch.forEach(([id, { resolve }]) => resolve(this.storedKeys.get(id) ?? null));
    }
    async queueBackup(messageId, sig, contentKey) {
      const marker = `bk:${messageId}`;
      if (this.uploads.has(messageId) || await this.store.get(marker) === sig || !this.backupKeyPair) return;
      const sealed = await hpkeSeal(this.backupKeyPair.publicKey, contentKey, BACKUP_INFO, storedKeyAad(this.userId, messageId, sig));
      this.uploads.set(messageId, { message_id: messageId, ...sealed, sig });
      this.uploadTimer ??= setTimeout(() => this.flushBackups(), 1e3);
    }
    async flushBackups() {
      if (this.uploadTimer) clearTimeout(this.uploadTimer);
      this.uploadTimer = null;
      while (this.uploads.size) {
        const batch = [...this.uploads.values()].slice(0, 100);
        batch.forEach((entry) => this.uploads.delete(entry.message_id));
        try {
          await this.api.request("post", "/users/@me/e2ee/backup/keys", { keys: batch.map(({ message_id, enc, wrapped }) => ({ message_id, enc, wrapped })) });
          await Promise.all(batch.map((entry) => this.store.set(`bk:${entry.message_id}`, entry.sig)));
        } catch (error) {
          console.error("[e2ee] backup upload failed", error);
          return;
        }
      }
    }
    async backfill() {
      const key = this.backupKeyPair?.publicKey;
      if (!key || this.backfilling) return;
      const marker = `backfill:${key}`;
      if (await this.store.get(marker)) return;
      this.backfilling = true;
      try {
        for (const channelId of [...this.encryptedChannels]) {
          let before = "";
          for (let page = 0; page < 50; page++) {
            const batch = await this.api.request("get", `/channels/${channelId}/messages?limit=100${before && `&before=${before}`}`);
            for (const message of batch) if (message.encrypted) await this.decrypt(message, false).catch(() => {
            });
            await this.flushBackups();
            if (batch.length < 100) break;
            before = batch[batch.length - 1].id;
            await sleep(250);
          }
        }
        await this.store.set(marker, true);
      } finally {
        this.backfilling = false;
      }
    }
    async safetyNumber(userId) {
      const [entry] = await this.keysFor([userId]);
      const theirs = this.contacts[userId]?.pendingKey ?? entry.identityKey;
      const mine = this.trustedKey;
      if (!theirs || !mine) return null;
      const part = async (id, key) => {
        let digest = new Uint8Array(await crypto.subtle.digest("SHA-512", new Uint8Array([0, 0, ...fromB64u(key), ...utf8(id)])));
        for (let i = 0; i < 5200; i++) digest = new Uint8Array(await crypto.subtle.digest("SHA-512", new Uint8Array([...digest, ...fromB64u(key)])));
        let out = "";
        for (let i = 0; i < 30; i += 5) {
          const chunk = digest.subarray(i, i + 5).reduce((acc, byte) => acc * 256 + byte, 0);
          out += String(chunk % 1e5).padStart(5, "0");
        }
        return out;
      };
      const [own, other] = await Promise.all([part(this.userId, mine), part(userId, theirs)]);
      return own < other ? own + other : other + own;
    }
  };

  // client/e2ee/src/hooks.ts
  var DECRYPTING_CONTENT = "Decrypting…";
  var MISSING_CONTENT = "Sent before this browser was set up";
  var AUTH_URL = /^\/auth\/(login|register)$/;
  var MESSAGE_URL = /^\/channels\/(\d+)\/messages(?:\/(\d+))?$/;
  var isEncryptedMessage = (value) => {
    const message = value;
    return !!message && typeof message === "object" && !!message.encrypted && typeof message.id === "string" && typeof message.channel_id === "string";
  };
  var collect = (value, out, depth = 0) => {
    if (!value || typeof value !== "object" || depth > 6) return out;
    if (Array.isArray(value)) {
      value.forEach((item) => collect(item, out, depth + 1));
      return out;
    }
    if (isEncryptedMessage(value)) out.push(value);
    for (const key of Object.keys(value)) {
      const child = value[key];
      if (child && typeof child === "object" && key !== "encrypted") collect(child, out, depth + 1);
    }
    return out;
  };
  var createHooks = (ctx) => {
    const { engine: engine2, states: states2 } = ctx;
    const inflight = /* @__PURE__ */ new Map();
    const retry = /* @__PURE__ */ new Map();
    let dispatcher = null;
    const clone = (message) => JSON.parse(JSON.stringify(message));
    const decryptOne = (message) => {
      const key = `${message.id}:${message.encrypted?.sig}`;
      const sync = engine2.cached(message);
      if (sync !== void 0) {
        message.content = sync;
        states2.set(message.id, { state: "decrypted" });
        retry.delete(message.id);
        return Promise.resolve();
      }
      if (!ctx.isReady()) {
        if (ctx.failClosed()) {
          states2.set(message.id, { state: "failed", reason: "Encryption is unavailable in this client build" });
          message.content = FALLBACK_CONTENT;
        } else {
          retry.set(message.id, clone(message));
          states2.set(message.id, { state: "pending" });
          message.content = DECRYPTING_CONTENT;
        }
        return Promise.resolve();
      }
      let pending = inflight.get(key);
      if (!pending) {
        const original = clone(message);
        pending = (async () => {
          try {
            const content = await engine2.decrypt(message);
            states2.set(message.id, { state: "decrypted" });
            retry.delete(message.id);
            message.content = content;
          } catch (error) {
            const code = error instanceof E2eeError ? error.code : null;
            if (code === "LOCKED" || code === "NO_KEY") {
              states2.set(message.id, { state: "missing", reason: error instanceof Error ? error.message : String(error) });
              retry.set(message.id, original);
              message.content = MISSING_CONTENT;
            } else {
              states2.set(message.id, { state: "failed", reason: error instanceof Error ? error.message : String(error) });
              message.content = FALLBACK_CONTENT;
            }
          }
        })().finally(() => inflight.delete(key));
        inflight.set(key, pending);
        return pending.then(() => ctx.onState());
      }
      return pending.then(() => {
        const again = engine2.cached(message);
        const state = states2.get(message.id)?.state;
        message.content = again ?? (state === "missing" ? MISSING_CONTENT : state === "failed" ? FALLBACK_CONTENT : message.content);
        ctx.onState();
      });
    };
    const retryAll = () => {
      if (!ctx.isReady()) return;
      const queued = [...retry.values()];
      retry.clear();
      for (const copy of queued) {
        const before = states2.get(copy.id)?.state;
        decryptOne(copy).then(() => {
          const after = states2.get(copy.id)?.state;
          if (after === before && after !== "pending") return;
          dispatcher?.dispatch({ type: "MESSAGE_UPDATE", message: copy, e2eeLocal: true });
          ctx.onState();
        });
      }
    };
    const decryptAll = async (value) => {
      const messages = collect(value, []);
      if (messages.length) await Promise.all(messages.map(decryptOne));
    };
    const encryptBody = async (method, opts) => {
      const match = MESSAGE_URL.exec(opts.url.split("?")[0]);
      if (!match || method !== "post" && method !== "patch") return opts;
      const [, channelId, messageId] = match;
      if (method === "post" && messageId) return opts;
      if (!engine2.isEncrypted(channelId)) return opts;
      if (ctx.failClosed()) throw new E2eeError("NOT_READY", "Encryption is unavailable in this client build");
      if (!await ctx.ready) throw new E2eeError("NOT_READY", "Encryption is unavailable in this client build");
      const body = { ...opts.body ?? {} };
      if (method === "patch" && body.content === void 0) return opts;
      if (opts.attachments?.length || body.attachments?.length || body.sticker_ids?.length || body.poll)
        throw new E2eeError("UNSUPPORTED", "Attachments, stickers and polls can't be sent in encrypted conversations yet");
      const nonce = method === "post" ? String(body.nonce ?? `${Date.now()}${Math.floor(Math.random() * 1e3)}`) : void 0;
      if (nonce) body.nonce = nonce;
      body.encrypted = await engine2.encrypt(channelId, String(body.content ?? ""), { nonce, mid: method === "patch" ? messageId : void 0 });
      body.content = FALLBACK_CONTENT;
      return { ...opts, body };
    };
    const wrapHttp = (http2) => {
      const originals = { ...http2 };
      for (const method of ["get", "post", "put", "patch", "del"]) {
        const original = originals[method];
        const wrapped = (input, callback) => {
          const opts = typeof input === "string" ? { url: input, rejectWithError: false } : input;
          const url = typeof opts?.url === "string" ? opts.url : "";
          const path = url.split("?")[0];
          if (method === "post" && AUTH_URL.test(path) || method === "patch" && path === "/users/@me") {
            const body = opts.body ?? {};
            const result = original(input, callback);
            result.then(
              (res) => res?.ok && ctx.onCredentials(path, body, res.body),
              () => {
              }
            );
            return result;
          }
          const relevant = url.startsWith("/channels/") || url.startsWith("/users/@me/mentions") || url.includes("/messages");
          if (!relevant) return original(input, callback);
          return (async () => {
            let prepared;
            try {
              prepared = await encryptBody(method, opts);
            } catch (error) {
              const match = MESSAGE_URL.exec(url.split("?")[0]);
              ctx.onError(error, match?.[1] ?? "");
              callback?.({ ok: false, hasErr: true, err: error, status: 0, body: null });
              throw error;
            }
            for (let attempt = 0; ; attempt++) {
              let response;
              try {
                const result = await original(prepared, (res) => response = res);
                await decryptAll(result?.body);
                callback?.(response ?? { ...result, hasErr: false });
                return result;
              } catch (error) {
                const failure2 = error;
                if (attempt === 0 && failure2?.status === 409 && failure2.body?.message === "E2EE_DEVICE_MISMATCH" && prepared !== opts) {
                  const match = MESSAGE_URL.exec(url.split("?")[0]);
                  engine2.invalidateChannel(match[1]);
                  engine2.invalidateAll();
                  prepared = await encryptBody(method, opts);
                  continue;
                }
                if (response) callback?.(response);
                throw error;
              }
            }
          })();
        };
        http2[method] = wrapped;
      }
      return originals;
    };
    const wrapGateway = (store, custom2) => {
      const socketDispatcher = store.getSocket().dispatcher;
      let current = socketDispatcher.getDispatchHandler;
      const cache = /* @__PURE__ */ new Map();
      const wrap = (type) => {
        const base = current?.(type);
        const hit = cache.get(type);
        if (hit && hit.base === base) return hit.wrapped;
        let wrapped = base;
        if (custom2[type]) wrapped = { preload: () => null, dispatch: (data) => custom2[type](data) };
        else if (base && (type === "MESSAGE_CREATE" || type === "MESSAGE_UPDATE")) {
          wrapped = {
            ...base,
            preload: (data) => {
              const own = base.preload(data);
              if (!collect(data, []).length) return own;
              return Promise.all([own, decryptAll(data)]).then(([result]) => result);
            },
            dispatch: (...args) => base.dispatch(...args)
          };
        }
        cache.set(type, { base, wrapped });
        return wrapped;
      };
      Object.defineProperty(socketDispatcher, "getDispatchHandler", {
        configurable: true,
        get: () => current ? wrap : null,
        set: (value) => {
          current = value;
          cache.clear();
        }
      });
    };
    const watchDispatcher = (target) => {
      dispatcher = target;
      target.addInterceptor((action) => {
        if (action.e2eeLocal || !/MESSAGE|SEARCH|PIN|MENTION|THREAD/.test(action.type)) return false;
        const messages = collect(action, []).filter((m) => m.content === FALLBACK_CONTENT && !states2.has(m.id));
        for (const message of messages) {
          const hit = engine2.cached(message);
          if (hit !== void 0) {
            message.content = hit;
            states2.set(message.id, { state: "decrypted" });
            continue;
          }
          const copy = clone(message);
          message.content = DECRYPTING_CONTENT;
          decryptOne(copy).then(() => {
            if (states2.get(copy.id)?.state === "pending") return;
            target.dispatch({ type: "MESSAGE_UPDATE", message: copy, e2eeLocal: true });
          });
        }
        return false;
      });
    };
    return { wrapHttp, wrapGateway, watchDispatcher, decryptAll, retryAll };
  };

  // client/e2ee/src/link.ts
  var sasFor = async (requestId, requester, approver) => {
    const digest = await sha256(utf8(`fosscord-e2ee/v1/sas
${requestId}
${requester}
${approver}`));
    const value = (digest[0] << 24 | digest[1] << 16 | digest[2] << 8 | digest[3]) >>> 0;
    const digits = String(value % 1e6).padStart(6, "0");
    return `${digits.slice(0, 3)} ${digits.slice(3)}`;
  };
  var channelKey = async (pair, peer, requestId) => hkdf(await x25519(pair.privateKey, peer), utf8(requestId), "fosscord-e2ee/v1/link");
  var channelAad = (requestId, requester, approver) => `fosscord-e2ee/v1/link
${requestId}
${requester}
${approver}`;
  var createLink = (engine2, api2, hooks2) => {
    let outgoing = null;
    const incoming = /* @__PURE__ */ new Map();
    const post = (body) => api2.request("post", "/users/@me/e2ee/link", { ...body, device_id: engine2.device.deviceId });
    const request = async () => {
      if (!engine2.device || engine2.linked) return;
      const pair = await generateAgreementKey();
      const publicKey = await exportPublic(pair.publicKey);
      const current = {
        requestId: toB64u(randomBytes(16)),
        state: "waiting",
        sas: null,
        approverName: null,
        pair,
        publicKey,
        approver: null,
        approverKey: null
      };
      outgoing = current;
      hooks2.onChange();
      const body = { request_id: current.requestId, stage: "request", name: deviceName(), commit: toB64u(await sha256(fromB64u(publicKey))) };
      await post(body);
      let attempts = 0;
      const timer = setInterval(() => {
        if (outgoing !== current || current.state !== "waiting" || engine2.linked || ++attempts > 30) return clearInterval(timer);
        post(body).catch(() => {
        });
      }, 1e4);
    };
    const cancel = async () => {
      const current = outgoing;
      outgoing = null;
      hooks2.onChange();
      if (current && current.state !== "done") await post({ request_id: current.requestId, stage: "cancel" }).catch(() => {
      });
    };
    const onRequest = async (event) => {
      if (!engine2.device || event.device_id === engine2.device.deviceId || !engine2.linked || !engine2.exportSecret() || !event.commit) return;
      if (incoming.has(event.request_id) || incoming.size > 8) return;
      const pair = await generateAgreementKey();
      const publicKey = await exportPublic(pair.publicKey);
      incoming.set(event.request_id, { deviceId: event.device_id, name: event.name ?? "a new browser", commit: event.commit, pair, publicKey });
      setTimeout(() => incoming.delete(event.request_id), 10 * 60 * 1e3);
      await post({ request_id: event.request_id, stage: "offer", to_device: event.device_id, public_key: publicKey });
    };
    const onResponse = async (event) => {
      const mine = engine2.device?.deviceId;
      if (event.stage === "cancel") {
        if (incoming.delete(event.request_id)) hooks2.onDismiss(event.request_id);
        return;
      }
      if (!mine || event.to_device !== mine) return;
      const current = outgoing?.requestId === event.request_id ? outgoing : null;
      if (event.stage === "offer" && current && !current.approver && event.public_key) {
        current.approver = event.device_id;
        current.approverKey = event.public_key;
        current.approverName = engine2.devices.find((d) => d.device_id === event.device_id)?.name ?? null;
        current.sas = await sasFor(current.requestId, current.publicKey, event.public_key);
        current.state = "comparing";
        hooks2.onChange();
        await post({ request_id: current.requestId, stage: "reveal", to_device: event.device_id, public_key: current.publicKey });
        return;
      }
      if (event.stage === "reveal" && event.public_key) {
        const pending = incoming.get(event.request_id);
        if (!pending || pending.deviceId !== event.device_id) return;
        if (toB64u(await sha256(fromB64u(event.public_key))) !== pending.commit) {
          incoming.delete(event.request_id);
          return;
        }
        const requester = event.public_key;
        const sas = await sasFor(event.request_id, requester, pending.publicKey);
        const respond = async (stage) => {
          if (!incoming.delete(event.request_id)) return;
          if (stage === "deny") return void await post({ request_id: event.request_id, stage, to_device: pending.deviceId });
          const secret = engine2.exportSecret();
          if (!secret) throw new Error("This browser can't approve logins");
          const key = await channelKey(pending.pair, requester, event.request_id);
          const iv = randomBytes(12);
          const ct = await aesEncrypt(key, iv, secret, channelAad(event.request_id, requester, pending.publicKey));
          await post({ request_id: event.request_id, stage, to_device: pending.deviceId, iv: toB64u(iv), ct: toB64u(ct) });
        };
        hooks2.onPrompt({ requestId: event.request_id, name: pending.name, sas, approve: () => respond("approve"), deny: () => respond("deny") });
        return;
      }
      if (!current || event.device_id !== current.approver) return;
      if (event.stage === "deny") {
        current.state = "denied";
        hooks2.onChange();
        return;
      }
      if (event.stage === "approve" && event.iv && event.ct && current.approverKey) {
        try {
          const key = await channelKey(current.pair, current.approverKey, current.requestId);
          const secret = await aesDecrypt(key, fromB64u(event.iv), fromB64u(event.ct), channelAad(current.requestId, current.publicKey, current.approverKey));
          await engine2.unlockWithSecret(secret);
          current.state = "done";
        } catch (error) {
          console.error("[e2ee] approval didn't unlock this browser", error);
          current.state = "failed";
        }
        hooks2.onChange();
      }
    };
    return {
      request,
      cancel,
      onEvent: (type, event) => (type === "E2EE_LINK_REQUEST" ? onRequest(event) : onResponse(event)).catch((error) => console.error("[e2ee] link", error)),
      outgoing: () => outgoing ? { requestId: outgoing.requestId, state: outgoing.state, sas: outgoing.sas, approverName: outgoing.approverName } : null
    };
  };

  // client/e2ee/src/ui.ts
  var LOCK_PATH = "M7 10V7a5 5 0 0 1 10 0v3h1a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h1Zm2 0h6V7a3 3 0 0 0-6 0v3Z";
  var OPEN_LOCK_PATH = "M9 10h9a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h1V7a5 5 0 0 1 9.58-2 1 1 0 1 1-1.83.8A3 3 0 0 0 9 7v3Z";
  var css = `
.fe2ee-lock{display:inline-flex;vertical-align:-2px;margin-inline-start:6px;color:var(--text-muted,#949ba4)}
.fe2ee-lock svg{width:14px;height:14px}
.fe2ee-lock[data-state="failed"]{color:var(--status-danger,#f23f43)}
.fe2ee-failed{color:var(--text-muted,#949ba4)}
.fe2ee-toggle{background:none;border:0;padding:0;margin:0;cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--interactive-normal,#b5bac1);transition:color 120ms ease-out,scale 200ms ease-out}
.fe2ee-toggle[aria-pressed="true"]{color:var(--status-positive,#23a55a)}
.fe2ee-toggle:active{scale:.96}
.fe2ee-toggle:focus-visible{outline:2px solid var(--focus-primary,#00a8fc);outline-offset:2px;border-radius:4px}
@media (hover:hover){.fe2ee-toggle:hover{color:var(--interactive-hover,#dbdee1)}.fe2ee-toggle[aria-pressed="true"]:hover{color:var(--status-positive,#23a55a)}}
.fe2ee-banners{position:fixed;inset-inline:0;top:0;z-index:10000;display:flex;flex-direction:column;align-items:center;gap:8px;padding-top:8px;pointer-events:none}
.fe2ee-banner{pointer-events:auto;display:flex;align-items:center;gap:12px;max-width:min(640px,calc(100vw - 32px));padding:10px 12px 10px 14px;border-radius:8px;font-size:14px;line-height:20px;text-wrap:pretty;color:var(--text-default,#dbdee1);background:var(--modal-background,var(--background-base-low,#313338));box-shadow:0 0 0 1px rgb(0 0 0 / .08),0 2px 4px rgb(0 0 0 / .16),0 8px 24px rgb(0 0 0 / .24)}
.fe2ee-banner[data-tone="danger"]{box-shadow:inset 3px 0 0 var(--status-danger,#f23f43),0 0 0 1px rgb(0 0 0 / .08),0 2px 4px rgb(0 0 0 / .16),0 8px 24px rgb(0 0 0 / .24)}
.fe2ee-banner[data-tone="warning"]{box-shadow:inset 3px 0 0 var(--status-warning,#f0b232),0 0 0 1px rgb(0 0 0 / .08),0 2px 4px rgb(0 0 0 / .16),0 8px 24px rgb(0 0 0 / .24)}
.fe2ee-banner svg{flex:none;width:18px;height:18px}
.fe2ee-banner p{margin:0;flex:1}
.fe2ee-button{font:inherit;font-size:14px;font-weight:500;line-height:20px;border:0;border-radius:6px;padding:6px 14px;cursor:pointer;color:#fff;background:var(--button-filled-brand-background,#5865f2);transition:background-color 120ms ease-out,scale 200ms ease-out;white-space:nowrap}
.fe2ee-button[data-variant="secondary"]{color:var(--text-default,#dbdee1);background:var(--button-secondary-background,#4e5058)}
.fe2ee-button:active{scale:.97}
.fe2ee-button:focus-visible{outline:2px solid var(--focus-primary,#00a8fc);outline-offset:2px}
@media (hover:hover){.fe2ee-button:hover{background:var(--button-filled-brand-background-hover,#4752c4)}.fe2ee-button[data-variant="secondary"]:hover{background:var(--button-secondary-background-hover,#6d6f78)}}
.fe2ee-dialog{border:0;padding:0;border-radius:12px;width:min(480px,calc(100vw - 32px));color:var(--text-default,#dbdee1);background:var(--modal-background,var(--background-base-low,#313338));box-shadow:0 0 0 1px rgb(0 0 0 / .08),0 4px 8px rgb(0 0 0 / .16),0 16px 48px rgb(0 0 0 / .32)}
.fe2ee-dialog::backdrop{background:rgb(0 0 0 / .7)}
.fe2ee-dialog-body{padding:20px 20px 16px;display:flex;flex-direction:column;gap:12px;font-size:15px;line-height:22px}
.fe2ee-dialog h2{margin:0;font-size:20px;line-height:24px;font-weight:600;text-wrap:balance;color:var(--header-primary,#f2f3f5)}
.fe2ee-dialog p{margin:0;text-wrap:pretty;color:var(--text-muted,#b5bac1)}
.fe2ee-dialog-actions{display:flex;justify-content:flex-end;gap:8px;padding:16px 20px;background:var(--modal-footer-background,var(--background-base-lower,#2b2d31));border-radius:0 0 12px 12px}
.fe2ee-member{display:flex;flex-direction:column;gap:8px;padding-top:8px}
.fe2ee-member + .fe2ee-member{border-top:1px solid var(--border-subtle,rgb(255 255 255 / .06));padding-top:16px}
.fe2ee-member-head{display:flex;align-items:center;justify-content:space-between;gap:12px}
.fe2ee-member-name{font-weight:600;color:var(--header-primary,#f2f3f5);overflow-wrap:anywhere}
.fe2ee-status{display:inline-flex;align-items:center;gap:6px;font-size:13px;white-space:nowrap;color:var(--text-muted,#b5bac1)}
.fe2ee-status[data-verified="true"]{color:var(--status-positive,#23a55a)}
.fe2ee-status svg{width:14px;height:14px}
.fe2ee-digits{display:grid;grid-template-columns:repeat(4,auto);justify-content:start;gap:4px 16px;font-size:17px;line-height:24px;font-variant-numeric:tabular-nums;letter-spacing:.04em;color:var(--header-primary,#f2f3f5)}
.fe2ee-member-actions{display:flex;gap:8px;flex-wrap:wrap}
@media (prefers-reduced-motion:no-preference){.fe2ee-banner{animation:fe2ee-in 180ms ease-out}}
@keyframes fe2ee-in{from{opacity:0;translate:0 -6px}}
.fe2ee-lock[data-state="pending"],.fe2ee-lock[data-state="missing"]{color:var(--text-muted,#949ba4)}
.fe2ee-unlock{font:inherit;font-size:13px;font-weight:500;line-height:18px;margin-inline-start:8px;padding:2px 8px;border:0;border-radius:4px;cursor:pointer;color:var(--text-default,#dbdee1);background:var(--button-secondary-background,#4e5058);transition:background-color 120ms ease-out,scale 200ms ease-out}
.fe2ee-unlock:active{scale:.97}
.fe2ee-unlock:focus-visible{outline:2px solid var(--focus-primary,#00a8fc);outline-offset:2px}
@media (hover:hover){.fe2ee-unlock:hover{background:var(--button-secondary-background-hover,#6d6f78)}}
.fe2ee-section{display:flex;flex-direction:column;gap:8px;padding-top:16px;border-top:1px solid var(--border-subtle,rgb(255 255 255 / .06))}
.fe2ee-section h3{margin:0;font-size:16px;line-height:20px;font-weight:600;color:var(--header-primary,#f2f3f5)}
.fe2ee-section > .fe2ee-button{align-self:flex-start}
.fe2ee-field{display:flex;flex-direction:column;gap:6px}
.fe2ee-field label{font-size:14px;font-weight:500;color:var(--text-default,#dbdee1)}
.fe2ee-row{display:flex;gap:8px;align-items:center}
.fe2ee-input{flex:1;min-width:0;font:inherit;font-size:15px;line-height:20px;padding:8px 10px;border-radius:6px;border:0;color:var(--text-default,#dbdee1);background:var(--input-background,var(--background-base-lowest,#1e1f22));box-shadow:inset 0 0 0 1px var(--border-subtle,rgb(255 255 255 / .06))}
.fe2ee-input:focus-visible{outline:2px solid var(--focus-primary,#00a8fc);outline-offset:0}
.fe2ee-input[aria-invalid="true"]{box-shadow:inset 0 0 0 1px var(--status-danger,#f23f43)}
.fe2ee-error{margin:0;font-size:14px;color:var(--status-danger,#f23f43)}
.fe2ee-code{font-size:28px;line-height:36px;font-weight:600;letter-spacing:.08em;font-variant-numeric:tabular-nums;color:var(--header-primary,#f2f3f5)}
.fe2ee-recovery{font-size:18px;line-height:28px;font-weight:600;letter-spacing:.06em;font-variant-numeric:tabular-nums;overflow-wrap:anywhere;user-select:all;padding:12px;border-radius:8px;color:var(--header-primary,#f2f3f5);background:var(--background-base-lowest,#1e1f22)}
.fe2ee-device{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:32px}
.fe2ee-device span{overflow-wrap:anywhere}
.fe2ee-device small{display:block;font-size:13px;color:var(--text-muted,#b5bac1)}
`;
  var svg = (path, label) => `<svg viewBox="0 0 24 24" fill="currentColor" ${label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"'}><path fill-rule="evenodd" d="${path}"/></svg>`;
  var escape = (text) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  var currentChannel = () => /^\/channels\/@me\/(\d+)/.exec(location.pathname)?.[1] ?? null;
  var memberName = (m) => m.global_name || m.username;
  var createUi = ({ engine: engine2, states: states2, enableChannel, link: link2, verifyPassword: verifyPassword2 }) => {
    const style = document.createElement("style");
    style.textContent = css;
    const banners = document.createElement("div");
    banners.className = "fe2ee-banners";
    let failure2 = null;
    let transient = null;
    let unlockOpen = null;
    const approvals = /* @__PURE__ */ new Map();
    let members = null;
    let scheduled = false;
    let backupPromptDismissed = false;
    const mount = () => {
      if (!style.isConnected) document.head.append(style);
      if (!banners.isConnected && document.body) document.body.append(banners);
    };
    const banner = (id, tone, text, action) => {
      let el = banners.querySelector(`[data-id="${id}"]`);
      if (!el) {
        el = document.createElement("div");
        el.className = "fe2ee-banner";
        el.dataset.id = id;
        el.setAttribute("role", tone === "danger" ? "alert" : "status");
        banners.append(el);
      }
      const key = `${tone}|${text}|${action?.label ?? ""}`;
      if (el.dataset.key === key) return;
      el.dataset.key = key;
      el.dataset.tone = tone;
      el.innerHTML = `${svg(LOCK_PATH)}<p>${escape(text)}</p>`;
      if (action) {
        const button2 = document.createElement("button");
        button2.type = "button";
        button2.className = "fe2ee-button";
        button2.textContent = action.label;
        button2.addEventListener("click", action.run);
        el.append(button2);
      }
    };
    const dropBanner = (id) => banners.querySelector(`[data-id="${id}"]`)?.remove();
    const dialog = (title, build) => {
      const el = document.createElement("dialog");
      el.className = "fe2ee-dialog";
      el.setAttribute("aria-label", title);
      const body = document.createElement("div");
      body.className = "fe2ee-dialog-body";
      body.innerHTML = `<h2>${escape(title)}</h2>`;
      const actions = document.createElement("div");
      actions.className = "fe2ee-dialog-actions";
      el.append(body, actions);
      const close = () => {
        el.close();
        el.remove();
      };
      el.addEventListener("cancel", close);
      build(body, actions, close);
      document.body.append(el);
      el.showModal();
      return el;
    };
    const button = (label, variant, run2) => {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "fe2ee-button";
      el.dataset.variant = variant;
      el.textContent = label;
      el.addEventListener("click", run2);
      return el;
    };
    const confirmEnable = (channelId) => dialog("Turn on end-to-end encryption?", (body, actions, close) => {
      body.insertAdjacentHTML(
        "beforeend",
        "<p>New messages in this conversation will be encrypted in your browser before they're sent, and only the people in it can read them. Encryption can't be turned off later.</p><p>Attachments, stickers and polls can't be sent here until encrypted attachments ship.</p>"
      );
      const confirm = button("Turn on encryption", "primary", async () => {
        confirm.disabled = true;
        try {
          await enableChannel(channelId);
          close();
        } catch (error) {
          confirm.disabled = false;
          showError(error, channelId);
          close();
        }
      });
      actions.append(button("Cancel", "secondary", close), confirm);
    });
    const showSafety = async (channelId) => {
      const list = await Promise.all((await engine2.channelMembers(channelId)).map((id) => engine2.profile(id)));
      dialog("Safety numbers", (body, actions, close) => {
        body.insertAdjacentHTML(
          "beforeend",
          "<p>Compare these numbers with each person in a call or face to face. If they match, nobody is intercepting your messages. Mark them as verified so you're warned if they change.</p>"
        );
        for (const member of list) {
          const section2 = document.createElement("section");
          section2.className = "fe2ee-member";
          section2.innerHTML = `<div class="fe2ee-member-head"><span class="fe2ee-member-name">${escape(memberName(member))}</span><span class="fe2ee-status"></span></div><div class="fe2ee-digits" aria-label="Safety number for ${escape(memberName(member))}">Calculating…</div><div class="fe2ee-member-actions"></div>`;
          body.append(section2);
          const render = async () => {
            const contact = engine2.contacts[member.id];
            const status = section2.querySelector(".fe2ee-status");
            status.dataset.verified = String(!!contact?.verified && !contact.pendingKey);
            status.innerHTML = contact?.pendingKey ? `${svg(OPEN_LOCK_PATH)}Safety number changed` : contact?.verified ? `${svg(LOCK_PATH)}Verified` : `${svg(OPEN_LOCK_PATH)}Not verified`;
            const digits = await engine2.safetyNumber(member.id);
            const grid = section2.querySelector(".fe2ee-digits");
            grid.innerHTML = digits ? (digits.match(/\d{5}/g) ?? []).map((g) => `<span>${g}</span>`).join("") : "This person hasn't set up encryption yet.";
            grid.dataset.number = digits ?? "";
            const row = section2.querySelector(".fe2ee-member-actions");
            row.replaceChildren();
            if (!contact) return;
            if (contact.pendingKey)
              row.append(
                button("Accept new safety number", "primary", async () => {
                  await engine2.acceptIdentity(member.id);
                  render();
                })
              );
            else
              row.append(
                button(contact.verified ? "Remove verification" : "Mark as verified", contact.verified ? "secondary" : "primary", async () => {
                  await engine2.setVerified(member.id, !contact.verified);
                  render();
                })
              );
          };
          render();
        }
        actions.append(
          button("Encryption settings", "secondary", () => {
            close();
            showSettings();
          }),
          button("Close", "secondary", close)
        );
      });
    };
    const field = (labelText, type, autocomplete) => {
      const id = `fe2ee-${Math.random().toString(36).slice(2)}`;
      const wrap = document.createElement("div");
      wrap.className = "fe2ee-field";
      wrap.innerHTML = `<label for="${id}">${escape(labelText)}</label><div class="fe2ee-row"></div><p class="fe2ee-error" id="${id}-error" hidden></p>`;
      const input = document.createElement("input");
      input.className = "fe2ee-input";
      input.id = id;
      input.type = type;
      input.autocomplete = autocomplete;
      input.spellcheck = false;
      input.setAttribute("aria-describedby", `${id}-error`);
      const row = wrap.querySelector(".fe2ee-row");
      row.append(input);
      const error = wrap.querySelector(".fe2ee-error");
      const setError = (text) => {
        error.hidden = !text;
        error.textContent = text ?? "";
        input.setAttribute("aria-invalid", String(!!text));
        if (text) input.focus();
      };
      return { wrap, input, row, setError };
    };
    const section = (title, text) => {
      const el = document.createElement("section");
      el.className = "fe2ee-section";
      el.innerHTML = `<h3>${escape(title)}</h3>${text ? `<p>${escape(text)}</p>` : ""}`;
      return el;
    };
    const unlockForm = (kind) => {
      const { wrap, input, row, setError } = kind === "password" ? field("Account password", "password", "current-password") : field("Recovery code", "text", "off");
      if (kind === "recovery") input.placeholder = "XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX";
      const submit = button("Unlock", "primary", async () => {
        if (!input.value.trim()) return setError(kind === "password" ? "Enter your password." : "Enter your recovery code.");
        submit.disabled = true;
        setError(null);
        try {
          await engine2.unlockWith(kind, input.value.trim());
        } catch (error) {
          setError(error instanceof Error ? error.message : String(error));
        } finally {
          submit.disabled = false;
        }
      });
      input.addEventListener("keydown", (event) => event.key === "Enter" && submit.click());
      row.append(submit);
      return wrap;
    };
    const showUnlock = () => {
      if (unlockOpen) return;
      const current = link2.outgoing();
      if (!current || current.state === "denied" || current.state === "failed") link2.request().catch(() => {
      });
      dialog("Unlock encrypted messages", (body, actions, close) => {
        const backup = engine2.backup;
        const intro = document.createElement("p");
        intro.textContent = "This browser can't read your encrypted messages yet. Bring your keys over with one of these.";
        body.append(intro);
        if (!backup || backup.mode === "password" && !backup.wrapped_secret) {
          const own = section(
            "Enter your password",
            "If your keys aren't backed up with your password yet, open the app on a browser you used before. It asks for your password once, and then it works here too."
          );
          own.append(unlockForm("password"));
          body.append(own);
        } else if (backup.wrapped_secret && backup.identity_key === engine2.serverKey) {
          const own = section(
            backup.mode === "recovery" ? "Enter your recovery code" : "Enter your password",
            backup.mode === "recovery" ? "Use the code you saved when you switched to a recovery code." : void 0
          );
          own.append(unlockForm(backup.mode));
          body.append(own);
        }
        const approval = section("Approve from another device");
        const status = document.createElement("p");
        status.setAttribute("role", "status");
        const code = document.createElement("div");
        code.className = "fe2ee-code";
        const again = button("Ask again", "secondary", () => link2.request().catch(() => {
        }));
        approval.append(status, code, again);
        body.append(approval);
        const render = () => {
          const state = link2.outgoing();
          code.hidden = state?.state !== "comparing";
          code.textContent = state?.sas ?? "";
          again.hidden = !state || state.state !== "denied" && state.state !== "failed";
          status.textContent = state?.state === "comparing" ? `${state.approverName ?? "Your other device"} is asking you to approve this browser. Check that it shows this code, then approve it there.` : state?.state === "denied" ? "Your other device declined this login." : state?.state === "failed" ? "The approval didn't unlock this browser. Ask again to retry." : "Open the app on a browser where you're already signed in. It will ask you to approve this one.";
          if (engine2.linked) {
            done();
            transient = { text: "This browser is unlocked. Your encrypted messages are loading.", until: Date.now() + 5e3 };
            refresh();
            setTimeout(refresh, 5100);
          }
        };
        const stop = engine2.onChange(render);
        const done = () => {
          stop();
          unlockOpen = null;
          close();
        };
        unlockOpen = { render, close: done };
        body.closest("dialog")?.addEventListener("close", () => {
          stop();
          unlockOpen = null;
        });
        actions.append(button("Not now", "secondary", done));
        render();
      });
    };
    const showApproval = (prompt) => {
      dialog(`New login on ${prompt.name}`, (body, actions, close) => {
        body.insertAdjacentHTML(
          "beforeend",
          `<p>Approve it only if you just signed in there yourself, because it gets access to your encrypted messages. The other browser should show this code:</p><div class="fe2ee-code">${escape(prompt.sas)}</div>`
        );
        const finish = () => {
          approvals.delete(prompt.requestId);
          close();
        };
        approvals.set(prompt.requestId, finish);
        const approve = button("Approve login", "primary", async () => {
          approve.disabled = true;
          try {
            await prompt.approve();
          } catch (error) {
            transient = { text: `Couldn't approve that login: ${error instanceof Error ? error.message : String(error)}`, until: Date.now() + 8e3 };
            refresh();
          }
          finish();
        });
        actions.append(
          button("Deny", "secondary", () => {
            finish();
            prompt.deny().catch(() => {
            });
          }),
          approve
        );
      });
    };
    const dismissApproval = (requestId) => approvals.get(requestId)?.();
    const backupPasswordForm = (onDone) => {
      const { wrap, input, row, setError } = field("Account password", "password", "current-password");
      const save = button("Back up keys", "primary", async () => {
        if (!input.value) return setError("Enter your password.");
        save.disabled = true;
        setError(null);
        try {
          if (!await verifyPassword2(input.value)) return setError("That password isn't right.");
          await engine2.backUpWithPassword(input.value);
          onDone();
        } catch (error) {
          setError(error instanceof Error ? error.message : String(error));
        } finally {
          save.disabled = false;
        }
      });
      input.addEventListener("keydown", (event) => event.key === "Enter" && save.click());
      row.append(save);
      return wrap;
    };
    const showBackupPassword = () => dialog("Back up your encryption keys", (body, actions, close) => {
      const intro = document.createElement("p");
      intro.textContent = "Your encryption keys only exist in this browser right now. Enter your account password to lock a backup of them with it, so any browser you sign in to can read your encrypted messages.";
      body.append(
        intro,
        backupPasswordForm(() => {
          close();
          transient = { text: "Your encryption keys are backed up.", until: Date.now() + 5e3 };
          refresh();
          setTimeout(refresh, 5100);
        })
      );
      actions.append(button("Not now", "secondary", close));
    });
    const showRecoveryCode = () => dialog("Use a recovery code", (body, actions, close) => {
      const intro = document.createElement("p");
      intro.textContent = "We'll make a code that locks your key backup instead of your password. You'll need it to set up a new browser when no other device is around to approve it. We only show it once.";
      body.append(intro);
      const create = button("Make recovery code", "primary", async () => {
        create.disabled = true;
        try {
          const code = await engine2.useRecoveryCode();
          intro.textContent = "Save this code somewhere safe, like a password manager. Anyone with it and access to your account can read your encrypted messages.";
          const box = document.createElement("div");
          box.className = "fe2ee-recovery";
          box.dataset.code = code;
          box.textContent = code;
          body.append(box);
          actions.replaceChildren(
            button("Copy code", "secondary", () => navigator.clipboard?.writeText(code).catch(() => {
            })),
            button("I saved it", "primary", close)
          );
        } catch (error) {
          create.disabled = false;
          transient = { text: `Couldn't make a recovery code: ${error instanceof Error ? error.message : String(error)}`, until: Date.now() + 8e3 };
          refresh();
        }
      });
      actions.append(button("Cancel", "secondary", close), create);
    });
    const showSettings = () => dialog("Encryption settings", (body, actions, close) => {
      const browser = section("This browser");
      const backupSection = section("Key backup");
      const devices = section("Your devices");
      body.append(browser, backupSection, devices);
      const describe = (el, text) => {
        const p = document.createElement("p");
        p.textContent = text;
        el.append(p);
      };
      const clear = (el) => el.querySelectorAll(":scope > :not(h3)").forEach((child) => child.remove());
      const renderBrowser = () => {
        clear(browser);
        describe(browser, engine2.linked ? "Unlocked. This browser can read and send encrypted messages." : "Locked. This browser can't read encrypted messages yet.");
        if (!engine2.linked)
          browser.append(
            button("Unlock this browser", "primary", () => {
              close();
              showUnlock();
            })
          );
      };
      const renderBackup = () => {
        clear(backupSection);
        const backup = engine2.backup;
        backupSection.dataset.mode = backup?.mode ?? "none";
        if (engine2.backupNeedsPassword) {
          describe(backupSection, "Your keys aren't backed up yet, so new browsers can't read your encrypted messages. Enter your account password to back them up.");
          backupSection.append(backupPasswordForm(renderBackup));
          return;
        }
        if (!backup) return describe(backupSection, "Your keys aren't backed up yet. Open the app on a browser that can read your messages to back them up.");
        if (backup.mode === "recovery")
          describe(backupSection, "Your keys are backed up and locked with a recovery code. New browsers ask for that code, and your password can't unlock them.");
        else if (backup.wrapped_secret)
          describe(
            backupSection,
            "Your keys are backed up and locked with your account password, so new browsers unlock as soon as you sign in. Someone with a copy of the server's database could try to guess a weak password offline."
          );
        else
          describe(
            backupSection,
            "Your keys are backed up, but they aren't locked with your password yet. Open the app on a browser that can read your messages to finish the backup."
          );
        if (!engine2.hasSecret) return;
        if (backup.mode === "password") {
          backupSection.append(
            button("Use a recovery code instead", "secondary", () => {
              close();
              showRecoveryCode();
            })
          );
          return;
        }
        const { wrap, input, row, setError } = field("Account password", "password", "current-password");
        const save = button("Use my password instead", "secondary", async () => {
          if (!input.value) return setError("Enter your password.");
          save.disabled = true;
          setError(null);
          try {
            if (!await verifyPassword2(input.value)) return setError("That password isn't right.");
            await engine2.setBackupMode("password", input.value);
            renderBackup();
          } catch (error) {
            setError(error instanceof Error ? error.message : String(error));
          } finally {
            save.disabled = false;
          }
        });
        row.append(save);
        backupSection.append(
          wrap,
          button("Make a new recovery code", "secondary", () => {
            close();
            showRecoveryCode();
          })
        );
      };
      const renderDevices = () => {
        clear(devices);
        for (const device of engine2.devices.filter((d) => d.status !== "revoked")) {
          const row = document.createElement("div");
          row.className = "fe2ee-device";
          const current = device.device_id === engine2.device?.deviceId;
          const added = device.created_at ? `Added ${new Date(device.created_at).toLocaleString(void 0, { dateStyle: "medium", timeStyle: "short" })}` : null;
          const state = current ? "This browser" : device.status === "active" ? "Can read encrypted messages" : "Waiting for approval";
          row.innerHTML = `<span>${escape(device.name ?? "Unknown browser")}<small>${escape([state, added].filter(Boolean).join(" · "))}</small></span>`;
          if (!current)
            row.append(
              button("Remove", "secondary", async () => {
                await engine2.removeDevice(device.device_id).catch(() => {
                });
                renderDevices();
              })
            );
          devices.append(row);
        }
      };
      renderBrowser();
      renderBackup();
      renderDevices();
      engine2.reloadBackup().then(renderBackup, () => {
      });
      actions.append(button("Close", "secondary", close));
    });
    const showError = (error, channelId) => {
      const name = (id) => id && members?.channelId === channelId ? members.list.find((m) => m.id === id) ?? null : null;
      let text = "Your message couldn't be encrypted, so it wasn't sent.";
      if (error instanceof E2eeError) {
        const who = name(error.userId);
        if (error.code === "NO_DEVICES")
          text = `${who ? memberName(who) : "Someone here"} hasn't set up encryption yet, so your message wasn't sent. Ask them to open the app once.`;
        else if (error.code === "IDENTITY_CHANGED") text = `${who ? memberName(who) : "Someone"}'s safety number changed. Review it before sending more messages.`;
        else if (error.code === "UNSUPPORTED") text = error.message;
        else if (error.code === "NOT_LINKED") {
          transient = {
            text: "This browser can't send encrypted messages until you unlock it, so your message wasn't sent.",
            until: Date.now() + 8e3,
            action: { label: "Unlock", run: showUnlock }
          };
          refresh();
          setTimeout(refresh, 8100);
          return;
        } else if (error.code === "NOT_READY") text = "End-to-end encryption is unavailable right now, so your message wasn't sent.";
      } else if (error?.body?.message === "E2EE_RECIPIENT_NO_DEVICES")
        text = "Everyone here needs to open the app once before encryption can be turned on.";
      transient = { text, until: Date.now() + 8e3 };
      refresh();
      setTimeout(refresh, 8100);
    };
    const decorateMessages = () => {
      for (const [id, info] of states2) {
        const content = document.getElementById(`message-content-${id}`);
        if (!content) continue;
        const existing = content.querySelector(":scope > .fe2ee-lock");
        if (existing?.dataset.state === info.state) continue;
        existing?.remove();
        content.querySelector(":scope > .fe2ee-unlock")?.remove();
        const lock = document.createElement("span");
        lock.className = "fe2ee-lock";
        lock.dataset.state = info.state;
        const label = info.state === "decrypted" ? "End-to-end encrypted" : info.state === "pending" ? "Decrypting" : info.state === "missing" ? "This browser doesn't have the key for this message" : `Couldn't decrypt: ${info.reason ?? "unknown error"}`;
        lock.title = label;
        lock.innerHTML = svg(info.state === "decrypted" || info.state === "pending" ? LOCK_PATH : OPEN_LOCK_PATH, label);
        content.append(lock);
        if (info.state === "missing") {
          const unlock = document.createElement("button");
          unlock.type = "button";
          unlock.className = "fe2ee-unlock";
          unlock.textContent = engine2.linked ? "Get keys" : "Unlock";
          unlock.addEventListener("click", (event) => {
            event.stopPropagation();
            if (engine2.linked && engine2.hasSecret) showSettings();
            else showUnlock();
          });
          content.append(unlock);
        }
      }
    };
    const decorateHeader = (channelId) => {
      const existing = document.querySelector(".fe2ee-toggle");
      if (!channelId) return existing?.remove();
      const toolbars = [...document.querySelectorAll('[class*="toolbar__"]')];
      const toolbar = toolbars.find((t) => t.parentElement?.className.includes("upperContainer")) ?? toolbars[0];
      if (!toolbar) return;
      const on = engine2.isEncrypted(channelId);
      let toggle = existing;
      if (!toggle || toggle.parentElement !== toolbar) {
        toggle?.remove();
        toggle = document.createElement("button");
        toggle.type = "button";
        const sibling = toolbar.querySelector('[role="button"]');
        toggle.className = `fe2ee-toggle ${sibling?.className ?? ""}`;
        toggle.addEventListener("click", () => {
          const id = currentChannel();
          if (!id) return;
          if (engine2.isEncrypted(id)) showSafety(id);
          else confirmEnable(id);
        });
        toolbar.prepend(toggle);
      }
      const key = String(on);
      if (toggle.dataset.on === key) return;
      toggle.dataset.on = key;
      toggle.setAttribute("aria-pressed", key);
      toggle.setAttribute("aria-label", on ? "End-to-end encryption is on. View safety numbers" : "Turn on end-to-end encryption");
      toggle.title = on ? "End-to-end encrypted" : "Turn on end-to-end encryption";
      toggle.innerHTML = svg(on ? LOCK_PATH : OPEN_LOCK_PATH);
      toggle.querySelector("svg").setAttribute("width", "20");
      toggle.querySelector("svg").setAttribute("height", "20");
    };
    const decorateBanners = (channelId) => {
      if (failure2) banner("failure", "danger", failure2);
      else dropBanner("failure");
      if (!failure2 && engine2.backupNeedsPassword && !backupPromptDismissed && location.pathname.startsWith("/channels/"))
        banner("backup", "info", "Back up your encryption keys with your password so your other browsers can read your encrypted messages.", {
          label: "Back up",
          run: () => {
            backupPromptDismissed = true;
            dropBanner("backup");
            showBackupPassword();
          }
        });
      else dropBanner("backup");
      if (transient && transient.until > Date.now()) banner("transient", "warning", transient.text, transient.action);
      else dropBanner("transient");
      if (channelId && engine2.isEncrypted(channelId) && members?.channelId === channelId) {
        const changed = members.list.find((m) => engine2.contacts[m.id]?.pendingKey);
        if (changed)
          banner("changed", "warning", `${memberName(changed)}'s safety number changed. Sending is paused until you review it.`, {
            label: "Review",
            run: () => showSafety(channelId)
          });
        else dropBanner("changed");
        if (engine2.locked && !failure2) banner("linked", "info", "Unlock this browser to read and send encrypted messages here.", { label: "Unlock", run: showUnlock });
        else dropBanner("linked");
      } else {
        dropBanner("changed");
        dropBanner("linked");
      }
    };
    const refresh = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        mount();
        const channelId = currentChannel();
        if (channelId && engine2.userId && members?.channelId !== channelId) {
          const id = channelId;
          engine2.channelMembers(id).then((ids) => Promise.all(ids.map((m) => engine2.profile(m)))).then((list) => {
            members = { channelId: id, list };
            refresh();
          }).catch(() => {
          });
        }
        decorateMessages();
        decorateHeader(channelId);
        decorateBanners(channelId);
      });
    };
    const start2 = () => {
      mount();
      new MutationObserver(refresh).observe(document.body, { childList: true, subtree: true });
      engine2.onChange(refresh);
      refresh();
    };
    if (document.body) start2();
    else document.addEventListener("DOMContentLoaded", start2, { once: true });
    return {
      refresh,
      showError,
      showUnlock,
      showApproval,
      dismissApproval,
      showSettings,
      renderUnlock: () => unlockOpen?.render(),
      fail: (text) => {
        failure2 = text;
        refresh();
      }
    };
  };

  // client/e2ee/src/webpack.ts
  var keysOf = (value) => {
    try {
      return value && (typeof value === "object" || typeof value === "function") ? Object.keys(value) : [];
    } catch {
      return [];
    }
  };
  var protoKeysOf = (value) => {
    try {
      const proto = value && typeof value === "object" ? Object.getPrototypeOf(value) : null;
      return proto && proto !== Object.prototype ? Object.getOwnPropertyNames(proto) : [];
    } catch {
      return [];
    }
  };
  var pickRequire = (reqs) => reqs.filter((r) => r.c).reduce((best, r) => !best || Object.keys(r.c).length > Object.keys(best.c).length ? r : best, null);
  var scan = (reqs, found) => {
    const req = pickRequire(reqs);
    if (!req?.c) return found;
    for (const id of Object.keys(req.c)) {
      if (found.dispatcher && found.http && found.gateway) break;
      const exports = req.c[id]?.exports;
      for (const name of keysOf(exports)) {
        let value;
        try {
          value = exports[name];
        } catch {
          continue;
        }
        if (!value || typeof value !== "object") continue;
        const own = keysOf(value);
        const proto = protoKeysOf(value);
        const all = /* @__PURE__ */ new Set([...own, ...proto]);
        if (!found.dispatcher && ["addInterceptor", "dispatch", "subscribe"].every((k) => all.has(k))) found.dispatcher = value;
        else if (!found.http && own.length <= 6 && ["get", "post", "put", "patch", "del"].every((k) => own.includes(k) && typeof value[k] === "function"))
          found.http = value;
        else if (!found.gateway && proto.includes("getSocket") && proto.includes("isTryingToConnect")) {
          try {
            const socket = value.getSocket();
            if (socket && keysOf(socket.dispatcher).includes("getDispatchHandler")) found.gateway = value;
          } catch {
            continue;
          }
        }
      }
    }
    return found;
  };

  // client/e2ee/src/index.ts
  var HOOK_TIMEOUT_MS = 2e4;
  var UNAVAILABLE = "End-to-end encryption is unavailable in this client build, so sending in encrypted conversations is turned off.";
  var loader = window.__fosscordE2ee ??= { reqs: [] };
  var states = /* @__PURE__ */ new Map();
  var targets = {};
  var http = null;
  var failure = null;
  var settle = () => {
  };
  var ready = new Promise((resolve) => {
    settle = resolve;
  });
  var started = false;
  var initialized = false;
  var lastProbe = 0;
  var api = {
    async request(method, url, body) {
      if (!http) throw new Error("HTTP client not found");
      const res = await http[method]({ url, body, rejectWithError: false });
      if (!res.ok) throw res;
      return res.body;
    }
  };
  var engine = new Engine(api);
  var link = createLink(engine, api, {
    onPrompt: (prompt) => ui.showApproval(prompt),
    onChange: () => ui.renderUnlock(),
    onDismiss: (requestId) => ui.dismissApproval(requestId)
  });
  var apiBase = () => {
    const env = window.GLOBAL_ENV;
    return `${env?.API_ENDPOINT ?? "/api"}/v${env?.API_VERSION ?? 9}`;
  };
  var tokenApi = (token) => ({
    async request(method, url, body) {
      const res = await fetch(`${apiBase()}${url}`, {
        method: method === "del" ? "DELETE" : method.toUpperCase(),
        headers: { "content-type": "application/json", authorization: token },
        body: body === void 0 ? void 0 : JSON.stringify(body)
      });
      const parsed = await res.json().catch(() => null);
      if (!res.ok) throw { ok: false, status: res.status, body: parsed };
      return parsed;
    }
  });
  var verifyPassword = async (password) => {
    const me = await api.request("get", "/users/@me");
    const base = apiBase();
    const res = await fetch(`${base}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ login: me.email ?? me.username, password })
    });
    const body = await res.json().catch(() => null);
    if (body?.token) await fetch(`${base}/auth/logout`, { method: "POST", headers: { "content-type": "application/json", authorization: body.token }, body: "{}" }).catch(() => {
    });
    return res.ok && !!(body?.token || body?.ticket);
  };
  var ui = createUi({
    engine,
    states,
    link,
    verifyPassword,
    enableChannel: async (channelId) => {
      await api.request("put", `/channels/${channelId}/e2ee`, { enabled: true });
      engine.setChannelEncrypted(channelId);
    }
  });
  var fail = (reason) => {
    if (failure) return;
    failure = reason;
    console.error(`[e2ee] ${reason}`);
    ui.fail(UNAVAILABLE);
    settle(false);
  };
  var readyNow = false;
  ready.then((ok) => {
    readyNow = ok;
    if (ok) hooks.retryAll();
  });
  var hooks = createHooks({
    engine,
    ready,
    states,
    failClosed: () => failure !== null,
    isReady: () => readyNow,
    onCredentials: (path, body, response) => {
      const password = typeof body.password === "string" ? body.password : void 0;
      const next = typeof body.new_password === "string" ? body.new_password : void 0;
      if (path !== "/users/@me") return password && engine.rememberPassword(password);
      if (!next) return;
      const token = response?.token;
      engine.passwordChanged(password, next, typeof token === "string" ? tokenApi(token) : void 0).catch((error) => console.error("[e2ee] couldn't rewrap the backup", error));
    },
    onState: () => ui.refresh(),
    onError: (error, channelId) => ui.showError(error, channelId)
  });
  var selfTest = async () => {
    const agreement = await generateAgreementKey();
    const secret = randomBytes(32);
    const sealed = await hpkeSeal(await exportPublic(agreement.publicKey), secret, "self-test", "aad");
    const opened = await hpkeOpen(agreement, sealed.enc, sealed.wrapped, "self-test", "aad");
    if (toB64u(opened) !== toB64u(secret)) throw new Error("HPKE round trip failed");
    const iv = randomBytes(12);
    const ct = await aesEncrypt(secret, iv, secret, "aad");
    if (toB64u(await aesDecrypt(secret, iv, ct, "aad")) !== toB64u(secret)) throw new Error("AES-GCM round trip failed");
    const signing = await generateSigningKey();
    const signature = await sign(signing.privateKey, "self-test");
    if (!await verify(await exportPublic(signing.publicKey), "self-test", signature)) throw new Error("Ed25519 round trip failed");
    if (await verify(await exportPublic(signing.publicKey), "self-tesT", signature)) throw new Error("Ed25519 accepted a bad signature");
    const prekey = engine.prekeys.reduce((a, b) => b.id > a.id ? b : a);
    const probe = await hpkeSeal(prekey.publicKey, secret, "self-test", "aad");
    if (toB64u(await hpkeOpen(prekey.keyPair, probe.enc, probe.wrapped, "self-test", "aad")) !== toB64u(secret)) throw new Error("Stored prekey round trip failed");
  };
  var start = async (userId) => {
    if (started || failure) return;
    started = true;
    try {
      await engine.init(userId);
      await selfTest();
      initialized = true;
      engine.onUnlock(() => hooks.retryAll());
      ui.refresh();
      if (engine.locked) {
        link.request().catch((error) => console.error("[e2ee] link request failed", error));
        ui.showUnlock();
      }
    } catch (error) {
      fail(`Self-test failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  var startWhenReady = () => {
    if (started || !http || Date.now() - lastProbe < 1e4) return;
    lastProbe = Date.now();
    api.request("get", "/users/@me").then(
      (me) => start(me.id),
      () => {
      }
    );
  };
  var received = {};
  var count = (type) => received[type] = (received[type] ?? 0) + 1;
  var selfRefresh = null;
  var refreshSelf = (userId) => {
    if (userId !== engine.userId || !initialized || selfRefresh) return;
    selfRefresh = setTimeout(() => {
      selfRefresh = null;
      engine.refresh().catch((error) => console.error("[e2ee] refresh failed", error));
    }, 500);
  };
  var custom = {
    E2EE_DEVICES_UPDATE: (data) => {
      count("E2EE_DEVICES_UPDATE");
      engine.invalidateUser(String(data.user_id));
      refreshSelf(String(data.user_id));
      ui.refresh();
    },
    E2EE_IDENTITY_UPDATE: (data) => {
      count("E2EE_IDENTITY_UPDATE");
      engine.invalidateUser(String(data.user_id));
      refreshSelf(String(data.user_id));
      ui.refresh();
    },
    E2EE_LINK_REQUEST: (data) => {
      count("E2EE_LINK_REQUEST");
      if (initialized) link.onEvent("E2EE_LINK_REQUEST", data);
    },
    E2EE_LINK_RESPONSE: (data) => {
      count("E2EE_LINK_RESPONSE");
      if (initialized) link.onEvent("E2EE_LINK_RESPONSE", data);
    },
    CHANNEL_E2EE_UPDATE: (data) => {
      count("CHANNEL_E2EE_UPDATE");
      if (data.enabled) engine.setChannelEncrypted(String(data.channel_id));
    }
  };
  var installed = { dispatcher: false, http: false, gateway: false };
  var startedAt = Date.now();
  var tick = () => {
    if (failure) return;
    scan(loader.reqs, targets);
    if (targets.http && !installed.http) {
      installed.http = true;
      const originals = hooks.wrapHttp(targets.http);
      http = originals;
    }
    if (targets.dispatcher && !installed.dispatcher) {
      installed.dispatcher = true;
      hooks.watchDispatcher(targets.dispatcher);
      targets.dispatcher.subscribe("CONNECTION_OPEN", (action) => {
        const user = action.user;
        if (user?.id) start(user.id);
        else startWhenReady();
      });
      targets.dispatcher.subscribe("CHANNEL_RECIPIENT_ADD", (action) => engine.invalidateChannel(String(action.channelId)));
      targets.dispatcher.subscribe("CHANNEL_RECIPIENT_REMOVE", (action) => engine.invalidateChannel(String(action.channelId)));
    }
    if (targets.gateway && !installed.gateway && targets.gateway.getSocket().dispatcher.getDispatchHandler) {
      installed.gateway = true;
      hooks.wrapGateway(targets.gateway, custom);
    }
    if (installed.http && installed.dispatcher && installed.gateway) {
      if (initialized) return settle(true);
      if (!started && Date.now() - startedAt > 8e3) startWhenReady();
    } else if (Date.now() - startedAt > HOOK_TIMEOUT_MS) {
      const missing = Object.entries(installed).filter(([, ok]) => !ok).map(([name]) => name);
      return fail(`Couldn't find ${missing.join(", ")} in this client build`);
    }
    setTimeout(tick, installed.http && installed.dispatcher ? 100 : 20);
  };
  loader.status = () => ({
    ready: initialized && !failure && installed.http && installed.dispatcher && installed.gateway,
    failure,
    userId: engine.userId,
    deviceId: engine.device?.deviceId ?? null,
    deviceStatus: engine.deviceStatus,
    linked: engine.linked,
    locked: engine.locked,
    holdsIdentity: !!engine.identity,
    trustedKey: engine.trustedKey,
    hasSecret: engine.hasSecret,
    backup: engine.backup ? { mode: engine.backup.mode, version: engine.backup.version, hasSecret: !!engine.backup.wrapped_secret, identityKey: engine.backup.identity_key } : null,
    link: link.outgoing(),
    hooks: { ...installed },
    encryptedChannels: [...engine.encryptedChannels],
    states: Object.fromEntries(states),
    received: { ...received }
  });
  tick();
})();
