const path = require("path")
const nodemailer = require("nodemailer")
const dotenv = require("dotenv")
const { isResendConfigured, sendWithResend } = require("./Resend.js")

dotenv.config({ path: path.resolve(__dirname, "../../.env") })

const smtpUser = process.env.OTP_GMAIL
const smtpPass = process.env.OTP_GMAIL_APP_PASS
const resendEnabled = isResendConfigured()

if (!smtpUser || !smtpPass) {
  console.error("SMTP credentials missing in ENV")
}

if (!resendEnabled) {
  console.warn("Resend fallback is not configured")
}

const toBoolean = (value, fallback) => {
  if (value === undefined) return fallback
  return String(value).trim().toLowerCase() === "true"
}

const smtpCandidates = (() => {
  const configuredHost = process.env.OTP_SMTP_HOST || process.env.SMTP_HOST
  const configuredPort = Number(process.env.OTP_SMTP_PORT || process.env.SMTP_PORT || 0)

  if (configuredHost && configuredPort > 0) {
    return [
      {
        name: "custom-smtp",
        host: configuredHost,
        port: configuredPort,
        secure: toBoolean(
          process.env.OTP_SMTP_SECURE || process.env.SMTP_SECURE,
          configuredPort === 465
        ),
      },
    ]
  }

  return [
    // Gmail SSL is often more stable in cloud runtimes where STARTTLS can stall.
 { name: "gmail-ssl", host: "74.125.24.108", port: 465, secure: true },
{ name: "gmail-starttls", host: "74.125.24.108", port: 587, secure: false },
  ]
})()

const createTransporter = (candidate) => {
  return nodemailer.createTransport({
    host: candidate.host,
    port: candidate.port,
    secure: candidate.secure,
    requireTLS: !candidate.secure,

    auth: {
      user: smtpUser,
      pass: smtpPass,
    },

    pool: false,
    family: 4,

    connectionTimeout: 20000,
    greetingTimeout: 10000,
    socketTimeout: 20000,

    tls: {
      rejectUnauthorized: true,
      minVersion: "TLSv1.2",
      servername: "smtp.gmail.com"
    }
  })
}

let currentTransportIndex = 0
let transporter = createTransporter(smtpCandidates[currentTransportIndex])

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const normalizeMailError = (error) => {
  const normalized = new Error(error?.message || "OTP email sending failed")
  normalized.code =
    error?.code ||
    error?.responseCode ||
    (/(auth|invalid login|username and password not accepted)/i.test(
      String(error?.message || "")
    )
      ? "SMTP_AUTH_FAILED"
      : "SMTP_SEND_FAILED")
  normalized.responseCode = error?.responseCode
  normalized.provider = error?.provider
  return normalized
}

const normalizeFallbackError = (smtpError, resendError) => {
  const normalized = new Error(
    `SMTP failed (${smtpError?.code || "SMTP_SEND_FAILED"}) and Resend failed (${resendError?.code || "RESEND_SEND_FAILED"})`
  )
  normalized.code = "MAIL_DELIVERY_FAILED"
  normalized.smtpError = smtpError
  normalized.resendError = resendError
  return normalized
}

const isAuthError = (error) => {
  if (!error) return false
  const message = String(error.message || "")
  return (
    error.code === "EAUTH" ||
    error.code === "SMTP_AUTH_FAILED" ||
    error.responseCode === 535 ||
    /auth|invalid login|username and password not accepted/i.test(message)
  )
}

const isTransientError = (error) => {
  if (!error) return false
  const transientCodes = new Set([
    "ESOCKET",
    "ETIMEDOUT",
    "ECONNECTION",
    "ECONNRESET",
    "EHOSTUNREACH",
    "ENETUNREACH",
    "EAI_AGAIN",
    "ENOTFOUND",
  ])
  return transientCodes.has(error.code) || [421, 425, 429, 450, 451, 452].includes(error.responseCode)
}

const rotateTransporter = () => {
  currentTransportIndex = (currentTransportIndex + 1) % smtpCandidates.length
  const nextCandidate = smtpCandidates[currentTransportIndex]
  transporter = createTransporter(nextCandidate)
  console.warn(
    `Switching SMTP transport to ${nextCandidate.name} (${nextCandidate.host}:${nextCandidate.port})`
  )
}

const refreshCurrentTransporter = () => {
  const current = smtpCandidates[currentTransportIndex]
  transporter = createTransporter(current)
  console.warn(`Refreshing SMTP transport ${current.name} (${current.host}:${current.port})`)
}

const sendWithRetry = async (mailOptions, retries = 5) => {
  let lastError

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      return await transporter.sendMail(mailOptions)
    } catch (error) {
      lastError = normalizeMailError(error)
      console.error(`Mail attempt ${attempt} failed:`, lastError.code, lastError.message)

      if (isAuthError(lastError)) {
        // Auth failures are permanent until credentials are fixed.
        break
      }

      if (smtpCandidates.length > 1 && attempt % 2 === 1) {
        rotateTransporter()
      } else {
        refreshCurrentTransporter()
      }

      if (attempt < retries && isTransientError(lastError)) {
        await sleep(800 * attempt)
      } else if (attempt < retries) {
        await sleep(400 * attempt)
      }
    }
  }

  throw lastError || new Error("OTP email sending failed")
}

const sendViaSmtpThenResend = async (mailOptions, resendOptions = {}) => {
  let smtpError = null

  if (smtpUser && smtpPass) {
    try {
      const smtpResult = await sendWithRetry(mailOptions)
      return {
        provider: "smtp",
        raw: smtpResult,
      }
    } catch (error) {
      smtpError = normalizeMailError(error)
      console.error(
        "Primary SMTP delivery failed. Trying Resend fallback:",
        smtpError.code,
        smtpError.message
      )
    }
  } else {
    smtpError = new Error("SMTP credentials missing")
    smtpError.code = "SMTP_NOT_CONFIGURED"
    console.error("SMTP unavailable. Trying Resend fallback:", smtpError.code)
  }

  if (!resendEnabled) {
    throw smtpError
  }

  try {
    return await sendWithResend({
      to: resendOptions.to || mailOptions.to,
      subject: resendOptions.subject || mailOptions.subject,
      html: resendOptions.html || mailOptions.html,
      text: resendOptions.text,
      tags: resendOptions.tags,
    })
  } catch (resendError) {
    console.error("Resend fallback failed:", resendError.code, resendError.message)
    throw normalizeFallbackError(smtpError, resendError)
  }
}

const sendOtpMail = async (type, to, otp) => {
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
    return await sendViaSmtpThenResend(mailOptions, {
      text: `${type} OTP: ${otp}. This code expires in 5 minutes.`,
      tags: [
        { name: "category", value: "otp" },
        { name: "type", value: String(type || "general").toLowerCase().replace(/\s+/g, "-") },
      ],
    })
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

exports.sendSellerSignupOtp = async (to, otp) => {
  return await sendOtpMail("Seller Signup", to, otp)
}

const sendCustomMail = async ({ to, subject, html }) => {
  if (!to || !subject || !html) {
    throw new Error("Mail payload missing")
  }

  const mailOptions = {
    from: `KhanCosmetics Team <${smtpUser}>`,
    to,
    subject,
    html,
  }

  return await sendViaSmtpThenResend(mailOptions, {
    tags: [{ name: "category", value: "transactional" }],
  })
}

exports.sendSellerRequestSubmittedMail = async (to, { fullname, businessname }) => {
  return await sendCustomMail({
    to,
    subject: "KhanCosmetics Seller Request Received",
    html: `
      <div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;padding:20px;border:1px solid #e6efe9;border-radius:12px;">
        <h2 style="color:#14532d;margin:0 0 10px 0;">Your Seller Request Is In Review</h2>
        <p>Hello <b>${fullname || "Partner"}</b>,</p>
        <p>We received your seller onboarding request for <b>${businessname || "your business"}</b>.</p>
        <p>Our verification team will review your credentials shortly.</p>
        <p style="margin-top:16px;color:#4b5563;">Thanks for choosing KhanCosmetics.</p>
      </div>
    `,
  })
}

exports.sendSellerStatusUpdateMail = async (to, { status, rejectreason }) => {
  const normalizedStatus = String(status || "").trim()

  const body =
    normalizedStatus === "Approved"
      ? "<p>Congratulations. Your seller profile is now approved and verified.</p>"
      : `<p>Your seller request was not approved at this time.</p><p><b>Reason:</b> ${rejectreason || "Not specified"}</p>`

  return await sendCustomMail({
    to,
    subject: `KhanCosmetics Seller Request ${normalizedStatus || "Update"}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;padding:20px;border:1px solid #e6efe9;border-radius:12px;">
        <h2 style="color:#14532d;margin:0 0 10px 0;">Seller Verification Update</h2>
        ${body}
        <p style="margin-top:16px;color:#4b5563;">You can visit the seller section in KhanCosmetics to view details.</p>
      </div>
    `,
  })
}

exports.sendSellerRequestAlertToSuperAdmin = async (to, payload = {}) => {
  return await sendCustomMail({
    to,
    subject: "New Seller Request Received",
    html: `
      <div style="font-family:Arial,sans-serif;max-width:700px;margin:auto;padding:20px;border:1px solid #e6efe9;border-radius:12px;">
        <h2 style="color:#14532d;margin:0 0 10px 0;">New Seller Application</h2>
        <p>A new seller request has been submitted in KhanCosmetics.</p>
        <ul>
          <li><b>Name:</b> ${payload.fullname || ""}</li>
          <li><b>Email:</b> ${payload.email || ""}</li>
          <li><b>Mobile:</b> ${payload.mobile || ""}</li>
          <li><b>WhatsApp:</b> ${payload.whatsapp || ""}</li>
          <li><b>Business:</b> ${payload.businessname || ""}</li>
          <li><b>Business Gmail:</b> ${payload.businessgmail || ""}</li>
          <li><b>Business Phone:</b> ${payload.businessphone || ""}</li>
          <li><b>Store Type:</b> ${payload.storetype || ""}</li>
          <li><b>Business Model:</b> ${payload.businessmodel || ""}</li>
          <li><b>Preferred Categories:</b> ${payload.preferredcategories || ""}</li>
          <li><b>Pickup District:</b> ${payload.pickupdistrict || ""}</li>
          <li><b>Pickup City:</b> ${payload.pickupcity || ""}</li>
          <li><b>Pickup Area:</b> ${payload.pickuparea || ""}</li>
          <li><b>Deliveryman Phone:</b> ${payload.deliverymanphone || ""}</li>
        </ul>
        <p>Review it from SuperAdmin seller request dashboard.</p>
      </div>
    `,
  })
}

exports.sendSellerSponsorshipStatusMail = async (to, { status, days, rejectreason }) => {
  const approved = String(status) === "Verified";
  return await sendCustomMail({
    to,
    subject: `KhanCosmetics Sponsorship ${approved ? "Verified" : "Rejected"}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;padding:20px;border:1px solid #e6efe9;border-radius:12px;">
        <h2 style="color:#14532d;margin:0 0 10px 0;">Sponsorship Update</h2>
        ${
          approved
            ? `<p>Your sponsorship is verified and active for <b>${Number(days || 0)} days</b>.</p>`
            : `<p>Your sponsorship request was rejected.</p><p><b>Reason:</b> ${rejectreason || "Invalid payment proof."}</p>`
        }
      </div>
    `,
  })
}

exports.sendSellerCommissionReminderMail = async (to, { amount, dueat, bikash }) => {
  return await sendCustomMail({
    to,
    subject: "KhanCosmetics Commission Due Reminder",
    html: `
      <div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;padding:20px;border:1px solid #e6efe9;border-radius:12px;">
        <h2 style="color:#14532d;margin:0 0 10px 0;">Monthly Commission Due</h2>
        <p>Your due commission amount is <b>৳${Number(amount || 0).toFixed(2)}</b>.</p>
        <p>Please send payment to bKash: <b>${bikash || "01862623066"}</b></p>
        <p>Due date: <b>${dueat ? new Date(dueat).toLocaleString() : "within 4 days"}</b></p>
      </div>
    `,
  })
}

exports.sendSellerCommissionStatusMail = async (to, { status, rejectreason }) => {
  const verified = String(status) === "Verified";
  return await sendCustomMail({
    to,
    subject: `KhanCosmetics Commission Payment ${verified ? "Verified" : "Rejected"}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;padding:20px;border:1px solid #e6efe9;border-radius:12px;">
        <h2 style="color:#14532d;margin:0 0 10px 0;">Commission Payment Status</h2>
        ${
          verified
            ? "<p>Thanks for your payment. Your seller dashboard is now active again.</p>"
            : `<p>Your payment proof was rejected.</p><p><b>Reason:</b> ${rejectreason || "Invalid payment proof."}</p>`
        }
      </div>
    `,
  })
}
