const mongoose=require("mongoose")

const schema=new mongoose.Schema({

email:{type:String,required:true,index:true,lowercase:true,trim:true},

fullname:String,

password:String,

mobile:String,

gender:String,

role:String,

otp:{type:String,required:true},

expire:{type:Date,required:true}

},{timestamps:true})

module.exports=mongoose.model("signupotp",schema)
