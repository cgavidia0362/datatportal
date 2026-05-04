export default async function handler(req, res) {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }
  
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
    }
  
    try {
      // Parse body whether it comes in as string or object
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
  
      const data = await response.json();
  
      // Log error details to help debug
      if (!response.ok) {
        console.error('[ai-summary] Anthropic error:', response.status, JSON.stringify(data));
      }
  
      return res.status(response.status).json(data);
    } catch (e) {
      console.error('[ai-summary] Catch error:', e.message);
      return res.status(500).json({ error: e.message });
    }
  }