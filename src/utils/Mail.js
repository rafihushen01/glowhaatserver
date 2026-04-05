const nodemailer = require("nodemailer");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

const smtpUser = String(
  process.env.OTP_GMAIL || process.env.SMTP_USER || process.env.EMAIL_USER || ""
).trim();
const smtpPass = String(
  process.env.OTP_GMAIL_APP_PASS || process.env.SMTP_PASS || process.env.EMAIL_PASS || ""
)
  .trim()
  .replace(/\s+/g, "");

if (!smtpUser || !smtpPass) {
  console.error("SMTP credentials missing. Set OTP_GMAIL/OTP_GMAIL_APP_PASS in backend .env");
}

const createTransporter = ({ secure, port, requireTLS = false }) =>
  nodemailer.createTransport({
    host: "smtp.gmail.com",
    port,
    secure,
    requireTLS,
    pool: false,
    connectionTimeout: Number(process.env.SMTP_CONNECTION_TIMEOUT_MS) || 20000,
    greetingTimeout: Number(process.env.SMTP_GREETING_TIMEOUT_MS) || 20000,
    socketTimeout: Number(process.env.SMTP_SOCKET_TIMEOUT_MS) || 30000,
    auth: {
      user: smtpUser,
      pass: smtpPass,
    },
  });

const primaryTransporter = createTransporter({ secure: true, port: 465 });
const fallbackTransporter = createTransporter({ secure: false, port: 587, requireTLS: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isRetryableMailError = (error) => {
  const retryableCodes = new Set([
    "ETIMEDOUT",
    "ECONNECTION",
    "ESOCKET",
    "ECONNRESET",
    "EAI_AGAIN",
  ]);

  const code = String(error?.code || "").toUpperCase();
  return retryableCodes.has(code) || Number(error?.responseCode) >= 500;
};

const buildMailError = (message, code, cause) => {
  const error = new Error(message);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
};

const sendWithRetries = async (transporter, mailOptions, maxAttempts, label) => {
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await transporter.sendMail(mailOptions);
    } catch (error) {
      lastError = error;
      const shouldRetry = attempt < maxAttempts && isRetryableMailError(error);
      if (!shouldRetry) break;
      await sleep(250 * attempt);
    }
  }

  if (lastError) {
    lastError.message = `[${label}] ${lastError.message}`;
  }
  throw lastError;
};

const sendMailInternal = async (type, to, otp) => {
  if (!to) {
    throw new Error("Recipient email missing");
  }

  if (!otp) {
    throw new Error("OTP missing");
  }

  if (!smtpUser || !smtpPass) {
    throw buildMailError("SMTP credentials are missing", "SMTP_NOT_CONFIGURED");
  }

  const mailOptions = {
    from: `KhanCosmetics Security Team <${smtpUser}>`,
    to,
    subject: `KhanCosmetics ${type} OTP - ${otp}`,
    html: `
      <div>
        <h2>Do NOT share your OTP</h2>
        <h1 style="color:green">${otp}</h1>
        <p>Valid for 5 minutes</p>
        <hr/>
        <small>Server Time: ${new Date().toISOString()}</small>
      </div>
    `,
  };

  try {
    return await sendWithRetries(primaryTransporter, mailOptions, 3, "smtp-465");
  } catch (primaryError) {
    try {
      return await sendWithRetries(fallbackTransporter, mailOptions, 2, "smtp-587");
    } catch (fallbackError) {
      const combinedMessage = fallbackError?.message || primaryError?.message || "SMTP send failed";
      const responseCode = Number(fallbackError?.responseCode || primaryError?.responseCode || 0);
      if (responseCode === 535 || responseCode === 534) {
        throw buildMailError(
          "SMTP authentication failed. Regenerate Gmail App Password and redeploy.",
          "SMTP_AUTH_FAILED",
          fallbackError
        );
      }
      throw buildMailError(combinedMessage, fallbackError?.code || primaryError?.code || "SMTP_SEND_FAILED", fallbackError);
    }
  }
};

exports.sendSignupOtp = async (to, otp) => {
  return await sendMailInternal("Signup", to, otp);
};

exports.sendSigninOtp = async (to, otp) => {
  return await sendMailInternal("Signin", to, otp);
};
