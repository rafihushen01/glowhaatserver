const crypto = require("crypto");

const normalizeSecret = (value = "") => String(value || "").trim();

const getKey = () => {
  const direct = normalizeSecret(process.env.CHAT_ENCRYPTION_KEY);
  if (direct) return crypto.createHash("sha256").update(direct).digest();

  const fallback = normalizeSecret(process.env.JWT_SECRET || process.env.MONGO_URL || "khancosmetics-chat-secret");
  return crypto.createHash("sha256").update(fallback).digest();
};

const encryptChatText = (plainText = "") => {
  const text = String(plainText || "");
  if (!text) return { cipher: "", iv: "", tag: "" };

  const iv = crypto.randomBytes(12);
  const key = getKey();
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    cipher: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
  };
};

const decryptChatText = ({ cipher = "", iv = "", tag = "" } = {}) => {
  if (!cipher || !iv || !tag) return "";

  try {
    const key = getKey();
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    const decrypted = Buffer.concat([decipher.update(Buffer.from(cipher, "base64")), decipher.final()]);
    return decrypted.toString("utf8");
  } catch {
    return "";
  }
};

module.exports = {
  encryptChatText,
  decryptChatText,
};
