require('dotenv').config();
const twilio = require('twilio');

// Load credentials from .env file
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const fromPhone = process.env.TWILIO_PHONE_NUMBER;

if (!accountSid || !authToken || !fromPhone) {
  console.error("❌ Missing Twilio credentials in .env file!");
  console.log("Please ensure TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER are set.");
  process.exit(1);
}

console.log("🚀 Initiating Twilio test call...");
console.log(`From: ${fromPhone}`);

const client = twilio(accountSid, authToken);

// Replace the 'to' number below with the destination phone number in E.164 format
const toPhone = '+923078526478'; 

client.calls
  .create({
    twiml: '<Response><Say>Hello! This is a test call from AuraPulse. Your Twilio configuration is working perfectly. Goodbye!</Say></Response>',
    to: toPhone,
    from: fromPhone
  })
  .then(call => {
    console.log('✅ Call successfully initiated!');
    console.log('📞 Call SID:', call.sid);
    console.log(`Ringing ${toPhone}...`);
  })
  .catch(err => {
    console.error('❌ Failed to initiate call:');
    console.error(err);
  });
