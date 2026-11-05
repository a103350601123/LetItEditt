export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const order = await request.json();

    // 1. Construct the email body
    const emailBody = `
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

STEP 1: Check your PayPal account for a payment matching Order #${order.id} and the correct amount.
STEP 2: Once confirmed, click the link below to unlock their file upload:

👉 ${order.approveLink || ''}
`;

    // 2. Send the email via Resend
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${env.RESEND_API_KEY}`
      },
      body: JSON.stringify({
        // 👇 YOUR VERIFIED RESEND DOMAIN 👇
        from: "LetItEdit <orders@letitedit.com>",
        // 👇 YOUR GMAIL INBOX 👇
        to: ["apreviews@gmail.com"], 
        subject: `🚨 Order #${order.id} (PENDING) - ${order.name}`,
        text: emailBody,
      })
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.message || 'Failed to send email via Resend');
    }

    return new Response(JSON.stringify({ success: true, data }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
