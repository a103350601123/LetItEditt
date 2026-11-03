export async function onRequest(context) {
  const { request, env } = context;
  const payload = await request.json();
  const order = payload.record;

  // 1. Create the Approve Link for YOU
  const approveLink = `https://letitedit.com/approve-order?id=${order.id}&secret=letitedit_secret_123`;

  // 2. Format the email with the Order Number clearly visible
  const emailBody = `
    Hello Mujahid,
    
    You have received a new order on LetItEdit! 
    
    🚨 ORDER NUMBER: #${order.id} 🚨
    Status: PENDING PAYMENT
    
    Customer Details:
    -----------------
    Name: ${order.name}
    Email: ${order.email || 'Not provided'}
    WhatsApp: ${order.whatsapp || 'Not provided'}
    Delivery Speed: ${order.delivery_time}
    
    Requirements:
    ${order.requirements}
    
    STEP 1: Check your PayPal/SadaPay account for a payment matching Order #${order.id} and the correct amount.
    STEP 2: Once confirmed, click the link below to unlock their file upload:
    
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
      subject: `🚨 Order #${order.id} (PENDING) - ${order.name}`,
      text: emailBody,
    })
  });

  const data = await res.json();
  return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
}
