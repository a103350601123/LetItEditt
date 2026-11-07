export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const order = await request.json();

    if (!order.id) {
      return new Response(JSON.stringify({ error: "Missing order ID" }), { status: 400 });
    }

    const emailBody = `
🚨 NEW ORDER: #${order.id} 🚨
Status: PENDING PAYMENT

Name: ${order.name}
Email: ${order.email || 'Not provided'}
WhatsApp: ${order.whatsapp || 'Not provided'}
Delivery Speed: ${order.delivery_time}

Requirements:
${order.requirements}

👉 Approve link: ${order.approveLink || ''}
`;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${env.RESEND_API_KEY}`
      },
      body: JSON.stringify({
        // 👇 MUST USE ONBOARDING EMAIL IF DOMAIN IS DELETED 👇
        from: "LetItEdit <onboarding@resend.dev>",
        
        // 👇 MUST BE THE EMAIL YOU USED TO SIGN UP FOR RESEND 👇
        to: ["a1003350601123@gmail.com"], 
        
        subject: `🚨 Order #${order.id} - ${order.name}`,
        text: emailBody,
      })
    });

    const data = await res.json();
    
    // If Resend rejects it, print the exact error to Cloudflare Logs
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
