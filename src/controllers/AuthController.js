const sanitize = require("mongo-sanitize")
const user = require("../models/User")
const signupotpmodel = require("../models/SignupOtp")
const bcrypt = require("bcryptjs")
const validator = require("validator")
const gentoken = require("../utils/Token")
const crypto = require("crypto")
const { sendSignupOtp, sendSigninOtp } = require("../utils/Mail")
const SuperAdminOtp = require("../models/SuperAdminOtp")
const { verifyFirebaseIdToken } = require("../utils/FirebaseAdmin")

const generateSecureStudentId = () => {
  return crypto.randomBytes(6).toString("hex")
}

const generateotp = () => {
  return crypto.randomInt(100000,999999).toString()
}

const hashotp = (otp)=>{
  return crypto.createHash("sha256").update(otp).digest("hex")
}

const normalizeEmail = (value = "") => {
  return String(value).trim().toLowerCase()
}

const normalizeOtp = (value = "") => {
  return String(value).trim()
}

const normalizePassword = (value = "") => {
  return String(value).trim()
}

const normalizeMobile = (value = "") => {
  return String(value).trim()
}

const isValidMobile = (value = "") => {
  return /^\+?\d{8,15}$/.test(String(value).trim())
}

const getSuperAdminConfig = () => {
  const superEmail = normalizeEmail(process.env.SUPERADMIN_EMAIL || process.env.SUPERADMIN_GMAIL || "")
  const superPass = normalizePassword(process.env.SUPERADMIN_PASSWORD || "")
  const superName = String(process.env.SUPERADMIN_NAME || "Super Admin").trim()
  return { superEmail, superPass, superName }
}

const buildCookieOptions = () => {
  const isproduction = process.env.NODE_ENV === "production"
  return {
    httpOnly:true,
    secure:isproduction,
    sameSite:isproduction ? "none" : "lax",
    maxAge:3*24*60*60*1000,
    path:"/"
  }
}

const signInWithUserCookie = (res, userId) => {
  const token = gentoken(userId)
  res.cookie("token", token, buildCookieOptions())
}

const pickDefaultAvatarFromGender = (gender = "Other") => {
  if (gender === "Male") return "/Men.png"
  if (gender === "Female") return "/women.jpg"
  return "/Third.webp"
}



exports.requestsignupotp = async(req,res)=>{
try{

const payload=sanitize(req.body||{})
const {fullname,password,mobile,gender,role}=payload
const email=normalizeEmail(payload.email)

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

const payload=sanitize(req.body||{})
const email=normalizeEmail(payload.email)
const otp=normalizeOtp(payload.otp)

if(!email||!otp){
return res.status(400).json({message:"Missing email or OTP"})
}

const record=await signupotpmodel.findOne({email}).sort({updatedAt:-1})

if(!record){
return res.status(400).json({message:"Invalid request"})
}

if(!record.expire||record.expire.getTime()<Date.now()){
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

await signupotpmodel.deleteMany({email})

const token=gentoken(newuser._id)

res.cookie("token",token,buildCookieOptions())

return res.status(201).json({
success:true,
message:"Signup successful",
user:{
id:newuser._id,
fullname:newuser.fullname,
email:newuser.email,
mobile:newuser.mobile||"",
role:newuser.role,
gender:newuser.gender
}
})

}catch(err){
return res.status(500).json({message:"Verification failed"})
}
}



exports.requestsigninotp = async(req,res)=>{
try{

const payload=sanitize(req.body||{})
const email=normalizeEmail(payload.email)
const password=String(payload.password||"")

const { superEmail, superPass } = getSuperAdminConfig()

if(!email||!password){
return res.status(400).json({message:"Missing email or password"})
}

// SuperAdmin hidden flow (no public toggle)
if (superEmail && superPass && email === superEmail && password === superPass) {
  const otp = generateotp()
  const otpHash = hashotp(otp)
  await SuperAdminOtp.findOneAndUpdate(
    { email },
    { email, otp: otpHash, expire: new Date(Date.now() + 5 * 60 * 1000) },
    { upsert: true, new: true }
  )
  await sendSigninOtp(email, otp)
  return res.status(200).json({ message: "OTP sent" })
}

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
if (res.headersSent) return
return res.status(500).json({message:"Signin OTP failed"})
}
}

exports.requestsuperadminotp = async (req, res) => {
  try {
    const payload = sanitize(req.body || {})
    const email = normalizeEmail(payload.email)
    const password = normalizePassword(payload.password)

    const { superEmail, superPass } = getSuperAdminConfig()

    if (!superEmail || !superPass) {
      return res.status(500).json({ message: "SuperAdmin credentials not configured" })
    }

    if (!email || !password) {
      return res.status(400).json({ message: "Missing email or password" })
    }

    if (email !== superEmail || password !== superPass) {
      return res.status(401).json({ message: "Invalid superadmin credentials" })
    }

    const otp = generateotp()
    const otpHash = hashotp(otp)

    await SuperAdminOtp.findOneAndUpdate(
      { email },
      { email, otp: otpHash, expire: new Date(Date.now() + 5 * 60 * 1000) },
      { upsert: true, new: true }
    )

    await sendSigninOtp(email, otp)

    return res.status(200).json({ success: true, message: "OTP sent" })
  } catch (err) {
    return res.status(500).json({ message: "SuperAdmin OTP failed" })
  }
}

exports.verifysuperadminotp = async (req, res) => {
  try {
    const payload = sanitize(req.body || {})
    const email = normalizeEmail(payload.email)
    const otp = normalizeOtp(payload.otp)

    const { superEmail, superPass, superName } = getSuperAdminConfig()

    if (!superEmail || !superPass) {
      return res.status(500).json({ message: "SuperAdmin credentials not configured" })
    }

    if (!email || !otp) {
      return res.status(400).json({ message: "Missing email or OTP" })
    }

    if (email !== superEmail) {
      return res.status(401).json({ message: "Unauthorized access" })
    }

    const record = await SuperAdminOtp.findOne({ email }).sort({ updatedAt: -1 })
    if (!record) {
      return res.status(400).json({ message: "Invalid request" })
    }

    if (!record.expire || record.expire.getTime() < Date.now()) {
      return res.status(400).json({ message: "OTP expired" })
    }

    const otpHash = hashotp(otp)
    if (otpHash !== record.otp) {
      return res.status(400).json({ message: "Invalid OTP" })
    }

    let existing = await user.findOne({ email: superEmail })
    const hashed = await bcrypt.hash(String(superPass), 12)

    if (!existing) {
      existing = await user.create({
        fullname: superName,
        email: superEmail,
        password: hashed,
        role: "SuperAdmin",
        gender: "Other",
      })
    } else {
      existing.password = hashed
      existing.role = "SuperAdmin"
      existing.fullname = existing.fullname || superName
      await existing.save()
    }

    await SuperAdminOtp.deleteMany({ email: superEmail })

    const token = gentoken(existing._id)
    res.cookie("token", token, buildCookieOptions())

    return res.status(200).json({
      success: true,
      message: "SuperAdmin signin successful",
      user: {
        id: existing._id,
        fullname: existing.fullname,
        email: existing.email,
        role: existing.role,
        gender: existing.gender || "Other",
      },
    })
  } catch (err) {
    return res.status(500).json({ message: "Verification failed" })
  }
}



exports.verifysigninotp = async(req,res)=>{
try{

const payload=sanitize(req.body||{})
const email=normalizeEmail(payload.email)
const otp=normalizeOtp(payload.otp)

const { superEmail, superPass, superName } = getSuperAdminConfig()

if(!email||!otp){
return res.status(400).json({message:"Missing email or OTP"})
}

// SuperAdmin verification path
if (superEmail && superPass && email === superEmail) {
  const record = await SuperAdminOtp.findOne({ email }).sort({ updatedAt: -1 })
  if (!record) {
    return res.status(400).json({ message: "Invalid request" })
  }
  if (!record.expire || record.expire.getTime() < Date.now()) {
    return res.status(400).json({ message: "OTP expired" })
  }
  const otpHash = hashotp(otp)
  if (otpHash !== record.otp) {
    return res.status(400).json({ message: "Invalid OTP" })
  }

  let existing = await user.findOne({ email: superEmail })
  const hashed = await bcrypt.hash(String(superPass), 12)

  if (!existing) {
    existing = await user.create({
      fullname: superName,
      email: superEmail,
      password: hashed,
      role: "SuperAdmin",
      gender: "Other",
    })
  } else {
    existing.password = hashed
    existing.role = "SuperAdmin"
    existing.fullname = existing.fullname || superName
    await existing.save()
  }

  await SuperAdminOtp.deleteMany({ email: superEmail })
  const token = gentoken(existing._id)
  res.cookie("token", token, buildCookieOptions())
  return res.status(200).json({
    success: true,
    message: "Signin successful",
    user: {
      id: existing._id,
      fullname: existing.fullname,
      email: existing.email,
      role: existing.role,
      gender: existing.gender || "Other",
    },
  })
}

const existing=await user.findOne({email})

if(!existing||!existing.signinotp){
return res.status(400).json({message:"Invalid request"})
}

if(!existing.signinotpexpires||existing.signinotpexpires.getTime()<Date.now()){
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

res.cookie("token",token,buildCookieOptions())

return res.status(200).json({
success:true,
message:"Signin successful",
user:{
id:existing._id,
fullname:existing.fullname,
email:existing.email,
mobile:existing.mobile||"",
role:existing.role,
gender:existing.gender
}
})

}catch(err){
if (res.headersSent) return
return res.status(500).json({message:"Verification failed"})
}
}



const handleGoogleAuth=async(req,res,mode)=>{
try{
const payload=sanitize(req.body||{})
const idToken=String(payload.idToken||payload.firebaseIdToken||"").trim()
const mobile=normalizeMobile(payload.mobile)
const preferredName=String(payload.fullname||"").trim()
const preferredGender=String(payload.gender||"").trim()

if(!idToken){
return res.status(400).json({message:"Missing Firebase ID token"})
}

if(!mobile){
return res.status(400).json({message:"Mobile number is required for Google authentication"})
}

if(!isValidMobile(mobile)){
return res.status(400).json({message:"Invalid mobile number format"})
}

const decoded=await verifyFirebaseIdToken(idToken)
const email=normalizeEmail(decoded?.email||"")

if(!email){
return res.status(400).json({message:"Google account email is missing"})
}

const firebaseUid=String(decoded?.uid||"").trim()
const googleName=String(decoded?.name||"").trim()
const photoURL=String(decoded?.picture||"").trim()
const emailVerified=Boolean(decoded?.email_verified)

const mobileOwner=await user.findOne({mobile}).select("_id email").lean()
if(mobileOwner&&normalizeEmail(mobileOwner.email)!==email){
return res.status(409).json({message:"This mobile number is already used by another account"})
}

let existingUser=await user.findOne({email})

if(mode==="signin"&&!existingUser){
return res.status(404).json({message:"Google account not found. Please signup first."})
}

if(!existingUser&&mode==="signup"){
const randomPassword=await bcrypt.hash(crypto.randomBytes(24).toString("hex"),12)
const studentid=generateSecureStudentId()
const gender=["Male","Female","Other"].includes(preferredGender)?preferredGender:"Other"
const avatar=photoURL||pickDefaultAvatarFromGender(gender)

existingUser=await user.create({
fullname:preferredName||googleName||"KhanCosmetics User",
email,
password:randomPassword,
mobile,
gender,
role:"User",
studentid,
usersavatar:photoURL,
avatar,
firebaseuid:firebaseUid,
authprovider:"google",
isemailverified:emailVerified,
lastlogin:new Date()
})
}else if(existingUser){
if(existingUser.firebaseuid&&existingUser.firebaseuid!==firebaseUid){
return res.status(401).json({message:"Google account mismatch for this email"})
}

existingUser.mobile=mobile
existingUser.firebaseuid=firebaseUid||existingUser.firebaseuid
existingUser.authprovider=existingUser.authprovider==="password" ? "google+password" : "google"
existingUser.isemailverified=Boolean(existingUser.isemailverified||emailVerified)
existingUser.lastlogin=new Date()

if(!existingUser.fullname&&(preferredName||googleName)){
existingUser.fullname=preferredName||googleName
}

if(!existingUser.usersavatar&&photoURL){
existingUser.usersavatar=photoURL
}

await existingUser.save()
}

signInWithUserCookie(res,existingUser._id)

return res.status(200).json({
success:true,
message:mode==="signup" ? "Google signup successful" : "Google signin successful",
user:{
id:existingUser._id,
fullname:existingUser.fullname||"",
email:existingUser.email||"",
mobile:existingUser.mobile||"",
role:existingUser.role||"User",
gender:existingUser.gender||"Other",
avatar:existingUser.usersavatar||existingUser.avatar||""
}
})
}catch(err){
const isFirebaseTokenError=err?.code?.startsWith?.("auth/")||/Firebase/i.test(String(err?.message||""))
if(isFirebaseTokenError){
return res.status(401).json({message:"Invalid or expired Google token"})
}
return res.status(500).json({message:"Google authentication failed"})
}
}

exports.googlesignup=async(req,res)=>{
return handleGoogleAuth(req,res,"signup")
}

exports.googlesignin=async(req,res)=>{
return handleGoogleAuth(req,res,"signin")
}


exports.userlogout=(req,res)=>{
res.clearCookie("token",{
path:"/",
sameSite:process.env.NODE_ENV==="production" ? "none" : "lax",
secure:process.env.NODE_ENV==="production"
})
return res.status(200).json({
message:"User logout successful"
})
}



exports.getcurrentuser=async(req,res)=>{
try{
const userid=req.user?.userId

if(!userid){
return res.status(401).json({message:"Unauthorized access"})
}

const existing=await user.findById(userid).select("_id fullname email mobile role gender usersavatar avatar").lean()

if(!existing){
return res.status(404).json({message:"User not found"})
}

return res.status(200).json({
success:true,
user:{
id:existing._id,
fullname:existing.fullname||"",
email:existing.email||"",
mobile:existing.mobile||"",
role:existing.role||"User",
gender:existing.gender||"",
avatar:existing.usersavatar||existing.avatar||""
}
})

}catch(err){
return res.status(500).json({message:"Failed to fetch user"})
}
}
