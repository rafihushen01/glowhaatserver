const express = require("express");
const router = express.Router();

const upload = require("../middlewares/Multer");

const {

  edititem,
  deleteitem,
  getallitems,
  getallcategories,
  createItem,
  getitemsbycategory,
  getnewinitems,
  getitem,
  searchitems,
  shopbycategory,
  getcategoryfilters,
  filtercategoryproduct,
} = require("../controllers/Itemcontroller");



// =======================================================
// 🚀 CREATE ITEM (UPLOAD ANY FILE)
// =======================================================
router.post(
  "/create",
  upload.any(), // accept ANY file (image / video / anything)
  createItem
);



// =======================================================
// ✏️ EDIT ITEM
// =======================================================
router.put(
  "/edit/:id",
  upload.any(), // allow replacing media
  edititem
);



// =======================================================
// ❌ DELETE ITEM
// =======================================================
router.delete("/delete/:id", deleteitem);



// =======================================================
// 📦 GET ALL ITEMS
// =======================================================
router.get("/all", getallitems);
router.get("/search", searchitems);



// =======================================================
// 🌳 GET ALL CATEGORIES
// =======================================================

router.get("/getnewitems",getnewinitems)
router.get("/getitembyslug/:slug",getitem)




// filter item by category and query

router.get("/category/:slug", shopbycategory);

router.get("/category/filters/:slug", getcategoryfilters)
router.post("/category/filter/:slug", filtercategoryproduct);
module.exports = router;
