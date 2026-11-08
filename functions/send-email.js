export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const order = await request.json();

    if (!order.id) {
      return new Response(JSON.stringify({ error: "Missing order ID" }), { status: 400 });
    }

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${env.RESEND_API_KEY}`
      },
      body: JSON.stringify({
        from: "LetItEdit <orders@letitedit.com>",
        to: ["a1003350601123@gmail.com"], 
        subject: `🚨 Order #${order.id} - ${order.name}`,
        text: `New Order #${order.id}\n\nName: ${order.name}\nEmail: ${order.email}\nWhatsApp: ${order.whatsapp}\nSpeed: ${order.delivery_time}\n\nRequirements:\n${order.requirements}\n\nClick here to approve and unlock upload:\n${order.approveLink}`
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
