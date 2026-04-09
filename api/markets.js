export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const response = await fetch(
      'https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=200&order=volumeNum&ascending=false',
      { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' } }
    );
    const data = await response.json();
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
