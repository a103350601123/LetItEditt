export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const orderId = url.searchParams.get("id");
  const secret = url.searchParams.get("secret");

  if (secret !== "letitedit_secret_123") {
    return new Response("Unauthorized. Invalid secret key.", { status: 401 });
  }

  const supabaseUrl = 'https://bjragiylhglqfodbihvd.supabase.co'; 
  const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJqcmFnaXlsaGdscWZvZGJpaHZkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMzMjQ1NzMsImV4cCI6MjEwODkwMDU3M30.upa96t4q9W1AXIr8wry3kL_8U7L__GmTZZ3kWNjurYU';

  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/orders?id=eq.${orderId}`, {
      method: 'PATCH',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation' // Forces Supabase to return the updated row
      },
      body: JSON.stringify({ status: 'paid' })
    });

    const data = await res.json();

    // If data is an empty array, it means Supabase found 0 rows with that ID (or RLS blocked it)
    if (res.ok && data.length > 0) {
      return new Response(`
        <html>
          <body style="background:#050914; color:#fff; text-align:center; padding-top:100px; font-family:sans-serif;">
            <h1 style="color:#10b981; font-size: 40px;">✅ Payment Approved!</h1>
            <p style="font-size: 18px;">Database successfully updated to 'paid'.</p>
            <p style="color:#94a3b8;">Order ID: ${orderId}</p>
          </body>
        </html>
      `, { headers: { 'Content-Type': 'text/html' } });
    } else {
      return new Response(`
        <html>
          <body style="background:#050914; color:#fff; text-align:center; padding-top:100px; font-family:sans-serif;">
            <h1 style="color:#ef4444; font-size: 40px;">❌ Update Failed</h1>
            <p style="font-size: 18px;">Supabase rejected the update. 0 rows were changed.</p>
            <p style="color:#ef4444;">This means either the Order ID is wrong, or your RLS Policies are blocking the UPDATE.</p>
          </body>
        </html>
      `, { status: 400, headers: { 'Content-Type': 'text/html' } });
    }
  } catch (error) {
    return new Response("Server Error: " + error.message, { status: 500 });
  }
}
