const nodemailer = require("nodemailer");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

const smtpUser = String(process.env.OTP_GMAIL || "").trim();
const smtpPass = String(process.env.OTP_GMAIL_APP_PASS || "").trim();

if (!smtpUser || !smtpPass) {
  console.error("SMTP credentials missing. Set OTP_GMAIL/OTP_GMAIL_APP_PASS or DAMASK_EMAIL/DAMASK_APP_PASS in .env");
}

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  pool: true,
  maxConnections: 5,
  maxMessages: 100,
  connectionTimeout: Number(process.env.SMTP_CONNECTION_TIMEOUT_MS) || 20000,
  greetingTimeout: Number(process.env.SMTP_GREETING_TIMEOUT_MS) || 20000,
  socketTimeout: Number(process.env.SMTP_SOCKET_TIMEOUT_MS) || 30000,
  auth: {
    user: smtpUser,
    pass: smtpPass,
  },
});

const sendMailInternal = async (type, to, otp) => {
  if (!to) {
    throw new Error("Recipient email missing");
  }

  if (!otp) {
    throw new Error("OTP missing");
  }

  return transporter.sendMail({
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
  });
};

exports.sendSignupOtp = async (to, otp) => {
  return await sendMailInternal("Signup", to, otp);
};

exports.sendSigninOtp = async (to, otp) => {
  return await sendMailInternal("Signin", to, otp);
};
