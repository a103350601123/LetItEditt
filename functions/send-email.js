export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const order = await request.json();

    const emailBody = `
🚨 ORDER NUMBER: #${order.id} 🚨
Status: PENDING PAYMENT

Name: ${order.name}
Email: ${order.email || 'Not provided'}
WhatsApp: ${order.whatsapp || 'Not provided'}
Delivery Speed: ${order.delivery_time}

Requirements:
${order.requirements}

STEP 1: Check your PayPal account for a payment matching Order #${order.id}.
STEP 2: Once confirmed, email the customer to let them know they can upload their file.

👉 ${order.approveLink || ''}
`;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${env.RESEND_API_KEY}`
      },
      body: JSON.stringify({
        from: "LetItEdit <orders@letitedit.com>",
        to: ["ismi8442@gmail.com"], 
        subject: `🚨 Order #${order.id} (PENDING) - ${order.name}`,
        text: emailBody,
      })
    });

    if (!res.ok) {
      const errorData = await res.json();
      return new Response(JSON.stringify({ error: errorData.message }), { status: 500 });
    }

    return new Response(JSON.stringify({ success: true }), { status: 200 });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
