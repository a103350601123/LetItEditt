export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const id = url.searchParams.get("id");

  if (!id) {
    return new Response("Missing order ID in the link.", { status: 400 });
  }

  // Your Supabase URL
  const SUPABASE_URL = 'https://bjragiylhglqfodbihvd.supabase.co';
  
  // We need the Secret Service Role Key to update the database
  const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SERVICE_KEY) {
    return new Response("Server Error: SUPABASE_SERVICE_ROLE_KEY is missing from Cloudflare settings.", { status: 500 });
  }

  try {
    // Update the order status to 'paid'
    const res = await fetch(`${SUPABASE_URL}/rest/v1/orders?id=eq.${id}`, {
      method: "PATCH",
      headers: {
        "apikey": SERVICE_KEY,
        "Authorization": `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ status: "paid" })
    });

    if (!res.ok) throw new Error(await res.text());

    // Show a beautiful success page to the Admin
    return new Response(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Order Approved</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body{font-family:system-ui,sans-serif;text-align:center;padding:50px;background:linear-gradient(135deg,#ffe3ee 0%,#ece8ff 48%,#dcf0ff 100%);color:#0e1726}
          .card{background:rgba(255,255,255,0.8);backdrop-filter:blur(10px);padding:40px;border-radius:20px;box-shadow:0 10px 30px rgba(0,0,0,0.1);max-width:500px;margin:0 auto;border:1px solid white;}
          h1{color:#12805c;margin-bottom:10px;}
          .btn{display:inline-block;margin-top:20px;padding:12px 24px;background:#4f46e5;color:white;text-decoration:none;border-radius:99px;font-weight:bold;}
        </style>
      </head>
      <body>
        <div class="card">
            <h1>✅ Order Approved</h1>
            <p>Order <strong>#${id}</strong> has been marked as <strong>paid</strong>.</p>
            <p>The user's page will now automatically unlock and allow them to upload their file.</p>
            <a href="/" class="btn">Return to Website</a>
        </div>
      </body>
      </html>
    `, {
      headers: { "Content-Type": "text/html" }
    });

  } catch (error) {
    return new Response(`
      <!DOCTYPE html>
      <html>
      <head><title>Error</title></head>
      <body style="font-family:sans-serif;padding:40px;text-align:center;">
        <h1 style="color:red;">❌ Error Approving Order</h1>
        <p>${error.message}</p>
      </body>
      </html>
    `, { status: 500, headers: { "Content-Type": "text/html" } });
  }
}
