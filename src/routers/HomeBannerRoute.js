const express = require("express");
const router = express.Router();

const {
  createhomebanner,
  edithomebanner,
  deletehomebanner,
  gethomebanner,
} = require("../controllers/HomeBannerController");

const upload = require("../middlewares/Multer");

// ================= ADMIN ROUTES =================

// Create Banner
router.post("/create", upload.single("image"), createhomebanner);

// Edit Banner
router.put("/edit/:id", upload.single("image"), edithomebanner);

// Delete Banner
router.delete("/delete/:id", deletehomebanner);


// ================= PUBLIC USER ROUTE =================

// Get banners for frontend
router.get("/gethomebanners", gethomebanner);


module.exports = router;
