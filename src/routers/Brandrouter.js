const express = require("express");
const isauth = require("../middlewares/IsAuth");
const {
  createbrand,
  editbrand,
  deletebrand,
  getbrands,
  getbrandbyslug,
} = require("../controllers/BrandController");

const router = express.Router();

router.get("/all", getbrands);
router.get("/by-slug/:slug", getbrandbyslug);

router.post("/create", isauth, createbrand);
router.put("/edit/:id", isauth, editbrand);
router.delete("/delete/:id", isauth, deletebrand);

module.exports = router;

