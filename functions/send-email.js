export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const body = await request.json();
    
    // Get the ID (handles different names from Claude's frontend or Supabase Webhooks)
    const orderId = body.id || body.order_id || body.record?.id;
    if (!orderId) return new Response(JSON.stringify({error: "No ID"}), {status: 400});

    // Extract data if Claude sent it
    let name = body.name || body.fullName || body.record?.name;
    let email = body.email || body.record?.email;
    let whatsapp = body.whatsapp || body.record?.whatsapp || body.record?.phone;
    let delivery = body.delivery_time || body.record?.delivery_time;
    let reqs = body.requirements || body.record?.requirements;

    // If Claude's frontend only sent the ID, we fetch the details from Supabase
    const supaKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY;
    const supaUrl = env.SUPABASE_URL || 'https://bjragiylhglqfodbihvd.supabase.co';

    if (!name && supaKey) {
       for (const table of ['orders', 'editing_orders']) {
           const res = await fetch(`${supaUrl}/rest/v1/${table}?id=eq.${orderId}`, {
               headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}` }
           });
           const data = await res.json();
           if (data && data.length > 0) {
               name = data[0].name;
               email = data[0].email;
               whatsapp = data[0].whatsapp || data[0].phone;
               delivery = data[0].delivery_time || data[0].delivery;
               reqs = data[0].requirements;
               break;
           }
       }
    }

    const approveLink = `https://letitedit.com/approve-order?id=${orderId}`;
    const ownerEmail = env.OWNER_EMAIL || "a1003350601123@gmail.com";
    const fromEmail = env.FROM_EMAIL || "LetItEdit <orders@letitedit.com>";

    const emailBody = `
🚨 NEW ORDER: #${orderId} 🚨
Name: ${name || 'N/A'}
Email: ${email || 'N/A'}
WhatsApp: ${whatsapp || 'N/A'}
Delivery: ${delivery || 'N/A'}
Requirements: ${reqs || 'N/A'}

👉 Approve Link: ${approveLink}
    `;

    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${env.RESEND_API_KEY}` },
      body: JSON.stringify({
        from: fromEmail,
        to: [ownerEmail],
        subject: `🚨 Order #${orderId} - ${name || 'New'}`,
        text: emailBody
      })
    });

    return new Response(JSON.stringify({success: true}), {status: 200});
  } catch (e) {
    return new Response(JSON.stringify({error: e.message}), {status: 500});
  }
}
