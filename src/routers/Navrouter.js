const express = require("express");
const router = express.Router();
const navcontroller = require("../controllers/Navcontroller.js");
const upload = require("../middlewares/Multer.js");



router.post("/createnav", upload.array("images",100), navcontroller.createnav);
router.put("/editnav/:id", upload.array("images",100), navcontroller.editnav);
router.delete("/deletenav/:id", navcontroller.deletenav);

router.post("/uploadlogo", upload.any(), navcontroller.uploadlogo);
router.put("/editlogo", upload.any(), navcontroller.editlogo);

router.get("/nav", navcontroller.getnav);
router.get("/getcategorybydepth", navcontroller.getCategoryByDepth);


module.exports = router;
