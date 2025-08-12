// What changed in Stage G
// LLM fallback chain: Gemini → GPT-5 nano → GPT-5 mini

const { sendToGemini } = require('../sendToGemini (10).js');
const { sendToOpenAI } = require('./sendToOpenAI');

function isTransient(errOrRes) {
    const code = errOrRes?.status || errOrRes?.response?.status;
    return [408, 429, 500, 502, 503, 504].includes(code) || errOrRes?.transient === true;
}

function isValidProfile(json) {
    try {
        if (!json || typeof json !== 'object') return false;
        if (!json.profile || !json.profile.name) return false;
        const hasExp = Array.isArray(json.experience) && json.experience.length > 0;
        const hasEdu = Array.isArray(json.education) && json.education.length > 0;
        return hasExp || hasEdu;
    } catch { return false; }
}

async function processProfileWithLLM({ html, url, isUserProfile }) {
    // 1) Gemini (primary)
    const g = await sendToGemini({
        html, url, isUserProfile,
        optimization: { mode: isUserProfile ? 'standard' : 'less_aggressive' }
    });
    if (g?.success && isValidProfile(g.data)) {
        return { success: true, data: g.data, provider: 'gemini', model: g?.usage?.model || 'gemini-1.5-flash', usage: g.usage };
    }
    if (!isTransient(g)) {
        return { success: false, userMessage: g?.userMessage || 'Failed to process profile', status: g?.status || 400 };
    }

    // 2) OpenAI GPT-5 nano (fallback #1)
    const n = await sendToOpenAI({ html, url, model: 'gpt-5-nano' });
    if (n?.success && isValidProfile(n.data)) {
        return { success: true, data: n.data, provider: 'openai', model: 'gpt-5-nano', usage: n.usage };
    }
    if (!isTransient(n)) {
        // try one more if invalid or non-transient
        // 3) OpenAI GPT-5 mini (fallback #2)
        const m = await sendToOpenAI({ html, url, model: 'gpt-5-mini' });
        if (m?.success && isValidProfile(m.data)) {
            return { success: true, data: m.data, provider: 'openai', model: 'gpt-5-mini', usage: m.usage };
        }
        return { success: false, userMessage: m?.userMessage || 'Failed to process profile', status: m?.status || 400 };
    }

    // transient on nano → try mini
    const m = await sendToOpenAI({ html, url, model: 'gpt-5-mini' });
    if (m?.success && isValidProfile(m.data)) {
        return { success: true, data: m.data, provider: 'openai', model: 'gpt-5-mini', usage: m.usage };
    }
    return { success: false, userMessage: m?.userMessage || 'Failed to process profile', status: m?.status || 503, transient: true };
}

module.exports = { processProfileWithLLM };
