const express = require("express");
const isauth = require("../middlewares/IsAuth");
const { listusers, updateuser, deleteuser, bulkupdate, bulkdelete, exportusers, listlogs } = require("../controllers/UserController");

const router = express.Router();

router.use(isauth);
router.get("/all", listusers);
router.get("/export", exportusers);
router.get("/logs", listlogs);
router.put("/edit/:id", updateuser);
router.delete("/delete/:id", deleteuser);
router.patch("/bulk", bulkupdate);
router.post("/bulk-delete", bulkdelete);

module.exports = router;
