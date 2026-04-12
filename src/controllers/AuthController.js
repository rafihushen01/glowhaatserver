const sanitize = require("mongo-sanitize")
const user = require("../models/User")
const bcrypt = require("bcryptjs")
const validator = require("validator")
const gentoken = require("../utils/Token")
const crypto = require("crypto")
const { sendSigninOtp } = require("../utils/Mail")
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

const isValidPassword = (value = "") => {
  const password = String(value || "")
  return password.length >= 8 && /[A-Za-z]/.test(password) && /\d/.test(password)
}

const isValidMobile = (value = "") => {
  return /^\+?\d{8,15}$/.test(String(value).trim())
}

const getSuperAdminConfig = () => {
  const superEmails = [
    process.env.SUPERADMIN_EMAIL,
    process.env.SUPERADMIN_GMAIL
  ]
    .map(normalizeEmail)
    .filter(Boolean)

  const superPasswords = [
    process.env.SUPERADMIN_PASSWORD,
    process.env.SUPERADMIN_PASS
  ]
    .map(normalizePassword)
    .filter(Boolean)

  const superEmail = superEmails[0] || ""
  const superPass = superPasswords[0] || ""
  const superName = String(process.env.SUPERADMIN_NAME || "Super Admin").trim()

  const isAuthorizedSuperAdminEmail = (candidateEmail = "") => {
    const normalizedCandidate = normalizeEmail(candidateEmail)
    return superEmails.includes(normalizedCandidate)
  }

  const isAuthorizedSuperAdminPassword = (candidatePassword = "") => {
    const normalizedCandidate = normalizePassword(candidatePassword)
    return superPasswords.includes(normalizedCandidate)
  }

  return {
    superEmail,
    superPass,
    superName,
    hasCredentials: Boolean(superEmails.length && superPasswords.length),
    isAuthorizedSuperAdminEmail,
    isAuthorizedSuperAdminPassword
  }
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

const isProductionEnv = () => process.env.NODE_ENV === "production"

const isSuperAdminOtpFallbackAllowed = () => {
  if (!isProductionEnv()) return true
  return String(process.env.SUPERADMIN_OTP_FALLBACK || "").trim().toLowerCase() === "true"
}

const signInWithUserCookie = (res, userId) => {
  const token = gentoken(userId)
  res.cookie("token", token, buildCookieOptions())
}

const ensureSuperAdminUser = async () => {
  const {
    superEmail,
    superPass,
    superName,
  } = getSuperAdminConfig()

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

  return existing
}

const pickDefaultAvatarFromGender = (gender = "Other") => {
  if (gender === "Male") return "/Men.png"
  if (gender === "Female") return "/women.jpg"
  return "/Third.webp"
}



exports.requestsignupotp = async(req,res)=>{
try{
const payload=sanitize(req.body||{})
const fullname=String(payload.fullname||"").trim()
const email=normalizeEmail(payload.email)
const password=String(payload.password||"")
const mobile=normalizeMobile(payload.mobile||"")
const gender=String(payload.gender||"").trim()
const role=String(payload.role||"User").trim()||"User"

if(!fullname||!email||!password||!gender){
return res.status(400).json({message:"Missing fields"})
}

if(!validator.isEmail(email)){
return res.status(400).json({message:"Invalid email"})
}

if(!isValidPassword(password)){
return res.status(400).json({message:"Password must be at least 8 characters and include letters and numbers"})
}

if(mobile&&!isValidMobile(mobile)){
return res.status(400).json({message:"Invalid mobile number format"})
}

if(!["Male","Female","Other"].includes(gender)){
return res.status(400).json({message:"Invalid gender"})
}

if(!["User","Seller"].includes(role)){
return res.status(400).json({message:"Invalid role"})
}

const existing=await user.findOne({email}).select("_id").lean()
if(existing){
return res.status(409).json({message:"Account already exists please signin"})
}

const studentid=generateSecureStudentId()
const avatar=pickDefaultAvatarFromGender(gender)
const hashedPassword=await bcrypt.hash(password,12)

const newuser=await user.create({
fullname,
email,
password:hashedPassword,
mobile:mobile||undefined,
gender,
role,
studentid,
avatar
})

signInWithUserCookie(res,newuser._id)

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
return res.status(500).json({message:"Signup failed"})
}
}



exports.verifysignupotp = async(req,res)=>{
return res.status(410).json({message:"OTP signup is disabled. Please use email and password signup."})
}



exports.requestsigninotp = async(req,res)=>{
try{

const payload=sanitize(req.body||{})
const email=normalizeEmail(payload.email)
const password=String(payload.password||"")

const { hasCredentials, isAuthorizedSuperAdminEmail, isAuthorizedSuperAdminPassword } = getSuperAdminConfig()

if(!email||!password){
return res.status(400).json({message:"Missing email or password"})
}

// SuperAdmin hidden flow (direct signin, OTP disabled for website auth)
if (hasCredentials && isAuthorizedSuperAdminEmail(email) && isAuthorizedSuperAdminPassword(password)) {
  const existing = await ensureSuperAdminUser()
  signInWithUserCookie(res, existing._id)
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

if(!existing){
return res.status(400).json({message:"Account not found"})
}

const match=await bcrypt.compare(password,existing.password)

if(!match){
return res.status(400).json({message:"Invalid credentials"})
}

signInWithUserCookie(res, existing._id)

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
return res.status(500).json({message:"Signin failed"})
}
}

exports.requestsuperadminotp = async (req, res) => {
  try {
    const payload = sanitize(req.body || {})
    const email = normalizeEmail(payload.email)
    const password = normalizePassword(payload.password)

    const { hasCredentials, isAuthorizedSuperAdminEmail, isAuthorizedSuperAdminPassword } = getSuperAdminConfig()

    if (!hasCredentials) {
      return res.status(500).json({
        message: "SuperAdmin credentials not configured",
        reason: "SUPERADMIN_NOT_CONFIGURED",
        detail: "Set SUPERADMIN_EMAIL and SUPERADMIN_PASSWORD in production env."
      })
    }

    if (!email || !password) {
      return res.status(400).json({ message: "Missing email or password" })
    }

    if (!isAuthorizedSuperAdminEmail(email) || !isAuthorizedSuperAdminPassword(password)) {
      return res.status(401).json({ message: "Invalid superadmin credentials" })
    }

    const otp = generateotp()
    const otpHash = hashotp(otp)

    await SuperAdminOtp.findOneAndUpdate(
      { email },
      { email, otp: otpHash, expire: new Date(Date.now() + 5 * 60 * 1000) },
      { upsert: true, new: true }
    )

    let deliveredVia = "email"
    let fallbackReason = ""
    let devOtp = ""

    try {
      await sendSigninOtp(email, otp)
    } catch (mailError) {
      deliveredVia = "fallback"
      fallbackReason = String(mailError?.code || "SMTP_SEND_FAILED")

      if (!isSuperAdminOtpFallbackAllowed()) {
        throw mailError
      }

      if (!isProductionEnv()) {
        devOtp = otp
      }
    }

    return res.status(200).json({
      success: true,
      message: deliveredVia === "email" ? "OTP sent" : "OTP generated",
      delivery: deliveredVia,
      reason: fallbackReason || undefined,
      devOtp: devOtp || undefined
    })
  } catch (err) {
    const reason = String(err?.code || "UNKNOWN")
    console.error("SuperAdmin OTP send error:", reason, err?.message || err)

    let detail = "Email service temporary issue. Please retry in a few seconds."
    if (reason === "SMTP_NOT_CONFIGURED") {
      detail = "SMTP credentials are missing on server env."
    } else if (reason === "SMTP_AUTH_FAILED") {
      detail = "SMTP auth failed. Regenerate Gmail App Password in production env."
    }

    return res.status(500).json({
      message: "SuperAdmin OTP failed",
      reason,
      detail
    })
  }
}

exports.superadminsignin = async (req, res) => {
  try {
    const payload = sanitize(req.body || {})
    const email = normalizeEmail(payload.email)
    const password = normalizePassword(payload.password)

    const { hasCredentials, isAuthorizedSuperAdminEmail, isAuthorizedSuperAdminPassword } = getSuperAdminConfig()

    if (!hasCredentials) {
      return res.status(500).json({ message: "SuperAdmin credentials not configured" })
    }

    if (!email || !password) {
      return res.status(400).json({ message: "Missing email or password" })
    }

    if (!isAuthorizedSuperAdminEmail(email) || !isAuthorizedSuperAdminPassword(password)) {
      return res.status(401).json({ message: "Invalid superadmin credentials" })
    }

    const existing = await ensureSuperAdminUser()
    signInWithUserCookie(res, existing._id)

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
    return res.status(500).json({ message: "SuperAdmin signin failed" })
  }
}

exports.verifysuperadminotp = async (req, res) => {
  try {
    const payload = sanitize(req.body || {})
    const email = normalizeEmail(payload.email)
    const otp = normalizeOtp(payload.otp)

    const { hasCredentials, isAuthorizedSuperAdminEmail } = getSuperAdminConfig()

    if (!hasCredentials) {
      return res.status(500).json({ message: "SuperAdmin credentials not configured" })
    }

    if (!email || !otp) {
      return res.status(400).json({ message: "Missing email or OTP" })
    }

    if (!isAuthorizedSuperAdminEmail(email)) {
      return res.status(401).json({ message: "Please sign in first to continue." })
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

    const existing = await ensureSuperAdminUser()
    await SuperAdminOtp.deleteMany({ email: existing.email })

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
return res.status(410).json({message:"OTP signin is disabled. Please use email and password signin."})
}



const handleGoogleAuth=async(req,res,mode)=>{
try{
const payload=sanitize(req.body||{})
const idToken=String(payload.idToken||payload.firebaseIdToken||"").trim()
const mobile=normalizeMobile(payload.mobile)
const hasProvidedMobile=Boolean(mobile)
const preferredName=String(payload.fullname||"").trim()
const preferredGender=String(payload.gender||"").trim()

if(!idToken){
return res.status(400).json({message:"Missing Firebase ID token"})
}

if(mode==="signup"&&!mobile){
return res.status(400).json({message:"Mobile number is required for Google authentication"})
}

if(hasProvidedMobile&&!isValidMobile(mobile)){
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

if(hasProvidedMobile){
const mobileOwner=await user.findOne({mobile}).select("_id email").lean()
if(mobileOwner&&normalizeEmail(mobileOwner.email)!==email){
return res.status(409).json({message:"This mobile number is already used by another account"})
}
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
mobile:mobile||undefined,
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

if(hasProvidedMobile){
existingUser.mobile=mobile
}
existingUser.firebaseuid=firebaseUid||existingUser.firebaseuid
if(existingUser.authprovider==="password"){
existingUser.authprovider="google+password"
}else if(existingUser.authprovider!=="google+password"){
existingUser.authprovider="google"
}
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
return res.status(401).json({message:"Please sign in first to continue."})
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

