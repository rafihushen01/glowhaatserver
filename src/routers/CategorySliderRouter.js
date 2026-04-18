const express = require("express");
const router = express.Router();
const upload = require("../middlewares/Multer.js");

const {
  createCategorySlider,
  updateCategorySlider,
  addMediaToCategory,
  toggleCategoryStatus,
  deleteCategorySlider,
  restoreCategorySlider,
  permanentlyDeleteCategorySlider,
  addSegmentToCategory,
  bulkAddSegments,
  removeSegment,
  reorderSegments,
  getActiveCategorySliders,
  getAllCategorySliders,
  getFullNavTree,
  getPublicCategoriesFull,
  rebuildAllCategoryNavpaths,
} = require("../controllers/CategorySliderController.js");

router.post("/create", upload.array("media", 500), createCategorySlider);
router.put("/update/:id", upload.array("media", 500), updateCategorySlider);
router.post("/add-media/:id", upload.array("media", 500), addMediaToCategory);

router.patch("/toggle-status/:id", toggleCategoryStatus);
router.patch("/restore/:id", restoreCategorySlider);

router.delete("/delete/:id", deleteCategorySlider);
router.delete("/permanent/:id", permanentlyDeleteCategorySlider);

router.post("/add-segment", addSegmentToCategory);
router.post("/bulk-add-segments", bulkAddSegments);
router.post("/remove-segment", removeSegment);
router.post("/reorder-segments", reorderSegments);
router.get("/getallnavpath", rebuildAllCategoryNavpaths);

router.get("/active", getActiveCategorySliders);
router.get("/all", getAllCategorySliders);
router.get("/fulltree", getFullNavTree);
router.get("/public/full", getPublicCategoriesFull);

module.exports = router;
