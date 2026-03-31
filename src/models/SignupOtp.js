const mongoose=require("mongoose")

const schema=new mongoose.Schema({

email:{type:String,required:true,index:true},

fullname:String,

password:String,

mobile:String,

gender:String,

role:String,

otp:String,

expire:Date

},{timestamps:true})

module.exports=mongoose.model("signupotp",schema)