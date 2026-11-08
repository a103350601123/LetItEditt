export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const order = await request.json();

    // Print exactly what data we received (you can see this in Cloudflare logs)
    console.log("RECEIVED DATA:", JSON.stringify(order));

    if (!order.id) {
      return new Response(JSON.stringify({ error: "Missing order ID" }), { status: 400 });
    }

    const emailBody = `
🚨 NEW ORDER: #${order.id} 🚨
Status: PENDING PAYMENT

Customer Details:
-----------------
Name: ${order.name || 'Not provided'}
Email: ${order.email || 'Not provided'}
WhatsApp: ${order.whatsapp || 'Not provided'}
Delivery Speed: ${order.delivery_time || 'Not provided'}

Requirements:
${order.requirements || 'Not provided'}

STEP 1: Check your PayPal account for a payment matching Order #${order.id}.
STEP 2: Once confirmed, click the link below to unlock their file upload:

👉 ${order.approveLink || 'No link provided'}
`;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${env.RESEND_API_KEY}`
      },
      body: JSON.stringify({
        from: "LetItEdit <orders@letitedit.com>",
        to: ["a1003350601123@gmail.com"], 
        subject: `🚨 Order #${order.id} - ${order.name || 'New Order'}`,
        text: emailBody,
      })
    });

    const data = await res.json();
    if (!res.ok) {
      console.error("Resend Error:", data);
      return new Response(JSON.stringify({ error: data.message }), { status: 500 });
    }

    return new Response(JSON.stringify({ success: true }), { status: 200 });
  } catch (error) {
    console.error("Function Error:", error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
