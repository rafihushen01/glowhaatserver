const nodemailer = require("nodemailer")
const dotenv = require("dotenv")

dotenv.config()

const smtpUser = process.env.OTP_GMAIL
const smtpPass = process.env.OTP_GMAIL_APP_PASS

if (!smtpUser || !smtpPass) {
  console.error("SMTP credentials missing in ENV")
}

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  pool: true,
  maxConnections: 5,
  maxMessages: 100,
  auth: {
    user: smtpUser,
    pass: smtpPass,
  },
  connectionTimeout: 6000,
  greetingTimeout: 6000,
  socketTimeout: 7000,
  tls: {
    rejectUnauthorized: false,
  },
})

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const normalizeMailError = (error) => {
  const normalized = new Error(error?.message || "OTP email sending failed")
  normalized.code =
    error?.code ||
    error?.responseCode ||
    (/(auth|invalid login|username and password not accepted)/i.test(String(error?.message || ""))
      ? "SMTP_AUTH_FAILED"
      : "SMTP_SEND_FAILED")
  return normalized
}

const sendWithRetry = async (mailOptions, retries = 2) => {
  let lastError

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      return await transporter.sendMail(mailOptions)
    } catch (error) {
      lastError = normalizeMailError(error)
      console.error(`Mail attempt ${attempt} failed:`, lastError.code)

      if (attempt < retries) {
        await sleep(300 * attempt)
      }
    }
  }

  throw lastError
}

const sendOtpMail = async (type, to, otp) => {
  if (!smtpUser || !smtpPass) {
    const error = new Error("SMTP credentials missing")
    error.code = "SMTP_NOT_CONFIGURED"
    throw error
  }

  if (!to) {
    throw new Error("Recipient email missing")
  }

  if (!otp) {
    throw new Error("OTP missing")
  }

  const mailOptions = {
    from: `KhanCosmetics Security <${smtpUser}>`,
    to,
    subject: `KhanCosmetics ${type} OTP Verification`,
    html: `
      <div style="
        font-family: Arial;
        max-width:600px;
        margin:auto;
        padding:20px;
        border:1px solid #eee;
        border-radius:10px;
      ">
        <h2 style="color:#1a1a1a">KhanCosmetics Security Code</h2>
        <p>Use the OTP below to complete your <b>${type}</b> process.</p>
        <div style="
          font-size:38px;
          font-weight:bold;
          letter-spacing:8px;
          color:green;
          margin:20px 0;
        ">
          ${otp}
        </div>
        <p>This OTP will expire in <b>5 minutes</b>.</p>
        <p style="color:red">
          Never share this code with anyone.
        </p>
        <hr/>
        <small>
          Generated at: ${new Date().toISOString()}
        </small>
      </div>
    `,
  }

  try {
    return await sendWithRetry(mailOptions)
  } catch (error) {
    const normalizedError = normalizeMailError(error)
    console.error("OTP MAIL ERROR:", normalizedError.code, normalizedError.message)
    throw normalizedError
  }
}

exports.sendSignupOtp = async (to, otp) => {
  return await sendOtpMail("Signup", to, otp)
}

exports.sendSigninOtp = async (to, otp) => {
  return await sendOtpMail("Signin", to, otp)
}
