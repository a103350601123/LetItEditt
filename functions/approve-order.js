export async function onRequestGet(context) {
  try {
    const { request, env } = context;
    const url = new URL(request.url);
    const id = url.searchParams.get("id");

    if (!id) return new Response("Error: Missing order ID in link.", {status: 400});

    const supaKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY;
    if (!supaKey) {
      return new Response("Error: SUPABASE_SERVICE_ROLE_KEY is missing in Cloudflare settings.", {status: 500});
    }

    const supaUrl = env.SUPABASE_URL || 'https://bjragiylhglqfodbihvd.supabase.co';
    let updated = false;
    
    // Try updating 'orders' table (my code) or 'editing_orders' table (Claude's code)
    for (const table of ['orders', 'editing_orders']) {
        const res = await fetch(`${supaUrl}/rest/v1/${table}?id=eq.${id}`, {
            method: "PATCH",
            headers: {
                "apikey": supaKey,
                "Authorization": `Bearer ${supaKey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ status: "paid" })
        });
        if (res.ok) { 
            const text = await res.text();
            // If it actually updated a row (Supabase returns an array of updated rows)
            if (text !== "[]" && text !== "") {
                updated = true; 
                break; 
            }
        }
    }

    if (!updated) return new Response("Failed to update order. The order might not exist, or the API key is wrong.", {status: 500});

    return new Response(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1">
      </head>
      <body style="background:#060a14;color:#fff;text-align:center;padding:50px;font-family:system-ui,sans-serif;">
        <h1 style="color:#10b981;">✅ Order Approved</h1>
        <p>Order #${id} marked as PAID.</p>
        <p>The user's screen will now automatically unlock to upload their file.</p>
        <br>
        <a href="/" style="color:#38bdf8; text-decoration:none; font-weight:bold;">Return to Home</a>
      </body></html>
    `, { headers: { "Content-Type": "text/html" } });

  } catch (e) {
    return new Response(`Error: ${e.message}`, {status: 500});
  }
}
