const express = require("express");
const router = express.Router();

const {
  createhomebanner,
  edithomebanner,
  deletehomebanner,
  restorehomebanner,
  togglehomebannerstatus,
  permanentlyDeleteHomebanner,
  gethomebanner,
  gethomebannerdownload,
} = require("../controllers/HomeBannerController");

const upload = require("../middlewares/Multer");

router.post("/create", upload.single("image"), createhomebanner);
router.put("/edit/:id", upload.single("image"), edithomebanner);

router.patch("/status/:id", togglehomebannerstatus);
router.patch("/restore/:id", restorehomebanner);

router.delete("/delete/:id", deletehomebanner);
router.delete("/permanent/:id", permanentlyDeleteHomebanner);

router.get("/download/:id", gethomebannerdownload);
router.get("/gethomebanners", gethomebanner);

module.exports = router;
