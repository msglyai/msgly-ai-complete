// LLM fallback chain: GPT-5 nano → GPT-5 mini (Gemini removed)
// Updated for USER PROFILE ONLY mode, ready for TARGET PROFILE expansion

const { sendToGemini } = require('./sendToGemini'); // Actually calls OpenAI now
const { sendToOpenAI } = require('./sendToOpenAI'); // Backup if you have this

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
  console.log('🤖 LLM Orchestrator: Starting OpenAI-only processing...');
  console.log(`📊 Profile type: ${isUserProfile ? 'USER' : 'TARGET'}`);
  
  // 1) OpenAI GPT-5-nano (primary) - using your cleaned sendToGemini function
  console.log('🚀 Attempting OpenAI GPT-5-nano (primary)...');
  try {
    const nano = await sendToGemini({
      html, 
      url, 
      isUserProfile,
      optimization: { mode: isUserProfile ? 'standard' : 'less_aggressive' }
    });
    
    if (nano?.success && isValidProfile(nano.data)) {
      console.log('✅ OpenAI GPT-5-nano succeeded!');
      return { 
        success: true, 
        data: nano.data, 
        provider: 'openai', 
        model: 'gpt-5-nano', 
        usage: nano.usage || { input_tokens: 0, output_tokens: 0, total_tokens: 0 }
      };
    }
    
    if (!isTransient(nano)) {
      console.log('❌ OpenAI GPT-5-nano failed (non-transient), no fallback available');
      return { 
        success: false, 
        userMessage: nano?.userMessage || 'Failed to process profile with OpenAI', 
        status: nano?.status || 400 
      };
    }
    
    console.log('⚠️ OpenAI GPT-5-nano failed (transient), attempting fallback...');
    
  } catch (error) {
    console.error('💥 OpenAI GPT-5-nano error:', error.message);
    
    // Check if error is transient
    if (!isTransient(error)) {
      return { 
        success: false, 
        userMessage: 'Failed to process profile with OpenAI', 
        status: error.response?.status || 500 
      };
    }
  }

  // 2) Fallback: Try OpenAI with different settings (if you have sendToOpenAI function)
  console.log('🔄 Attempting OpenAI fallback...');
  
  // If you don't have sendToOpenAI, we can try sendToGemini again with different optimization
  try {
    const fallback = await sendToGemini({
      html, 
      url, 
      isUserProfile,
      optimization: { mode: 'less_aggressive' } // Try less aggressive mode as fallback
    });
    
    if (fallback?.success && isValidProfile(fallback.data)) {
      console.log('✅ OpenAI fallback succeeded!');
      return { 
        success: true, 
        data: fallback.data, 
        provider: 'openai', 
        model: 'gpt-5-nano-fallback', 
        usage: fallback.usage || { input_tokens: 0, output_tokens: 0, total_tokens: 0 }
      };
    }
    
    console.log('❌ All OpenAI attempts failed');
    return { 
      success: false, 
      userMessage: fallback?.userMessage || 'Failed to process profile after multiple attempts', 
      status: fallback?.status || 503, 
      transient: true 
    };
    
  } catch (fallbackError) {
    console.error('💥 OpenAI fallback error:', fallbackError.message);
    return { 
      success: false, 
      userMessage: 'Failed to process profile after multiple attempts', 
      status: fallbackError.response?.status || 503, 
      transient: true 
    };
  }
}

module.exports = { processProfileWithLLM };
