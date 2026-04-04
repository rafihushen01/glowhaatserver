const express = require("express");
const isauth = require("../middlewares/IsAuth");
const {
  addtowishlist,
  removewishlist,
  togglewishlist,
  getmywishlist,
  getwishliststatus,
  getwishlistinsightsadmin,
} = require("../controllers/WishlistController");

const router = express.Router();

router.use(isauth);

router.post("/add", addtowishlist);
router.post("/toggle", togglewishlist);
router.delete("/remove/:productid", removewishlist);
router.get("/my", getmywishlist);
router.get("/status/:slug", getwishliststatus);
router.get("/admin/insights", getwishlistinsightsadmin);

module.exports = router;
