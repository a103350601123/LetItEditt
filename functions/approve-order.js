export async function onRequestGet(context) {
  try {
    const { request, env } = context;
    const url = new URL(request.url);
    const id = url.searchParams.get("id");

    if (!id || id === "undefined" || id === "null") {
      return new Response("❌ Error: The approval link is missing the Order ID. Check the email link.", { status: 400 });
    }

    const SUPABASE_URL = 'https://bjragiylhglqfodbihvd.supabase.co';
    const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

    if (!SERVICE_KEY) {
      return new Response("❌ Error: The SUPABASE_SERVICE_ROLE_KEY is missing from your Cloudflare settings.", { status: 500 });
    }

    // Update Supabase status to 'paid'
    const res = await fetch(`${SUPABASE_URL}/rest/v1/orders?id=eq.${id}`, {
      method: "PATCH",
      headers: {
        "apikey": SERVICE_KEY,
        "Authorization": `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
        "Prefer": "return=minimal"
      },
      body: JSON.stringify({ status: "paid" })
    });

    if (!res.ok) {
      const errorText = await res.text();
      return new Response(`❌ Supabase Error: ${errorText}`, { status: 500 });
    }

    // Success Page
    return new Response(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Order Approved</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body{font-family:system-ui,sans-serif;text-align:center;padding:50px;background:#060a14;color:#fff}
          .card{background:#0f172a;padding:40px;border-radius:20px;box-shadow:0 10px 30px rgba(0,0,0,0.5);max-width:500px;margin:0 auto;border:1px solid #38bdf8;}
          h1{color:#10b981;margin-bottom:10px;}
          .btn{display:inline-block;margin-top:20px;padding:12px 24px;background:#38bdf8;color:#000;text-decoration:none;border-radius:99px;font-weight:bold;}
        </style>
      </head>
      <body>
        <div class="card">
            <h1>✅ Order Approved</h1>
            <p>Order <strong>#${id}</strong> has been marked as <strong>paid</strong>.</p>
            <p>The user's screen will now unlock and allow them to upload their file.</p>
            <a href="/" class="btn">Return to Website</a>
        </div>
      </body>
      </html>
    `, { headers: { "Content-Type": "text/html" } });

  } catch (error) {
    return new Response(`❌ System Error: ${error.message}`, { status: 500 });
  }
}
