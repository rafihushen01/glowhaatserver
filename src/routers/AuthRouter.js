const express=require("express")
const { requestsignupotp, verifysignupotp, requestsigninotp, verifysigninotp } = require("../controllers/AuthController")

const router=express.Router()
router.post("/signupotp",requestsignupotp)
router.post("/verifysignuptop",verifysignupotp)
router.post("/signinotp",requestsigninotp)
router.post("/verifysigninotp",verifysigninotp)

module.exports=router