const crypto = require('node:crypto');

const DEFAULT_JWT_SECRET = 'hera-saas-secret-key-2026';

/**
 * Genera un hash criptográfico seguro para una contraseña usando scrypt nativo.
 * Formato resultante: scrypt$<salt>$<hash>
 *
 * @param {string} password
 * @returns {string}
 */
function hashPassword(password) {
  if (!password || typeof password !== 'string') {
    throw new Error('La contraseña debe ser una cadena no vacía.');
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

/**
 * Verifica una contraseña en texto plano contra un hash almacenado scrypt.
 * Resistente a ataques de temporización (timing attacks).
 *
 * @param {string} password
 * @param {string} storedHash
 * @returns {boolean}
 */
function verifyPassword(password, storedHash) {
  if (!password || !storedHash || typeof storedHash !== 'string') {
    return false;
  }

  const parts = storedHash.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') {
    return false;
  }

  const [, salt, expectedHashHex] = parts;
  if (!salt || !expectedHashHex) {
    return false;
  }

  try {
    const calcHashHex = crypto.scryptSync(password, salt, 64).toString('hex');
    const calcBuffer = Buffer.from(calcHashHex, 'hex');
    const expectedBuffer = Buffer.from(expectedHashHex, 'hex');

    if (calcBuffer.length !== expectedBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(calcBuffer, expectedBuffer);
  } catch (_) {
    return false;
  }
}

/**
 * Firma un token JWT estándar HS256 sin librerías externas.
 *
 * @param {Object} payload
 * @param {number} [expiresInSec=604800] - Tiempo de vida en segundos (por defecto 7 días)
 * @returns {string}
 */
function signJwt(payload, expiresInSec = 86400 * 7) {
  const secret = process.env.JWT_SECRET || DEFAULT_JWT_SECRET;
  const header = { alg: 'HS256', typ: 'JWT' };

  const nowSec = Math.floor(Date.now() / 1000);
  const jwtPayload = {
    ...payload,
    iat: nowSec,
    exp: nowSec + expiresInSec
  };

  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(jwtPayload)).toString('base64url');
  const data = `${encodedHeader}.${encodedPayload}`;

  const signature = crypto.createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${signature}`;
}

/**
 * Verifica y decodifica un token JWT HS256 nativo.
 * Retorna el payload si es válido y no ha expirado, o null en caso contrario.
 *
 * @param {string} token
 * @returns {Object|null}
 */
function verifyJwt(token) {
  if (!token || typeof token !== 'string') {
    return null;
  }

  const parts = token.trim().split('.');
  if (parts.length !== 3) {
    return null;
  }

  const [encodedHeader, encodedPayload, signature] = parts;
  const secret = process.env.JWT_SECRET || DEFAULT_JWT_SECRET;
  const data = `${encodedHeader}.${encodedPayload}`;

  try {
    const expectedSignature = crypto.createHmac('sha256', secret).update(data).digest('base64url');

    const sigBuf = Buffer.from(signature);
    const expSigBuf = Buffer.from(expectedSignature);

    if (sigBuf.length !== expSigBuf.length || !crypto.timingSafeEqual(sigBuf, expSigBuf)) {
      return null;
    }

    const payloadJson = Buffer.from(encodedPayload, 'base64url').toString('utf8');
    const payload = JSON.parse(payloadJson);

    const nowSec = Math.floor(Date.now() / 1000);
    if (payload.exp && nowSec > payload.exp) {
      return null; // Expirado
    }

    return payload;
  } catch (_) {
    return null;
  }
}

module.exports = {
  hashPassword,
  verifyPassword,
  signJwt,
  verifyJwt
};
