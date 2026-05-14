const OpenAI = require('openai');
const logger = require('../utils/logger');

// Lazy init — safe to import without OPENAI_API_KEY set at boot
function getOpenAI() {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY || 'placeholder' });
}

// ── Pick the best upsell offer ────────────────────────────────────────────────
async function pickUpsell(purchasedItems, catalog, orderTotal) {
  try {
    const openai   = getOpenAI();
    const minPrice = (orderTotal * 0.25).toFixed(2);
    const maxPrice = (orderTotal * 0.35).toFixed(2);

    const prompt = `You are a post-purchase upsell optimizer.
Customer just bought: ${JSON.stringify(purchasedItems)}
Order total: $${orderTotal}
Available products: ${JSON.stringify(catalog.slice(0, 50))}

Pick the SINGLE best upsell product. Price it between $${minPrice} and $${maxPrice}.
Respond ONLY in JSON, no markdown:
{"product_id":"id","product_title":"name","upsell_price":29.99,"headline":"Short headline max 10 words","reason":"Why this pairs well max 20 words"}`;

    const res = await openai.chat.completions.create({
      model:       'gpt-4o',
      messages:    [{ role: 'user', content: prompt }],
      max_tokens:  300,
      temperature: 0.3,
    });

    return JSON.parse(res.choices[0].message.content);
  } catch (error) {
    logger.error('pickUpsell failed:', error);
    return null;
  }
}

// ── Decide what flow action to take for a customer ───────────────────────────
async function decideFlow(customerState) {
  try {
    const openai = getOpenAI();

    const prompt = `You are a post-purchase flow orchestrator.
Customer state: ${JSON.stringify(customerState)}

Rules:
- return_initiated = true → action: pause_promos
- carrier_silent_hours > 18 → action: send_delay_warning
- delivered + no return for 7 days → action: send_winback
- return resolved → action: resume_promos
- open return exists → never send promos

Respond ONLY in JSON:
{"action":"pause_promos|resume_promos|send_delay_warning|send_winback|do_nothing","reason":"one line","email_type":"delay_warning|winback|null","delay_hours":0}`;

    const res = await openai.chat.completions.create({
      model:       'gpt-4o',
      messages:    [{ role: 'user', content: prompt }],
      max_tokens:  200,
      temperature: 0.1,
    });

    return JSON.parse(res.choices[0].message.content);
  } catch (error) {
    logger.error('decideFlow failed:', error);
    return { action: 'do_nothing', reason: 'ai error', email_type: null, delay_hours: 0 };
  }
}

// ── Score return risk — detects serial returners ─────────────────────────────
async function scoreReturnRisk(customerHistory) {
  try {
    const openai = getOpenAI();

    const prompt = `Analyze this customer's return history and score their risk.
History: ${JSON.stringify(customerHistory)}

Respond ONLY in JSON:
{"risk_level":"low|medium|high","is_serial_returner":false,"pattern":"description or null","recommended_action":"approve|flag_for_review|require_photo_proof"}`;

    const res = await openai.chat.completions.create({
      model:       'gpt-4o',
      messages:    [{ role: 'user', content: prompt }],
      max_tokens:  200,
      temperature: 0.1,
    });

    return JSON.parse(res.choices[0].message.content);
  } catch (error) {
    logger.error('scoreReturnRisk failed:', error);
    return { risk_level: 'low', is_serial_returner: false, pattern: null, recommended_action: 'approve' };
  }
}

module.exports = { pickUpsell, decideFlow, scoreReturnRisk };
