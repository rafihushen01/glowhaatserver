const rateLimit = require("express-rate-limit");

const otpLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many OTP requests. Please wait and try again." },
});

module.exports = { otpLimiter };

