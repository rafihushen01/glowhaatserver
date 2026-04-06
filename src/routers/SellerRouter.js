const express = require("express");
const isauth = require("../middlewares/IsAuth");
const optionalauth = require("../middlewares/OptionalAuth");
const upload = require("../middlewares/Multer");
const { otpLimiter } = require("../utils/RateLimit");
const {
  requestSellerOtp,
  verifySellerOtp,
  submitSellerRequest,
  getSellerRequestStatus,
  listSellerRequestsForAdmin,
  decideSellerRequest,
} = require("../controllers/SellerController");

const router = express.Router();

router.post("/request-otp", otpLimiter, optionalauth, requestSellerOtp);
router.post("/verify-otp", optionalauth, verifySellerOtp);
router.post(
  "/submit",
  optionalauth,
  upload.fields([
    { name: "storeprofileimage", maxCount: 1 },
    { name: "storebannerimage", maxCount: 1 },
    { name: "physicalstoreimage", maxCount: 1 },
    { name: "niddocfront", maxCount: 1 },
    { name: "niddocback", maxCount: 1 },
    { name: "dateofbirthproof", maxCount: 1 },
  ]),
  submitSellerRequest
);
router.get("/status", optionalauth, getSellerRequestStatus);

router.get("/admin/requests", isauth, listSellerRequestsForAdmin);
router.patch("/admin/requests/:id/decision", isauth, decideSellerRequest);

module.exports = router;
