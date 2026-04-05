const nodemailer = require("nodemailer")
const dotenv = require("dotenv")

dotenv.config()

const smtpUser = process.env.OTP_GMAIL
const smtpPass = process.env.OTP_GMAIL_APP_PASS

if (!smtpUser || !smtpPass) {
  console.error("❌ SMTP credentials missing in ENV")
}

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true,

  auth: {
    user: smtpUser,
    pass: smtpPass,
  },

  connectionTimeout: 20000,
  greetingTimeout: 20000,
  socketTimeout: 30000,

  tls: {
    rejectUnauthorized: false,
  },
})

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const sendWithRetry = async (mailOptions, retries = 3) => {

  let lastError

  for (let i = 1; i <= retries; i++) {

    try {

      const info = await transporter.sendMail(mailOptions)

      return info

    } catch (error) {

      lastError = error
      console.error(`Mail attempt ${i} failed`)

      if (i < retries) {
        await sleep(500 * i)
      }

    }

  }

  throw lastError
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

    await transporter.verify()

    const result = await sendWithRetry(mailOptions)

    return result

  } catch (error) {

    console.error("❌ OTP MAIL ERROR:", error)

    throw new Error("OTP email sending failed")

  }

}

exports.sendSignupOtp = async (to, otp) => {

  return await sendOtpMail("Signup", to, otp)

}

exports.sendSigninOtp = async (to, otp) => {

  return await sendOtpMail("Signin", to, otp)

}