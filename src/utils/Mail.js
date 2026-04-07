const nodemailer = require("nodemailer")
const dotenv = require("dotenv")

dotenv.config()

const smtpUser = process.env.OTP_GMAIL
const smtpPass = process.env.OTP_GMAIL_APP_PASS

if (!smtpUser || !smtpPass) {
  console.error("SMTP credentials missing in ENV")
}

const createTransporter = () => {
  return nodemailer.createTransport({
    host: "smtp.gmail.com",

    // STARTTLS recommended for stability
    port: 587,
    secure: false,

    pool: true,
    maxConnections: 10,
    maxMessages: 500,

    auth: {
      user: smtpUser,
      pass: smtpPass,
    },

    // Force IPv4 (fixes Render IPv6 SMTP issue)
    family: 4,

    connectionTimeout: 20000,
    greetingTimeout: 15000,
    socketTimeout: 20000,

    tls: {
      rejectUnauthorized: false,
    },
  })
}

let transporter = createTransporter()

// verify SMTP connection on startup
transporter.verify((error) => {
  if (error) {
    console.error("SMTP verification failed:", error.message)
  } else {
    console.log("SMTP server ready")
  }
})

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

  return normalized
}

const recreateTransporter = () => {
  console.log("Recreating SMTP transporter connection")
  transporter = createTransporter()
}

const sendWithRetry = async (mailOptions, retries = 5) => {
  let lastError

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const result = await transporter.sendMail(mailOptions)
      return result
    } catch (error) {
      lastError = normalizeMailError(error)

      console.error(`Mail attempt ${attempt} failed:`, lastError.code)

      recreateTransporter()

      if (attempt < retries) {
        await sleep(1000 * attempt)
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

exports.sendSellerSignupOtp = async (to, otp) => {
  return await sendOtpMail("Seller Signup", to, otp)
}

const sendCustomMail = async ({ to, subject, html }) => {
  if (!smtpUser || !smtpPass) {
    const error = new Error("SMTP credentials missing")
    error.code = "SMTP_NOT_CONFIGURED"
    throw error
  }

  if (!to || !subject || !html) {
    throw new Error("Mail payload missing")
  }

  const mailOptions = {
    from: `KhanCosmetics Team <${smtpUser}>`,
    to,
    subject,
    html,
  }

  return await sendWithRetry(mailOptions)
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