export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const body = await request.json();

    // 1. Try to find where Claude put the order data
    const data = body.record || body.data || body.order || body;

    // 2. Extract the ID
    const orderId = data.id || data.order_id || body.id || body.order_id;

    // If no ID exists, we can't send an approve link, so stop.
    if (!orderId) {
      console.error("Missing ID. Payload received:", JSON.stringify(body));
      return new Response(JSON.stringify({ error: "Missing order ID" }), { status: 400 });
    }

    // 3. Extract fields (handling different names Claude might use)
    let name = data.name || data.fullName || data.full_name || data.customer_name || data.customerName;
    let email = data.email || data.emailAddress || data.email_address || data.customer_email;
    let whatsapp = data.whatsapp || data.phone || data.phoneNumber || data.customer_phone;
    let delivery = data.delivery_time || data.deliveryTime || data.speed || data.delivery;
    let reqs = data.requirements || data.notes || data.description || data.project_details;

    // 4. If data is still missing, fetch it from Supabase using the ID
    const supaKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY;
    const supaUrl = env.SUPABASE_URL || 'https://bjragiylhglqfodbihvd.supabase.co';

    if (!name && supaKey) {
       for (const table of ['orders', 'editing_orders']) {
           try {
               const res = await fetch(`${supaUrl}/rest/v1/${table}?id=eq.${orderId}`, {
                   headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}` }
               });
               const dbData = await res.json();
               if (dbData && dbData.length > 0) {
                   name = name || dbData[0].name || dbData[0].full_name;
                   email = email || dbData[0].email;
                   whatsapp = whatsapp || dbData[0].whatsapp || dbData[0].phone;
                   delivery = delivery || dbData[0].delivery_time || dbData[0].delivery;
                   reqs = reqs || dbData[0].requirements || dbData[0].notes;
                   break;
               }
           } catch (e) { /* ignore table errors */ }
       }
    }

    const approveLink = `https://letitedit.com/approve-order?id=${orderId}`;
    const ownerEmail = env.OWNER_EMAIL || "a1003350601123@gmail.com";
    const fromEmail = env.FROM_EMAIL || "LetItEdit <orders@letitedit.com>";

    // 5. Use a beautiful HTML template so email clients don't strip the text
    const htmlBody = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
        <h2 style="color: #ef4444;">🚨 New Order #${orderId}</h2>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
          <tr><td style="padding: 8px; border-bottom: 1px solid #e2e8f0;"><strong>Name:</strong></td><td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">${name || 'Not provided'}</td></tr>
          <tr><td style="padding: 8px; border-bottom: 1px solid #e2e8f0;"><strong>Email:</strong></td><td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">${email || 'Not provided'}</td></tr>
          <tr><td style="padding: 8px; border-bottom: 1px solid #e2e8f0;"><strong>WhatsApp:</strong></td><td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">${whatsapp || 'Not provided'}</td></tr>
          <tr><td style="padding: 8px; border-bottom: 1px solid #e2e8f0;"><strong>Delivery:</strong></td><td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">${delivery || 'Not provided'}</td></tr>
        </table>
        
        <h3>Requirements:</h3>
        <p style="background: #f8fafc; padding: 15px; border-radius: 6px;">${reqs || 'Not provided'}</p>
        
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;">
        
        <p style="text-align: center;">
          <a href="${approveLink}" style="background: #38bdf8; color: #000; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Approve Order & Unlock Upload</a>
        </p>

        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;">
        <p style="font-size: 11px; color: #94a3b8; word-break: break-all;">Debug Data (What Claude sent):<br><code>${JSON.stringify(body)}</code></p>
      </div>
    `;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${env.RESEND_API_KEY}` },
      body: JSON.stringify({
        from: fromEmail,
        to: [ownerEmail],
        subject: `🚨 Order #${orderId} - ${name || 'New'}`,
        html: htmlBody
      })
    });

    const dataRes = await res.json();
    if (!res.ok) {
      console.error("Resend Error:", dataRes);
      return new Response(JSON.stringify({ error: dataRes.message }), { status: 500 });
    }

    return new Response(JSON.stringify({ success: true }), { status: 200 });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}
