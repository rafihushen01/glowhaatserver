const admin = require("firebase-admin")

const normalizePrivateKey = (value = "") => {
  if (!value) return ""
  return String(value).replace(/\\n/g, "\n")
}

const initializeFirebaseAdmin = () => {
  if (admin.apps.length) {
    return admin.app()
  }

  const projectId = process.env.FIREBASE_PROJECT_ID || ""
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL || ""
  const privateKey = normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY || "")

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("Firebase Admin credentials are missing")
  }

  return admin.initializeApp({
    credential: admin.credential.cert({
      projectId,
      clientEmail,
      privateKey,
    }),
  })
}

const verifyFirebaseIdToken = async (idToken = "") => {
  initializeFirebaseAdmin()
  return admin.auth().verifyIdToken(String(idToken).trim(), true)
}

module.exports = {
  verifyFirebaseIdToken,
}
