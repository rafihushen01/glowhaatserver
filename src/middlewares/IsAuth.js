const jwt = require("jsonwebtoken");
const dotenv = require("dotenv");
dotenv.config();
const secretkey = process.env.SECRETKEY;

const isauth = async (req, res, next) => {
  try {
    const token = req.cookies?.token;
   
  
    if (!token) {
      return res.status(401).json({ message: "Unauthorized access" });
    }
    

    // Verify token
    const decoded = jwt.verify(token, secretkey);

    // Attach user info to request
    req.user = decoded;
    next();
  } catch (error) {
    console.error("Auth Error:", error);
    res.status(401).json({ message: "Unauthorized access", error: error.message });
  }
};

module.exports = isauth;