export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const body = await request.json();

    // 1. Check if Claude set up a Supabase Webhook (data nested in `record`)
    // or if it's a direct fetch (data is the body itself)
    const order = body.record || body;

    // 2. Automatically detect the variables Claude used
    const id = order.id || order.order_id || order.orderId;
    const name = order.name || order.fullName || order.full_name || order.customer_name || order.customerName || 'Not provided';
    const email = order.email || order.emailAddress || order.email_address || order.customer_email || 'Not provided';
    const whatsapp = order.whatsapp || order.phone || order.phoneNumber || order.customer_phone || 'Not provided';
    const delivery = order.delivery_time || order.deliveryTime || order.speed || order.delivery || 'Not provided';
    const reqs = order.requirements || order.notes || order.description || order.project_details || 'Not provided';
    
    // 3. Generate the Approve Link
    let link = order.approveLink || order.approve_link || order.link;
    if (!link && id) {
      link = `https://letitedit.com/approve-order?id=${id}`;
    }

    if (!id) {
      console.error("Missing ID. Payload received:", JSON.stringify(body));
      return new Response(JSON.stringify({ error: "Missing order ID" }), { status: 400 });
    }

    const emailBody = `
🚨 NEW ORDER: #${id} 🚨
Status: PENDING PAYMENT

Customer Details:
-----------------
Name: ${name}
Email: ${email}
WhatsApp: ${whatsapp}
Delivery Speed: ${delivery}

Requirements:
${reqs}

STEP 1: Check your PayPal account for a payment matching Order #${id}.
STEP 2: Once confirmed, click the link below to unlock their file upload:

👉 ${link}
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
        subject: `🚨 Order #${id} - ${name}`,
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
