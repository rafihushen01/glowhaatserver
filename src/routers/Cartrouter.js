const express = require("express");
const optionalauth = require("../middlewares/OptionalAuth");
const {
  addtocart,
  getmycart,
  updatecartquantity,
  removefromcart,
  clearcart,
} = require("../controllers/CartController");

const router = express.Router();

router.use(optionalauth);
router.post("/add", addtocart);
router.get("/my", getmycart);
router.patch("/quantity/:id", updatecartquantity);
router.delete("/remove/:id", removefromcart);
router.delete("/clear", clearcart);

module.exports = router;
