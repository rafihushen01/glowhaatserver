const sanitize = require("mongo-sanitize")
const user = require("../models/User")
const signupotpmodel = require("../models/SignupOtp")
const bcrypt = require("bcryptjs")
const validator = require("validator")
const gentoken = require("../utils/Token")
const crypto = require("crypto")
const { sendSignupOtp, sendSigninOtp } = require("../utils/Mail")

const generateSecureStudentId = () => {
  return crypto.randomBytes(6).toString("hex")
}

const generateotp = () => {
  return crypto.randomInt(100000,999999).toString()
}

const hashotp = (otp)=>{
  return crypto.createHash("sha256").update(otp).digest("hex")
}



exports.requestsignupotp = async(req,res)=>{
try{

const payload=sanitize(req.body||{})
const {fullname,email,password,mobile,gender,role}=payload

if(!fullname||!email||!password||!gender||!role){
return res.status(400).json({message:"Missing fields"})
}

if(!validator.isEmail(email)){
return res.status(400).json({message:"Invalid email"})
}

const existing=await user.findOne({email}).select("_id").lean()

if(existing){
return res.status(409).json({
message:"Account already exists please signin"
})
}

const otp=generateotp()
const otpHash=hashotp(otp)

await signupotpmodel.findOneAndUpdate(
{email},
{
email,
fullname,
password:await bcrypt.hash(String(password),12),
mobile,
gender,
role,
otp:otpHash,
expire:new Date(Date.now()+5*60*1000)
},
{upsert:true,new:true}
)

await sendSignupOtp(email,otp)

return res.status(200).json({
success:true,
message:"OTP sent"
})

}catch(err){
return res.status(500).json({message:"Signup OTP error"})
}
}



exports.verifysignupotp = async(req,res)=>{
try{

const {email,otp}=sanitize(req.body)

const record=await signupotpmodel.findOne({email})

if(!record){
return res.status(400).json({message:"Invalid request"})
}

if(record.expire<Date.now()){
return res.status(400).json({message:"OTP expired"})
}

const otpHash=hashotp(otp)

if(otpHash!==record.otp){
return res.status(400).json({message:"Invalid OTP"})
}

let avatar=""

if(record.gender==="Male") avatar="/Men.png"
if(record.gender==="Female") avatar="/women.jpg"
if(record.gender==="Other") avatar="/Third.webp"

const studentid=generateSecureStudentId()

const newuser=await user.create({

fullname:record.fullname,
email:record.email,
password:record.password,
mobile:record.mobile,
gender:record.gender,
role:record.role,
studentid,
avatar

})

await signupotpmodel.deleteOne({email})

const token=gentoken(newuser._id)

res.cookie("token",token,{
httpOnly:true,
secure:true,
sameSite:"strict",
maxAge:3*24*60*60*1000
})

return res.status(201).json({
success:true,
message:"Signup successful"
})

}catch(err){
return res.status(500).json({message:"Verification failed"})
}
}



exports.requestsigninotp = async(req,res)=>{
try{

const {email,password}=sanitize(req.body)

const existing=await user.findOne({email})

if(!existing){
return res.status(400).json({message:"Account not found"})
}

const match=await bcrypt.compare(password,existing.password)

if(!match){
return res.status(400).json({message:"Invalid credentials"})
}

const otp=generateotp()
const otpHash=hashotp(otp)

existing.signinotp=otpHash
existing.signinotpexpires=new Date(Date.now()+5*60*1000)

await existing.save()

await sendSigninOtp(email,otp)

return res.status(200).json({message:"OTP sent"})

}catch(err){
return res.status(500).json({message:"Signin OTP failed"})
}
}



exports.verifysigninotp = async(req,res)=>{
try{

const {email,otp}=sanitize(req.body)

const existing=await user.findOne({email})

if(!existing||!existing.signinotp){
return res.status(400).json({message:"Invalid request"})
}

if(existing.signinotpexpires<Date.now()){
return res.status(400).json({message:"OTP expired"})
}

const otpHash=hashotp(otp)

if(otpHash!==existing.signinotp){
return res.status(400).json({message:"Invalid OTP"})
}

existing.signinotp=undefined
existing.signinotpexpires=undefined

await existing.save()

const token=gentoken(existing._id)

res.cookie("token",token,{
httpOnly:true,
secure:true,
sameSite:"strict",
maxAge:3*24*60*60*1000
})

return res.status(200).json({
success:true,
message:"Signin successful"
})

}catch(err){
return res.status(500).json({message:"Verification failed"})
}
}



exports.userlogout=(req,res)=>{
res.clearCookie("token")
return res.status(200).json({
message:"User logout successful"
})
}