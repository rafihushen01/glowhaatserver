const express = require("express");
const isauth = require("../middlewares/IsAuth");
const optionalauth = require("../middlewares/OptionalAuth");
const {
  addtowishlist,
  removewishlist,
  togglewishlist,
  getmywishlist,
  getwishliststatus,
  getwishlistinsightsadmin,
} = require("../controllers/WishlistController");

const router = express.Router();

router.use(optionalauth);

router.post("/add", addtowishlist);
router.post("/toggle", togglewishlist);
router.delete("/remove/:productid", removewishlist);
router.get("/my", getmywishlist);
router.get("/status/:slug", getwishliststatus);
router.use("/admin", isauth);
router.get("/admin/insights", getwishlistinsightsadmin);

module.exports = router;
