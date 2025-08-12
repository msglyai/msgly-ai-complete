// What changed in Stage G
// OpenAI caller for gpt-5-nano / gpt-5-mini returning strict JSON

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

function buildPrompts(html) {
    const system = `You are a LinkedIn profile data extraction expert. Return ONLY valid JSON using the exact schema we use (profile, experience[], education[], awards[], certifications[], skills[], engagement...). No markdown.`;
    const user = `Extract comprehensive LinkedIn profile data from this HTML:\n\n${html}`;
    return { system, user };
}

async function sendToOpenAI({ html, url, model }) {
    if (!OPENAI_API_KEY) {
        return { success: false, status: 500, userMessage: 'OPENAI_API_KEY not configured' };
    }
    try {
        const { system, user } = buildPrompts(html);

        const resp = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model, temperature: 0.1,
                messages: [
                    { role: 'system', content: system },
                    { role: 'user', content: user }
                ],
                response_format: { type: 'json_object' },
                max_tokens: 8000
            }),
            timeout: 60000
        });

        if (!resp.ok) {
            return { success: false, status: resp.status, transient: [408,429,500,502,503,504].includes(resp.status) };
        }

        const data = await resp.json();
        const text = data?.choices?.[0]?.message?.content || '';
        const parsed = JSON.parse(text);

        const usage = {
            model,
            input_tokens: data?.usage?.prompt_tokens || 0,
            output_tokens: data?.usage?.completion_tokens || 0,
            total_tokens: data?.usage?.total_tokens || 0
        };

        return { success: true, data: parsed, usage };
    } catch (err) {
        return { success: false, status: err?.status || 500, transient: true, userMessage: 'OpenAI request failed' };
    }
}

module.exports = { sendToOpenAI };
