export default async function handler(req, res) {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }
  
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured — check Vercel env vars' });
    }
  
    try {
      const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: body
      });
  
      const text = await response.text();
      console.log('[ai-summary] status:', response.status, 'body:', text);
  
      try {
        return res.status(response.status).json(JSON.parse(text));
      } catch {
        return res.status(response.status).send(text);
      }
  
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }