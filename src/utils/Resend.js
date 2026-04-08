const path = require("path")
const dotenv = require("dotenv")
const { Resend } = require("resend")

dotenv.config({ path: path.resolve(__dirname, "../../.env") })

const resendApiKey = process.env.RESEND_API_KEY
const resendFromEmail = String(
  process.env.RESEND_FROM_EMAIL ||
    process.env.RESEND_SENDER_EMAIL ||
    process.env.RESEND_FROM ||
    "onboarding@resend.dev"
).trim()
const resendFromName = String(process.env.RESEND_FROM_NAME || "KhanCosmetics Security Team").trim()
const resendReplyTo = String(
  process.env.RESEND_REPLY_TO || process.env.OTP_GMAIL || resendFromEmail
).trim()

const resendClient = resendApiKey ? new Resend(resendApiKey) : null

const normalizeResendError = (error) => {
  const message =
    error?.message ||
    error?.error?.message ||
    error?.name ||
    "Resend email sending failed"

  const normalized = new Error(message)
  normalized.code =
    error?.code ||
    error?.statusCode ||
    error?.error?.code ||
    "RESEND_SEND_FAILED"
  normalized.statusCode = error?.statusCode || error?.error?.statusCode
  normalized.cause = error
  return normalized
}

const isResendConfigured = () => Boolean(resendClient)

const sendWithResend = async ({
  to,
  subject,
  html,
  text,
  fromEmail = resendFromEmail,
  fromName = resendFromName,
  replyTo = resendReplyTo,
  tags,
}) => {
  if (!isResendConfigured()) {
    const error = new Error("Resend API key missing")
    error.code = "RESEND_NOT_CONFIGURED"
    throw error
  }

  if (!to || !subject || (!html && !text)) {
    const error = new Error("Resend mail payload missing")
    error.code = "RESEND_PAYLOAD_INVALID"
    throw error
  }

  try {
    const response = await resendClient.emails.send({
      from: `${fromName} <${fromEmail}>`,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      text,
      replyTo: replyTo || undefined,
      tags: Array.isArray(tags) ? tags : undefined,
    })

    if (response?.error) {
      throw response.error
    }

    return {
      provider: "resend",
      id: response?.data?.id || response?.id || null,
      raw: response,
    }
  } catch (error) {
    throw normalizeResendError(error)
  }
}

module.exports = {
  isResendConfigured,
  normalizeResendError,
  sendWithResend,
}
