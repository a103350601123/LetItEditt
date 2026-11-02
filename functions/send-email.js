export async function onRequest(context) {
  const { request, env } = context;
  const payload = await request.json();
  const order = payload.record;

  const emailBody = `
    Hello Umaima,
    
    You have received a new order on LetItEdit!
    
    Customer Details:
    -----------------
    Name: ${order.name}
    Email: ${order.email}
    WhatsApp: ${order.whatsapp}
    Delivery Time: ${order.delivery_time}
    
    Requirements:
    ${order.requirements}
    
    File to Edit:
    Please go to your Supabase Storage and download the file named: ${order.file_url}
    
    Let's get to work!
  `;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${env.RESEND_API_KEY}`
    },
    body: JSON.stringify({
      from: "LetItEdit <onboarding@resend.dev>",
      to: ["a1003350601123@gmail.com"],
      subject: `🚨 New Order: ${order.name} (${order.delivery_time})`,
      text: emailBody,
    })
  });

  const data = await res.json();
  return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
}
