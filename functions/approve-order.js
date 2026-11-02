export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const orderId = url.searchParams.get("id");
  const secret = url.searchParams.get("secret");

  // 1. Security Check: Make sure the link has the right secret
  if (secret !== "letitedit_secret_123") {
    return new Response("Unauthorized. Invalid secret key.", { status: 401 });
  }

  const supabaseUrl = 'https://bjragiylhglqfodbihvd.supabase.co'; 
  const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJqcmFnaXlsaGdscWZvZGJpaHZkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMzMjQ1NzMsImV4cCI6MjEwODkwMDU3M30.upa96t4q9W1AXIr8wry3kL_8U7L__GmTZZ3kWNjurYU';

  // 2. Update the database to change status from 'pending' to 'paid'
  const res = await fetch(`${supabaseUrl}/rest/v1/orders?id=eq.${orderId}`, {
    method: 'PATCH',
    headers: {
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify({ status: 'paid' })
  });

  // 3. Show a success message in your browser when you click the link
  if (res.ok) {
    return new Response(`
      <html>
        <body style="background:#050914; color:#fff; text-align:center; padding-top:100px; font-family:sans-serif;">
          <h1 style="color:#10b981; font-size: 40px;">✅ Payment Approved!</h1>
          <p style="font-size: 18px;">The database has been updated.</p>
          <p style="color:#94a3b8;">The customer's screen is now unlocked and they can upload their file.</p>
        </body>
      </html>
    `, { headers: { 'Content-Type': 'text/html' } });
  } else {
    return new Response("Error updating database", { status: 500 });
  }
}
