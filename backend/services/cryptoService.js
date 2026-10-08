const crypto = require('crypto');
const LZString = require('lz-string');
const bcrypt = require('bcryptjs');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // For AES-GCM
const AUTH_TAG_LENGTH = 16;

// Key management helper
function getSecretKey() {
  const envKey = process.env.ENCRYPTION_KEY || 'default_secret_key_32_bytes_len!!';
  return crypto.createHash('sha256').update(envKey).digest();
}

/**
 * Compresses JSON object to base64, then encrypts using AES-256-GCM.
 */
function encryptPayload(dataObj) {
  try {
    const jsonStr = JSON.stringify(dataObj);
    const compressed = LZString.compressToBase64(jsonStr);
    const key = getSecretKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    
    let encrypted = cipher.update(compressed, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');

    return {
      iv: iv.toString('hex'),
      authTag,
      encryptedData: encrypted,
      payloadSize: encrypted.length
    };
  } catch (error) {
    throw new Error('Payload encryption failed.');
  }
}

/**
 * Decrypts AES-256-GCM encrypted data and decompresses LZ-string.
 */
function decryptPayload({ iv, authTag, encryptedData }) {
  try {
    const key = getSecretKey();
    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      key,
      Buffer.from(iv, 'hex')
    );
    decipher.setAuthTag(Buffer.from(authTag, 'hex'));

    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    const decompressed = LZString.decompressFromBase64(decrypted);
    if (!decompressed) {
      throw new Error('Decompression failed.');
    }
    return JSON.parse(decompressed);
  } catch (error) {
    throw new Error('Decryption or payload verification failed.');
  }
}

/**
 * Hashes a 6-digit PIN securely using bcrypt.
 */
async function hashPIN(pin) {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(pin, salt);
}

/**
 * Verifies a 6-digit PIN against hash.
 */
async function verifyPIN(pin, hashedPin) {
  return bcrypt.compare(pin, hashedPin);
}

module.exports = {
  encryptPayload,
  decryptPayload,
  hashPIN,
  verifyPIN
};
