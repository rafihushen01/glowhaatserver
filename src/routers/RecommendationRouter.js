const express = require("express");
const optionalauth = require("../middlewares/OptionalAuth");
const isauth = require("../middlewares/IsAuth");
const {
  trackRecommendationEvent,
  getPersonalizedRecommendations,
  getRecommendationInsightsAdmin,
} = require("../controllers/RecommendationController");

const router = express.Router();

router.post("/track", optionalauth, trackRecommendationEvent);
router.get("/for-you", optionalauth, getPersonalizedRecommendations);
router.get("/admin/insights", isauth, getRecommendationInsightsAdmin);

module.exports = router;
