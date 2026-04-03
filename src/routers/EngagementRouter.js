const express = require("express");
const upload = require("../middlewares/Multer");
const isauth = require("../middlewares/IsAuth");
const optionalauth = require("../middlewares/OptionalAuth");
const {
  getProductEngagementSummary,
  createReview,
  askQuestion,
  getAllQuestionsForAdmin,
  answerQuestion,
} = require("../controllers/EngagementController");

const router = express.Router();

router.get("/product/:productid/summary", optionalauth, getProductEngagementSummary);
router.post("/product/:productid/reviews", isauth, upload.any(), createReview);
router.post("/product/:productid/questions", isauth, askQuestion);

router.get("/admin/questions", isauth, getAllQuestionsForAdmin);
router.patch("/admin/questions/:id/answer", isauth, answerQuestion);

module.exports = router;

