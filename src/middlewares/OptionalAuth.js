const jwt = require("jsonwebtoken");
const dotenv = require("dotenv");

dotenv.config();

const secretkey = process.env.SECRETKEY;

const optionalauth = async (req, _res, next) => {
  try {
    const token = req.cookies?.token;
    if (!token) return next();

    const decoded = jwt.verify(token, secretkey);
    req.user = decoded;
    return next();
  } catch (_error) {
    return next();
  }
};

module.exports = optionalauth;

