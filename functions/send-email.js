export async function onRequest(context) {
  const { request, env } = context;
  const payload = await request.json();
  const order = payload.record;

  // 1. Create the Approve Link for YOU
  const approveLink = `https://letitedit.com/approve-order?id=${order.id}&secret=letitedit_secret_123`;

  // 2. Format the email
  const emailBody = `
    Hello Mujahid,
    
    You have received a new order on LetItEdit! 
    (Status: PENDING PAYMENT)
    
    Customer Details:
    -----------------
    Name: ${order.name}
    Email: ${order.email}
    WhatsApp: ${order.whatsapp}
    Delivery Time: ${order.delivery_time}
    
    Requirements:
    ${order.requirements}
    
    STEP 1: Go to your PayPal/SadaPay and confirm you received the money.
    STEP 2: Once confirmed, click the link below to unlock the customer's upload screen:
    
    👉 ${approveLink}
  `;

  // 3. Send the email via Resend
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${env.RESEND_API_KEY}`
    },
    body: JSON.stringify({
      from: "LetItEdit <onboarding@resend.dev>",
      to: ["a1003350601123@gmail.com"],
      subject: `🚨 PENDING Order: ${order.name} (${order.delivery_time})`,
      text: emailBody,
    })
  });

  const data = await res.json();
  return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
}
