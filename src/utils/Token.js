const jwt=require('jsonwebtoken');
const dotenv=require('dotenv');
dotenv.config();
const scretkey=process.env.SECRETKEY
const gentoken=(userId)=>{
   return jwt.sign({userId},scretkey,{expiresIn:'3d'});
}
module.exports=gentoken