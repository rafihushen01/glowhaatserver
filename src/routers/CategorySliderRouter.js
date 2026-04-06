const express = require("express");
const router = express.Router();
const upload = require("../middlewares/Multer.js");

const {
  createCategorySlider,
  updateCategorySlider,
  addMediaToCategory,
  toggleCategoryStatus,
  deleteCategorySlider,
  addSegmentToCategory,
  bulkAddSegments,
  removeSegment,
  reorderSegments,
  getActiveCategorySliders,
  getAllCategorySliders,
  getFullNavTree,
  getPublicCategoriesFull,
  rebuildAllCategoryNavpaths
} = require("../controllers/CategorySliderController.js");

// =====================================================
// CATEGORY CORE
// =====================================================
router.post("/create", upload.array("media", 500), createCategorySlider);
router.put("/update/:id", upload.array("media", 500), updateCategorySlider);
router.post("/add-media/:id", upload.array("media", 500), addMediaToCategory);
router.patch("/toggle-status/:id", toggleCategoryStatus);
router.delete("/delete/:id", deleteCategorySlider);

// =====================================================
// SEGMENTS ENGINE
// =====================================================
router.post("/add-segment", addSegmentToCategory);
router.post("/bulk-add-segments", bulkAddSegments);
router.post("/remove-segment", removeSegment);
router.post("/reorder-segments", reorderSegments);
router.get("/getallnavpath",rebuildAllCategoryNavpaths)
// =====================================================
// PUBLIC (WEBSITE)
// =====================================================
router.get("/active", getActiveCategorySliders);
router.get("/all", getAllCategorySliders);
router.get("/fulltree", getFullNavTree);
// public route for showing up category in the website
router.get("/public/full", getPublicCategoriesFull);

module.exports = router;
