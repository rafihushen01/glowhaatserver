// mail.js
const nodemailer = require("nodemailer");
require("dotenv").config();

/*
=====================================================
 ULTRA DEBUG TRANSPORTER
=====================================================
*/

console.log("🚀 MAIL SYSTEM BOOTING...");
const smtpUser = process.env.OTP_GMAIL ;
const smtpPass = process.env.OTP_GMAIL_APP_PASS ;

console.log("GMAIL USER:", smtpUser);

if (!smtpUser || !smtpPass) {
  console.error("SMTP credentials missing. Set OTP_GMAIL/OTP_GMAIL_APP_PASS or DAMASK_EMAIL/DAMASK_APP_PASS in .env");
}

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  logger: true,
  debug: true,
  auth: {
    user: smtpUser,
    pass: smtpPass,
  },
});

/*
=====================================================
 VERIFY CONNECTION ON START
=====================================================
*/

transporter.verify((error, success) => {
  console.log("🔎 VERIFY CHECK RUNNING...");
  if (error) {
    console.error("❌ SMTP CONNECTION FAILED:");
    console.error(error);
  } else {
    console.log("✅ SMTP CONNECTION VERIFIED");
  }
});

/*
=====================================================
 CORE SEND FUNCTION (Internal)
=====================================================
*/

const sendMailInternal = async (type, to, otp) => {
  console.log("--------------------------------------------------");
  console.log("📩 MAIL FUNCTION TRIGGERED");
  console.log("TYPE:", type);
  console.log("TO:", to);
  console.log("OTP:", otp);

  if (!to) {
    console.error("❌ ERROR: Recipient (to) is missing!");
    throw new Error("Recipient email missing");
  }

  if (!otp) {
    console.error("❌ ERROR: OTP missing!");
    throw new Error("OTP missing");
  }

  try {
    console.log("🚀 Sending Email Through SMTP...");

    const info = await transporter.sendMail({
      from: `EduBeast Security Team <${smtpUser}>`,
      to,
      subject: `EduBeast ${type} OTP - ${otp}`,
      html: `
        <div>
          <h2>Do NOT share your OTP</h2>
          <h1 style="color:red">${otp}</h1>
          <p>Valid for 5 minutes</p>
          <hr/>
          <small>Server Time: ${new Date().toISOString()}</small>
        </div>
      `,
    });

    console.log("✅ EMAIL SENT SUCCESSFULLY");
    console.log("📦 Message ID:", info.messageId);
    console.log("📦 Accepted:", info.accepted);
    console.log("📦 Rejected:", info.rejected);
    console.log("📦 Response:", info.response);
    console.log("--------------------------------------------------");

    return info;
  } catch (error) {
    console.error("❌ SENDMAIL FAILED");
    console.error("FULL ERROR OBJECT:");
    console.error(error);
    console.error("Stack:", error.stack);
    throw error;
  }
};

/*
=====================================================
 EXPORTED FUNCTIONS
=====================================================
*/

exports.sendSignupOtp = async (to, otp) => {
  console.log("🔥 sendSignupOtp() CALLED");
  return await sendMailInternal("Signup", to, otp);
};

exports.sendSigninOtp = async (to, otp) => {
  console.log("🔥 sendSigninOtp() CALLED");
  return await sendMailInternal("Signin", to, otp);
};
