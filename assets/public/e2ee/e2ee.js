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

  // node_modules/@hpke/common/esm/src/errors.js
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

  // node_modules/@hpke/common/esm/_dnt.shims.js
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

  // node_modules/@hpke/common/esm/src/algorithm.js
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

  // node_modules/@hpke/common/esm/src/identifiers.js
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

  // node_modules/@hpke/common/esm/src/consts.js
  var INPUT_LENGTH_LIMIT = 8192;
  var INFO_LENGTH_LIMIT = 268435456;
  var MINIMUM_PSK_LENGTH = 32;
  var EMPTY = /* @__PURE__ */ new Uint8Array(0);

  // node_modules/@hpke/common/esm/src/interfaces/kemInterface.js
  var SUITE_ID_HEADER_KEM = /* @__PURE__ */ new Uint8Array([
    75,
    69,
    77,
    0,
    0
  ]);

  // node_modules/@hpke/common/esm/src/kdfs/hkdf.js
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

  // node_modules/@hpke/common/esm/src/utils/misc.js
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

  // node_modules/@hpke/common/esm/src/kems/dhkem.js
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

  // node_modules/@hpke/common/esm/src/interfaces/dhkemPrimitives.js
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

  // node_modules/@hpke/common/esm/src/kems/dhkemPrimitives/ec.js
  var EC_P_521_PARAMS = {
    p: (1n << 521n) - 1n,
    b: 0x0051953eb9618e1c9a1f929a21a0b68540eea2da725b99b315f3b8b489918ef109e156193951ec7e937b1652c0bd3bb1bf073573df883d2c34f1ef451fd46b503f00n,
    gx: 0x00c6858e06b70404e9cd9e3ecb662395b4429c648139053fb521f828af606b4d3dbaa14b5e77efe75928fe1dc127a2ffa8de3348b3c1856a429bf97e7e31c2e5bd66n,
    gy: 0x011839296a789a3bc0045c8a5fb42c7d1bd998f54449579b446817afbd17273e662c97ee72995ef42640c550b9013fad0761353c7086a272c24088be94769fd16650n,
    coordinateSize: 66
  };

  // node_modules/@hpke/common/esm/src/interfaces/aeadEncryptionContext.js
  var AEAD_USAGES = ["encrypt", "decrypt"];

  // node_modules/@hpke/common/esm/src/utils/noble.js
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

  // node_modules/@hpke/common/esm/src/hash/hash.js
  function ahash(h) {
    if (typeof h !== "function" || typeof h.create !== "function") {
      throw new Error("Hash must wrapped by utils.createHasher");
    }
    anumber(h.outputLen);
    anumber(h.blockLen);
  }

  // node_modules/@hpke/common/esm/src/hash/hmac.js
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

  // node_modules/@hpke/common/esm/src/hash/u64.js
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

  // node_modules/@hpke/common/esm/src/hash/sha3.js
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

  // node_modules/@hpke/core/esm/src/aeads/aesGcm.js
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

  // node_modules/@hpke/core/esm/src/utils/emitNotSupported.js
  function emitNotSupported() {
    return new Promise((_resolve, reject) => {
      reject(new NotSupportedError("Not supported"));
    });
  }

  // node_modules/@hpke/core/esm/src/exporterContext.js
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

  // node_modules/@hpke/core/esm/src/encryptionContext.js
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

  // node_modules/@hpke/core/esm/src/mutex.js
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

  // node_modules/@hpke/core/esm/src/recipientContext.js
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

  // node_modules/@hpke/core/esm/src/senderContext.js
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

  // node_modules/@hpke/core/esm/src/cipherSuiteNative.js
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

  // node_modules/@hpke/core/esm/src/native.js
  var CipherSuite = class extends CipherSuiteNative {
  };
  var HkdfSha256 = class extends HkdfSha256Native {
  };

  // node_modules/@hpke/core/esm/src/kems/dhkemPrimitives/x25519.js
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
    constructor(hkdf) {
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
      this._hkdf = hkdf;
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

  // node_modules/@hpke/core/esm/src/kems/dhkemX25519.js
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

  // node_modules/@hpke/core/esm/src/kems/dhkemPrimitives/x448.js
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
  var deviceMessage = (userId, deviceId, signingKey) => `fosscord-e2ee/v1/device
${userId}
${deviceId}
${signingKey}`;
  var prekeyMessage = (deviceId, prekeyId, publicKey) => `fosscord-e2ee/v1/prekey
${deviceId}
${prekeyId}
${publicKey}`;

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
  var PREKEY_ROTATE_MS = 7 * 24 * 3600 * 1e3;
  var PREKEY_KEEP_MS = 30 * 24 * 3600 * 1e3;
  var DIRECTORY_TTL_MS = 5 * 60 * 1e3;
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
  var signedPayload = (channelId, senderId, bind, env) => JSON.stringify([
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
  ]);
  var Engine = class {
    constructor(api2) {
      this.api = api2;
    }
    api;
    userId = "";
    linked = false;
    deviceStatus = "unregistered";
    identity = null;
    device = null;
    prekeys = [];
    contacts = {};
    encryptedChannels = /* @__PURE__ */ new Set();
    store = null;
    directory = /* @__PURE__ */ new Map();
    members = /* @__PURE__ */ new Map();
    profiles = /* @__PURE__ */ new Map();
    plaintext = /* @__PURE__ */ new Map();
    listeners = /* @__PURE__ */ new Set();
    onChange(listener) {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    }
    emit() {
      this.listeners.forEach((listener) => listener());
    }
    async init(userId) {
      this.userId = userId;
      this.store = scoped(userId);
      this.contacts = await this.store.get("contacts") ?? {};
      await this.ensureKeys();
      this.emit();
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
    async ensureKeys() {
      const store = this.store;
      const state = await this.api.request("get", "/users/@me/e2ee");
      this.encryptedChannels = new Set(state.channels);
      this.identity = await store.get("identity") ?? null;
      this.device = await store.get("device") ?? null;
      this.prekeys = await store.get("prekeys") ?? [];
      if (!this.identity && !state.identity_key) {
        const pair = await generateSigningKey();
        this.identity = { publicKey: await exportPublic(pair.publicKey), privateKey: pair.privateKey };
        await store.set("identity", this.identity);
      }
      if (this.identity && !state.identity_key) await this.api.request("put", "/users/@me/e2ee/identity", { public_key: this.identity.publicKey });
      const identityMatches = !!this.identity && (!state.identity_key || state.identity_key === this.identity.publicKey);
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
      const needsSignature = identityMatches && serverDevice?.status !== "active";
      if (!serverDevice || serverDevice.prekey.id !== current.id || needsSignature) {
        const identitySignature = identityMatches ? await sign(this.identity.privateKey, deviceMessage(this.userId, this.device.deviceId, this.device.signingKey)) : void 0;
        serverDevice = await this.api.request("post", "/users/@me/e2ee/devices", {
          device_id: this.device.deviceId,
          signing_key: this.device.signingKey,
          identity_signature: identitySignature,
          name: navigator.userAgent.slice(0, 64),
          prekey: { id: current.id, public_key: current.publicKey, signature: current.signature }
        });
      }
      this.deviceStatus = serverDevice.status;
      this.linked = identityMatches && serverDevice.status === "active";
      this.directory.delete(this.userId);
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
      if (identityKey && userId === this.userId) identityChanged = identityKey !== this.identity?.publicKey;
      else if (identityKey) {
        const contact = this.contacts[userId];
        if (!contact) {
          this.contacts[userId] = { identityKey, verified: false, pendingKey: null, firstSeen: Date.now() };
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
      }
      return { userId, identityKey, identityChanged, devices, fetchedAt: Date.now() };
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
      if (!this.linked) throw new E2eeError("NOT_LINKED", "This browser is not linked to your encryption identity");
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
      const unsigned = { v: 1, alg: ALGORITHM, sender_device: this.device.deviceId, ...opts.mid ? { mid: opts.mid } : {}, iv: toB64u(iv), ct: toB64u(ct), keys };
      const sig = await sign(this.device.privateKey, signedPayload(channelId, this.userId, bind, unsigned));
      const envelope = { ...unsigned, sig };
      this.plaintext.set(`${opts.mid ?? ""}:${sig}`, content);
      return envelope;
    }
    cached(message) {
      const env = message.encrypted;
      return env ? this.plaintext.get(`${message.id}:${env.sig}`) ?? this.plaintext.get(`${env.mid ?? ""}:${env.sig}`) : void 0;
    }
    async decrypt(message) {
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
      const mine = env.keys.find((k) => k.device_id === this.device.deviceId);
      if (!mine) throw new E2eeError("NO_KEY", "This message was not encrypted for this browser");
      const prekey = this.prekeys.find((p) => p.id === mine.prekey_id);
      if (!prekey) throw new E2eeError("NO_KEY", "The key for this message has expired");
      const aad = messageAad(message.channel_id, senderId, env.sender_device, bind);
      const contentKey = await hpkeOpen(prekey.keyPair, mine.enc, mine.wrapped, WRAP_INFO, `${aad}
${mine.device_id}`);
      const payload = JSON.parse(fromUtf8(await aesDecrypt(contentKey, fromB64u(env.iv), fromB64u(env.ct), aad)));
      const content = typeof payload.content === "string" ? payload.content : "";
      this.plaintext.set(`${message.id}:${env.sig}`, content);
      return content;
    }
    async safetyNumber(userId) {
      const [entry] = await this.keysFor([userId]);
      const theirs = this.contacts[userId]?.pendingKey ?? entry.identityKey;
      if (!theirs || !this.identity) return null;
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
      const [mine, other] = await Promise.all([part(this.userId, this.identity.publicKey), part(userId, theirs)]);
      return mine < other ? mine + other : other + mine;
    }
  };

  // client/e2ee/src/hooks.ts
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
    const decryptOne = (message) => {
      const key = `${message.id}:${message.encrypted?.sig}`;
      const sync = engine2.cached(message);
      if (sync !== void 0) {
        message.content = sync;
        states2.set(message.id, { state: "decrypted" });
        return Promise.resolve();
      }
      let pending = inflight.get(key);
      if (!pending) {
        pending = (async () => {
          try {
            if (!await ctx.ready) throw new E2eeError("NOT_READY", "Encryption is unavailable in this client build");
            const content = await engine2.decrypt(message);
            states2.set(message.id, { state: "decrypted" });
            message.content = content;
          } catch (error) {
            states2.set(message.id, { state: "failed", reason: error instanceof Error ? error.message : String(error) });
            message.content = FALLBACK_CONTENT;
          }
        })().finally(() => inflight.delete(key));
        inflight.set(key, pending);
        return pending.then(() => ctx.onState());
      }
      return pending.then(() => {
        const again = engine2.cached(message);
        if (again !== void 0) message.content = again;
        ctx.onState();
      });
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
    const watchDispatcher = (dispatcher) => {
      dispatcher.addInterceptor((action) => {
        if (action.e2eeLocal || !/MESSAGE|SEARCH|PIN|MENTION|THREAD/.test(action.type)) return false;
        const messages = collect(action, []).filter((m) => m.content === FALLBACK_CONTENT && !states2.has(m.id));
        for (const message of messages) {
          const hit = engine2.cached(message);
          if (hit !== void 0) {
            message.content = hit;
            states2.set(message.id, { state: "decrypted" });
            continue;
          }
          const copy = JSON.parse(JSON.stringify(message));
          decryptOne(copy).then(() => {
            if (states2.get(copy.id)?.state !== "decrypted") return;
            dispatcher.dispatch({ type: "MESSAGE_UPDATE", message: copy, e2eeLocal: true });
          });
        }
        return false;
      });
    };
    return { wrapHttp, wrapGateway, watchDispatcher, decryptAll };
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
`;
  var svg = (path, label) => `<svg viewBox="0 0 24 24" fill="currentColor" ${label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"'}><path fill-rule="evenodd" d="${path}"/></svg>`;
  var escape = (text) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  var currentChannel = () => /^\/channels\/@me\/(\d+)/.exec(location.pathname)?.[1] ?? null;
  var memberName = (m) => m.global_name || m.username;
  var createUi = ({ engine: engine2, states: states2, enableChannel }) => {
    const style = document.createElement("style");
    style.textContent = css;
    const banners = document.createElement("div");
    banners.className = "fe2ee-banners";
    let failure2 = null;
    let transient = null;
    let members = null;
    let scheduled = false;
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
          const section = document.createElement("section");
          section.className = "fe2ee-member";
          section.innerHTML = `<div class="fe2ee-member-head"><span class="fe2ee-member-name">${escape(memberName(member))}</span><span class="fe2ee-status"></span></div><div class="fe2ee-digits" aria-label="Safety number for ${escape(memberName(member))}">Calculating…</div><div class="fe2ee-member-actions"></div>`;
          body.append(section);
          const render = async () => {
            const contact = engine2.contacts[member.id];
            const status = section.querySelector(".fe2ee-status");
            status.dataset.verified = String(!!contact?.verified && !contact.pendingKey);
            status.innerHTML = contact?.pendingKey ? `${svg(OPEN_LOCK_PATH)}Safety number changed` : contact?.verified ? `${svg(LOCK_PATH)}Verified` : `${svg(OPEN_LOCK_PATH)}Not verified`;
            const digits = await engine2.safetyNumber(member.id);
            const grid = section.querySelector(".fe2ee-digits");
            grid.innerHTML = digits ? (digits.match(/\d{5}/g) ?? []).map((g) => `<span>${g}</span>`).join("") : "This person hasn't set up encryption yet.";
            grid.dataset.number = digits ?? "";
            const row = section.querySelector(".fe2ee-member-actions");
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
        actions.append(button("Close", "secondary", close));
      });
    };
    const showError = (error, channelId) => {
      const name = (id) => id && members?.channelId === channelId ? members.list.find((m) => m.id === id) ?? null : null;
      let text = "Your message couldn't be encrypted, so it wasn't sent.";
      if (error instanceof E2eeError) {
        const who = name(error.userId);
        if (error.code === "NO_DEVICES")
          text = `${who ? memberName(who) : "Someone here"} hasn't set up encryption yet, so your message wasn't sent. Ask them to open the app once.`;
        else if (error.code === "IDENTITY_CHANGED") text = `${who ? memberName(who) : "Someone"}'s safety number changed. Review it before sending more messages.`;
        else if (error.code === "UNSUPPORTED") text = error.message;
        else if (error.code === "NOT_LINKED") text = "This browser isn't linked to your encryption identity yet, so it can't send encrypted messages.";
        else if (error.code === "NOT_READY") text = "End-to-end encryption is unavailable right now, so your message wasn't sent.";
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
        const lock = document.createElement("span");
        lock.className = "fe2ee-lock";
        lock.dataset.state = info.state;
        const label = info.state === "decrypted" ? "End-to-end encrypted" : `Couldn't decrypt: ${info.reason ?? "unknown error"}`;
        lock.title = label;
        lock.innerHTML = svg(info.state === "decrypted" ? LOCK_PATH : OPEN_LOCK_PATH, label);
        content.append(lock);
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
      if (transient && transient.until > Date.now()) banner("transient", "warning", transient.text);
      else dropBanner("transient");
      if (channelId && engine2.isEncrypted(channelId) && members?.channelId === channelId) {
        const changed = members.list.find((m) => engine2.contacts[m.id]?.pendingKey);
        if (changed)
          banner("changed", "warning", `${memberName(changed)}'s safety number changed. Sending is paused until you review it.`, {
            label: "Review",
            run: () => showSafety(channelId)
          });
        else dropBanner("changed");
        if (!engine2.linked && !failure2)
          banner("linked", "warning", "This browser isn't linked to your encryption identity yet, so it can't read or send encrypted messages here.");
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
  var ui = createUi({
    engine,
    states,
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
  var hooks = createHooks({
    engine,
    ready,
    states,
    failClosed: () => failure !== null,
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
      ui.refresh();
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
  var custom = {
    E2EE_DEVICES_UPDATE: (data) => {
      count("E2EE_DEVICES_UPDATE");
      engine.invalidateUser(String(data.user_id));
      ui.refresh();
    },
    E2EE_IDENTITY_UPDATE: (data) => {
      count("E2EE_IDENTITY_UPDATE");
      engine.invalidateUser(String(data.user_id));
      ui.refresh();
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
    hooks: { ...installed },
    encryptedChannels: [...engine.encryptedChannels],
    states: Object.fromEntries(states),
    received: { ...received }
  });
  tick();
})();
